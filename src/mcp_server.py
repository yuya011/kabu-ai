"""kabu-ai の MCP サーバー。対話型AI（Claude / Cursor / Gemini）から日本株のデータを直に引く。

サイトが配っている静的 JSON をそのまま情報源にする。
サイトと MCP で別々にデータを組まないので、片方だけ古いということが起きない。

    frontend/public/data/mcp/
      index.json      上場企業の目録（コード・社名・業種・ドメイン）
      c/<コード>.json  企業詳細（有報5期・政策保有・大株主・取引先・臨時報告書）
      surprise.json   決算サプライズの順位（公開版には入らない。下記参照）

画面用の data/browser/ ではなく専用の書き出しを読むのは、粒度が違うためである。
画面は近隣の銘柄を続けて開くので上2桁でまとめたシャードが得だが、MCP は
1社ずつ飛び飛びに引かれるので、1社を見るのに 0.5MB を読むことになる。
同じ素材から 1社1ファイル に割り直したものが data/mcp/ で、
リモート版（worker/mcp.js）もこれを読む。

倉庫（data/kabu.duckdb）を直に読まないのは、倉庫が git に入っていないためである。
`uvx --from git+https://…` で取り寄せた利用者の手元には倉庫が無い。
一方で書き出し済みの JSON は GitHub Pages から誰でも引けるので、
配布物としてはこちらが唯一の情報源になる。取り寄せたぶんは手元に貯めるので、
2回目からは通信が出ない。

    リポジトリの中で動かすときは frontend/public/data/mcp を自動で使う。
    KABU_MCP_DATA=<ディレクトリ>  手元の書き出しを明示して使う
    KABU_MCP_BASE=<URL>           配信元を差し替える（独自ドメインに移したとき）
    KABU_MCP_TTL=<秒>             貯めたぶんの寿命。既定は6時間（日次更新に合わせてある）
    KABU_MCP_STATS=<URL>          当日の開示速報を返す Worker。空にすると引きにいかない

起動:
    uvx --from git+https://github.com/yuya011/kabu-ai.git kabu-mcp
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

try:
    from src.name_key import match as name_match, norm as name_norm
except ImportError:  # src/ に入って python mcp_server.py で起動したとき
    from name_key import match as name_match, norm as name_norm

# 公式 SDK は 2.0 で FastMCP を MCPServer に改名した。
# 利用者が 1.x を固定している場合もあるので、どちらでも動くようにしておく。
try:
    from mcp.server.mcpserver import MCPServer as _Server  # mcp >= 2.0
except ImportError:  # pragma: no cover - mcp 1.x
    from mcp.server.fastmcp import FastMCP as _Server

server = _Server(
    "kabu-ai",
    version="0.1.0",
    instructions=(
        "日本株（東証上場約3,900社）のデータを返します。"
        "出典は EDINET の有価証券報告書で、推測は入っていません。"
        "証券コードが分からないときは、まず search_company で引いてください。"
    ),
)

BASE = os.environ.get(
    "KABU_MCP_BASE", "https://yuya011.github.io/kabu-ai/data/mcp"
).rstrip("/")
STATS = os.environ.get("KABU_MCP_STATS", "https://kabu-stats.yuya011.workers.dev").rstrip("/")
TTL = int(os.environ.get("KABU_MCP_TTL", 6 * 3600))
CACHE = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "kabu-ai-mcp"
UA = "kabu-ai-mcp/0.1 (+https://github.com/yuya011/kabu-ai)"

SOURCE = "EDINET（金融庁）の有価証券報告書。公共データ利用規約（PDL1.0）に基づき kabu-ai が加工"

# 「7203」「72030」「7203.T」「135A」のどれで来ても受ける。
# 書き出し側の証券コードは EDINET と同じ5桁（4桁＋0）で揃えてある。
_SUFFIX = re.compile(r"\.(T|JP|TO)$", re.I)


def _local_dir() -> Path | None:
    """手元の書き出しを使えるなら、そのディレクトリを返す。

    リポジトリの中で動かしている開発者は、push する前の書き出しをそのまま試せる。
    """
    env = os.environ.get("KABU_MCP_DATA")
    if env:
        p = Path(env).expanduser()
        return p if (p / "index.json").exists() else None
    p = Path(__file__).resolve().parent.parent / "frontend" / "public" / "data" / "mcp"
    return p if (p / "index.json").exists() else None


LOCAL = _local_dir()

# 一度読んだ JSON は、そのまま持っておく。企業シャードは1つ 0.5MB ほどあるので、
# 貯めっぱなしにせず古いものから捨てる。常駐したまま数十社を辿られても膨らまない。
_MEM: dict[str, Any] = {}
_MEM_MAX = 12


def _remember(rel: str, obj: Any) -> Any:
    if len(_MEM) >= _MEM_MAX:
        del _MEM[next(iter(_MEM))]
    _MEM[rel] = obj
    return obj


def _http_json(url: str, timeout: int = 30) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def _get(rel: str) -> Any:
    """書き出し済み JSON を1本読む。手元 → 貯めたぶん → 配信元 の順に見る。

    引けなかったときは経路によらず RuntimeError にする。1社1ファイルなので
    「無い銘柄」はファイルの欠損として現れ、呼び手はそこを握り潰したい。
    手元では FileNotFoundError、通信では URLError と、経路ごとに型が違うと
    捕まえ損ねる。
    """
    if rel in _MEM:
        return _MEM[rel]

    if LOCAL is not None:
        try:
            return _remember(rel, json.loads((LOCAL / rel).read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError) as e:
            raise RuntimeError(f"{LOCAL / rel} を読めませんでした: {e}") from e

    hit = CACHE / rel
    if hit.exists() and time.time() - hit.stat().st_mtime < TTL:
        return _remember(rel, json.loads(hit.read_text(encoding="utf-8")))

    try:
        obj = _http_json(f"{BASE}/{rel}")
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as e:
        # 通信が絶えても、古いぶんが手元にあるなら黙って捨てない。
        # 日次更新のデータなので、1日古くても無いよりはるかに役に立つ。
        if hit.exists():
            return _remember(rel, json.loads(hit.read_text(encoding="utf-8")))
        raise RuntimeError(f"{BASE}/{rel} を取得できませんでした: {e}") from e

    hit.parent.mkdir(parents=True, exist_ok=True)
    hit.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
    return _remember(rel, obj)


def norm_code(code: str) -> str:
    """入力の証券コードを書き出し側の5桁に揃える。無理なら空文字。"""
    s = _SUFFIX.sub("", str(code or "").strip().upper())
    s = re.sub(r"[^0-9A-Z]", "", s)
    if len(s) == 4:
        return s + "0"
    if len(s) == 5:
        return s
    return ""


def short(code: str) -> str:
    """人が呼ぶときの4桁に戻す。トヨタは 72030 ではなく 7203 で通っている。"""
    return code[:4]


def pub_code(code: str | None) -> str | None:
    """相手方の識別子が証券コードなら4桁で返し、そうでなければ返さない。

    有報の相手方には非上場が多い。書き出し側はそこに内部の仮 ID
    （EDINETコードの E00050、社名だけの先の X… ）を振っている。
    証券コードのつもりで返すと、他の道具にそのまま渡されて必ず空振りする。
    """
    if code and len(code) == 5 and code[0].isdigit():
        return short(code)
    return None


def _index() -> dict:
    return _get("index.json")


def _detail(code5: str) -> dict | None:
    """企業詳細。1社1ファイルなので、読むのは10KB前後で済む。"""
    try:
        return _get(f"c/{code5}.json")
    except RuntimeError:
        return None


def _resolve(code: str) -> tuple[str, dict]:
    """コードを解決して詳細を返す。見つからなければ例外にせず、呼び手に返す形で示す。"""
    c = norm_code(code)
    if not c:
        raise ValueError(f"証券コードとして読めません: {code!r}（例: 7203, 72030, 7203.T）")
    d = _detail(c)
    if d is None:
        raise ValueError(
            f"証券コード {short(c)} は見つかりませんでした。"
            "search_company で社名から引き直してください"
        )
    return c, d


def _drop_none(d: dict) -> dict:
    """値が無い項目は返さない。LLM に渡すトークンを減らすため。"""
    return {k: v for k, v in d.items() if v is not None and v != "" and v != []}


# ---------------------------------------------------------------- 1. 銘柄検索

@server.tool()
def search_company(query: str, limit: int = 20) -> dict:
    """社名・証券コード・業種名で上場企業を検索する。

    まずこれを呼んで証券コードを確かめてから、他のツールに渡す。

    Args:
        query: 社名の一部（「トヨタ」「キーエンス」）、証券コード（7203 / 72030 / 7203.T）、
               または業種名（「情報・通信業」「銀行業」「電気機器」）。
        limit: 返す最大件数。既定20、上限100。

    Returns:
        code（4桁）, name, sector33, sector17, website を含む一覧。
    """
    q = (query or "").strip()
    if not q:
        return {"error": "query が空です"}
    limit = max(1, min(int(limit), 100))

    idx = _index()
    # [証券コード, 社名, 17業種コード, 33業種名, ドメイン, 検索キー, 頭文字, 大きさ]。
    # 目録は上場ぶんだけで、有報の相手方に多い非上場は入れていない。
    # 名前しか返せない先を並べても役に立たない。
    nodes = idx["companies"]
    s17_name = {s["code"]: s["name"] for s in idx["sectors"]}

    lower = q.lower()
    nq = name_norm(q) or re.sub(r"\s+", "", lower)
    code5 = norm_code(q)
    # 「7203」のように数字だけで来たときはコードの前方一致に倒す。
    # 社名に数字が入る会社（伊藤忠エネクス等）を数字で引くことはまず無い。
    as_code = bool(code5) and q.replace(".", "").isalnum() and any(ch.isdigit() for ch in q)

    # 社名は表記ゆれ・ヨミ・英字名・略称まで拾う（src/name_key.py）。
    # 業種名の一致は社名のどの一致より下、打ち間違いの救済より上に置く
    hits: list[tuple[tuple, list]] = []
    for n in nodes:
        c, name, s17, s33 = n[0], n[1], n[2], n[3]
        rank = None
        if as_code:
            if c == code5:
                rank = (0, 0)
            elif c.startswith(re.sub(r"[^0-9A-Z]", "", q.upper())):
                rank = (1, 0)
        else:
            m = name_match(nq, name_norm(name), n[5] if len(n) > 5 else "",
                           n[6] if len(n) > 6 else "")
            if m and m[0] < 4:
                rank = m
            elif lower in (s33 or "").lower() or lower in (s17_name.get(s17, "")).lower():
                rank = (4, 0)
            elif m:
                rank = (5, m[1])
        if rank is None:
            continue
        hits.append((rank, n))

    # 打ち間違いの救済は、ほかに当たりが無いときだけ出す
    if any(r[0] < 5 for r, _ in hits):
        hits = [h for h in hits if h[0][0] < 5]
    # 一致の強さ、次に会社の大きさ（資本金）、社名の短さ。「トヨタ」でトヨタ自動車が上に来る
    hits.sort(key=lambda h: (*h[0], -(h[1][7] if len(h[1]) > 7 else 0), len(h[1][1])))

    out = [
        _drop_none({
            "code": pub_code(n[0]),
            "name": n[1],
            "sector33": n[3] or None,
            "sector17": s17_name.get(n[2]) or None,
            "website": f"https://{n[4]}" if n[4] else None,
        })
        for _rank, n in hits[:limit]
    ]

    return {
        "query": q,
        "matched": len(hits),
        "returned": len(out),
        "companies": out,
        "source": SOURCE,
    }


# ---------------------------------------------------------- 2. 財務・業績の推移

@server.tool()
def get_company_profile(code: str) -> dict:
    """企業の基本情報と、有価証券報告書「主要な経営指標等の推移」による5期の業績を返す。

    Args:
        code: 証券コード（7203 / 72030 / 7203.T のいずれでもよい）。

    Returns:
        会社情報、会計基準、5期の売上・利益・ROE・EPS・自己資本比率など。
        金額の単位は円。資本金だけ百万円。
    """
    try:
        c, d = _resolve(code)
    except ValueError as e:
        return {"error": str(e)}

    results = []
    for r in d.get("results", []):
        results.append(_drop_none({
            "period": r.get("label"),
            "relative": r.get("rel"),
            "sales": r.get("sales"),
            "operating_income": r.get("op"),
            # 日本基準は経常利益、IFRS・米国基準は税引前利益。基準は accounting_standard を見る
            "pretax_income": r.get("pretax"),
            "net_income": r.get("np"),
            "total_assets": r.get("assets"),
            "equity": r.get("equity"),
            "equity_ratio": r.get("equity_ratio"),
            "eps": r.get("eps"),
            "bps": r.get("bps"),
            "roe": r.get("roe"),
            "per": r.get("per"),
            "dividend_per_share": r.get("dividend"),
            "operating_cash_flow": r.get("ocf"),
            "employees": r.get("employees"),
        }))

    quarterly = [
        _drop_none({
            "disclosed": q.get("date"),
            "period": q.get("period"),
            "doc_type": q.get("doc_type"),
            "sales": q.get("sales"),
            "operating_income": q.get("op"),
            "net_income": q.get("np"),
            "eps": q.get("eps"),
            "forecast_sales": q.get("f_sales"),
            "forecast_operating_income": q.get("f_op"),
            "forecast_net_income": q.get("f_np"),
        })
        for q in d.get("financials", [])
    ]

    out = {
        "code": short(c),
        "name": d.get("name"),
        "name_en": d.get("name_en"),
        "formal_name": d.get("formal_name"),
        "sector33": d.get("s33"),
        "sector17": d.get("s17"),
        "market": d.get("market") or None,
        "edinet_code": d.get("edinet_code"),
        "corporate_number": d.get("corp_number"),
        "fiscal_year_end": d.get("fiscal_year_end"),
        "capital_million_yen": d.get("capital"),
        "website": d.get("site_url"),
        "accounting_standard": d.get("standard"),
        "consolidation": d.get("basis"),
        "annual_report": _drop_none({
            "doc_id": d.get("doc_id"),
            "submitted": d.get("doc_submitted"),
            "results_submitted": d.get("results_submitted"),
        }) or None,
        "latest": _drop_none({
            "period": d.get("period"),
            "sales": d.get("sales"),
            "operating_income": d.get("op"),
            "net_income": d.get("np"),
            "operating_margin": d.get("op_margin"),
            "eps": d.get("eps"),
            "bps": d.get("bps"),
            "equity_ratio": d.get("equity_ratio"),
        }) or None,
        "results": results,
        "quarterly": quarterly,
        "counts": {
            "holdings": d.get("n_holdings", 0),
            "held_by": d.get("n_held_by", 0),
            "sells_to": d.get("n_sells_to", 0),
            "buys_from": d.get("n_buys_from", 0),
        },
        "units": "金額は円。capital_million_yen のみ百万円。比率は小数（0.0832 = 8.32%）",
        "source": SOURCE,
    }
    if not results:
        out["note"] = (
            "この会社の有価証券報告書はまだ取り込めていません。"
            "上場直後、または直近の提出が取り込み対象期間の外にあります"
        )
    return _drop_none(out)


# -------------------------------------------------- 3. 持ち合い・取引関係グラフ

def _holding_rows(rows: list[dict]) -> list[dict]:
    out = []
    for h in rows:
        out.append(_drop_none({
            "code": pub_code(h.get("code")),
            "name": h.get("name") or h.get("raw"),
            "shares": h.get("shares"),
            "book_value_yen": h.get("value"),
            # 有報の原文。ここに「仕入先」「販売先」など取引の性質が書かれている
            "purpose": h.get("purpose"),
            # 「有」なら相手もこちらの株を持っている＝持ち合い
            "mutual": h.get("mutual") == "有" or None,
            "relation": h.get("relation"),
        }))
    return out


@server.tool()
def get_holding_network(code: str, direction: str = "all", limit: int = 40) -> dict:
    """政策保有株・大株主・主要取引先の関係を返す。保有目的の原文つき。

    Args:
        code: 証券コード。
        direction: "holding"（この会社が保有している上場企業）/
                   "held_by"（この会社の株を政策保有している上場企業）/
                   "trade"（仕入先・販売先・業務提携）/
                   "shareholders"（大株主）/ "all"（すべて。既定）。
        limit: 各区分の最大件数。既定40。

    Returns:
        区分ごとの相手方一覧。金額は円、purpose は有報の記載そのまま。
    """
    try:
        c, d = _resolve(code)
    except ValueError as e:
        return {"error": str(e)}

    want = (direction or "all").strip().lower()
    if want not in ("holding", "held_by", "trade", "shareholders", "all"):
        return {"error": f"direction は holding / held_by / trade / shareholders / all です: {direction!r}"}
    limit = max(1, min(int(limit), 100))

    out: dict[str, Any] = {"code": short(c), "name": d.get("name"), "direction": want}

    if want in ("holding", "all"):
        out["holdings"] = _holding_rows(d.get("holdings", [])[:limit])
    if want in ("held_by", "all"):
        out["held_by"] = _holding_rows(d.get("held_by", [])[:limit])
    if want in ("trade", "all"):
        out["trade"] = [
            _drop_none({
                "code": pub_code(t.get("code")),
                "name": t.get("name"),
                "direction": t.get("direction"),   # 仕入先 / 販売先 / 業務提携
                "amount_yen": t.get("amount"),
                "segment": t.get("segment"),
                "note": t.get("note"),
                "source": t.get("source"),
            })
            for t in d.get("trade", [])[:limit]
        ]
    if want in ("shareholders", "all"):
        out["shareholders"] = [
            _drop_none({
                "rank": int(s["rank"]) if s.get("rank") is not None else None,
                "name": s.get("name"),
                "code": pub_code(s.get("code")),
            })
            for s in d.get("shareholders", [])[:limit]
        ]

    out["legend"] = {
        "holdings": "この会社が有報で開示している政策保有株（保有先）",
        "held_by": "この会社の株を政策保有していると開示した上場企業（保有元）",
        "trade": "有報の「主要な顧客ごとの情報」と、政策保有の保有目的から読める取引関係",
        "mutual": "true なら相互に保有＝持ち合い",
    }
    out["source"] = SOURCE
    return _drop_none(out)


# ------------------------------------------------------ 4. サプライズランキング

@server.tool()
def get_surprise_ranking(period: str | None = None, top_k: int = 10) -> dict:
    """決算サプライズ（営業利益進捗のパーセンタイル順位）の上位銘柄を返す。

    Args:
        period: 決算期の絞り込み（"2Q" "3Q" "FY" など、または "2026/03"）。省略時は全期間。
        top_k: 返す件数。既定10、上限100。

    Returns:
        パーセンタイル順位の高い順の銘柄一覧。
    """
    top_k = max(1, min(int(top_k), 100))
    # 書き出しの時点で順位順に並べてある。全社ぶんを読み直す必要はない
    try:
        allrows = _get("surprise.json").get("companies", [])
    except RuntimeError:
        allrows = []

    rows = [
        {
            "code": short(r["code"]),
            "name": r.get("name"),
            "sector33": r.get("s33"),
            "period": r.get("period"),
            "disclosed": r.get("disc_date"),
            # 累計営業利益 ÷ 通期会社予想。四半期で水準が変わるので絶対値は比べられない
            "progress": r.get("progress"),
            # 同日開示内でのパーセンタイル順位。比べられるのはこちら
            "percentile": r.get("pctile"),
            "excess_return": r.get("excess"),
        }
        for r in allrows
        if not period or period in (r.get("period") or "")
    ]

    if not rows:
        # 公開しているデータには、決算サプライズが入っていない。
        # 元になる決算短信は J-Quants 由来で、規約が第三者の閲覧を認めていない。
        return {
            "period": period,
            "count": 0,
            "companies": [],
            "note": (
                "公開データには決算サプライズが含まれていません。"
                "元になる決算短信の数値は J-Quants 由来で、利用規約が第三者の閲覧を"
                "認めていないため配信物から外してあります。"
                "手元に非公開版の書き出し（KABU_MCP_DATA）がある場合のみ値が返ります。"
                "有報ベースの業績推移は get_company_profile から引けます"
            ),
        }

    return {
        "period": period,
        "count": len(rows),
        "companies": [_drop_none(r) for r in rows[:top_k]],
        "legend": {
            "percentile": "同日開示内での営業利益進捗の順位（1.0 が最上位）",
            "progress": "累計営業利益 ÷ 通期会社予想",
            "excess_return": "開示後の市場調整後リターン",
        },
    }


# ---------------------------------------------------------------- 5. 開示・臨報

@server.tool()
def get_disclosures(code: str, days: int = 30) -> dict:
    """直近の開示情報を返す。EDINET の提出書類一覧と、臨時報告書の本文を含む。

    Args:
        code: 証券コード。
        days: 何日ぶん遡るか。既定30、上限365。

    Returns:
        提出書類（filings）、臨時報告書の記載区分と本文（events）、当日の速報（today）。
    """
    try:
        c, d = _resolve(code)
    except ValueError as e:
        return {"error": str(e)}
    days = max(1, min(int(days), 365))
    cutoff = time.strftime("%Y-%m-%d", time.localtime(time.time() - days * 86400))

    def recent(items: list[dict], key: str) -> list[dict]:
        return [x for x in items if (x.get(key) or "")[:10] >= cutoff]

    out: dict[str, Any] = {
        "code": short(c),
        "name": d.get("name"),
        "days": days,
        "since": cutoff,
        "filings": [
            _drop_none({
                "doc_id": f.get("doc_id"),
                "title": f.get("title"),
                "submitted": f.get("submitted"),
                # 画面と同じ本文 PDF への直リンク。鍵が無くても開ける
                "url": f"https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/{f['doc_id']}.pdf"
                if f.get("doc_id") else None,
            })
            for f in recent(d.get("filings", []), "submitted")
        ],
        # 臨時報告書。M&A・主要株主の異動・株主総会決議などが本文つきで入る
        "events": [
            _drop_none({
                "doc_id": e.get("doc_id"),
                "submitted": e.get("submitted"),
                "kind": e.get("kind"),
                "body": e.get("body"),
            })
            for e in recent(d.get("events", []), "submitted")
        ],
        "disclosures": [
            _drop_none({"date": x.get("date"), "title": x.get("title"), "url": x.get("url")})
            for x in recent(d.get("disclosures", []), "date")
        ],
    }

    # 当日ぶんは書き出しに間に合わないので、速報の Worker から足す。
    # 落ちていても他は返す（無い前提で組み立ててある）。
    if STATS:
        try:
            live = _http_json(f"{STATS}/news?code={urllib.parse.quote(c)}", timeout=8)
            items = [
                _drop_none({
                    "title": i.get("title"),
                    "url": i.get("url"),
                    "disclosed_at": i.get("disclosed_at"),
                    "category": i.get("category"),
                    "source": i.get("source"),
                })
                for i in live.get("items", [])
            ]
            if items:
                out["today"] = items
                out["today_crawled_at"] = live.get("crawled_at")
        except (urllib.error.URLError, OSError, json.JSONDecodeError, TypeError):
            pass

    out["source"] = SOURCE
    return _drop_none(out)


def main() -> None:
    server.run()


if __name__ == "__main__":
    main()
