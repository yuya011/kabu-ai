"""社名検索の表記ゆれを吸収する。

画面（frontend/src/browser/nameKey.ts）とリモート MCP（worker/nameKey.js）に
同じ処理の写しがある。書き出し側が作った検索キーと、利用者が打った文字を
同じ規則で潰して突き合わせるので、3つのどれかだけ変えると一致しなくなる。
変えたら scripts/check_name_key.mjs で揃っているか確かめる。

拾いたいゆれ:
  ・ひらがな／カタカナ／半角、キャノン／キヤノン、フィルム／フイルム
  ・髙島屋／高島屋、野村證券／野村証券 のような旧字
  ・株式会社・Co., Ltd. の有無、中黒・長音・空白の有無
  ・ヨミ（とよた）、英字社名（toyota）、英字の頭文字（NTT, JT）
  ・HD／G／FG の略記、東電・野村総研のような詰めた略称（照合側で扱う）
  ・言い換えられた通称（ユニクロ、JR東日本）は ALIASES に手で持つ

標準ライブラリだけで書く。MCP サーバーの配布物（src/）にそのまま入るため。
"""

from __future__ import annotations

import re
import unicodedata
from functools import lru_cache

_SMALL = str.maketrans("ァィゥェォッャュョヮヵヶヴ", "アイウエオツヤユヨワカケブ")

# 旧字・異体字 → 常用の字。社名に出てくるものだけ
_VARIANTS = str.maketrans(
    "髙﨑嵜齋齊斉澤邊邉濱眞德櫻廣國藏證會豐鐵驛實惠榮壽淺條寶萬彌圓學氣團龜",
    "高崎崎斎斎斎沢辺辺浜真徳桜広国蔵証会豊鉄駅実恵栄寿浅条宝万弥円学気団亀",
)

_JA_FORMS = ("株式会社", "有限会社", "合同会社", "合資会社", "合名会社",
             "(株)", "(有)", "カブシキガイシヤ", "カブシキカイシヤ", "ユウゲンガイシヤ",
             "ゴウドウガイシヤ")

_EN_FORMS = re.compile(
    r"(?<![a-z0-9])(co|ltd|inc|corp|corporation|incorporated|limited|company|"
    r"kabushiki|kaisha|kk|plc|llc)(?![a-z0-9])")

# 頭文字を取るときに飛ばす語
_EN_STOP = {"and", "of", "the", "&"}


@lru_cache(maxsize=16384)
def norm(s: str) -> str:
    """検索用に潰した形。打たれた文字と社名の両方にかける。
    MCP は検索のたびに上場全社の社名を通すので、結果を控えておく。"""
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s).lower()
    s = "".join(chr(ord(ch) + 0x60) if "ぁ" <= ch <= "ゖ" else ch for ch in s)
    s = s.translate(_SMALL).translate(_VARIANTS)
    for f in _JA_FORMS:
        s = s.replace(f, "")
    s = _EN_FORMS.sub("", s)
    # 文字と数字だけ残す。長音は「ユーザー／ユーザ」の揺れが多いので落とす
    return "".join(ch for ch in s
                   if ch != "ー" and unicodedata.category(ch)[0] in "LN")


def _en_words(en: str) -> list[str]:
    s = unicodedata.normalize("NFKC", en).lower()
    s = _EN_FORMS.sub(" ", s)
    return [w for w in re.split(r"[^a-z0-9&]+", s) if w and w not in _EN_STOP]


# 名前から辿れない通称。キーは4桁の証券コード
ALIASES: dict[str, tuple[str, ...]] = {
    "9020": ("JR東日本",),
    "9021": ("JR西日本",),
    "9022": ("JR東海",),
    "9142": ("JR九州",),
    "9432": ("日本電信電話",),
    "9201": ("JAL",),
    "9202": ("全日空", "全日本空輸"),
    "9983": ("ユニクロ", "UNIQLO", "ジーユー"),
    "3382": ("セブンイレブン", "イトーヨーカドー"),
    "8306": ("MUFG", "三菱UFJ銀行"),
    "8316": ("SMBC", "三井住友銀行"),
    "8411": ("みずほ銀行",),
    "9433": ("au",),
    "4689": ("ヤフー", "Yahoo", "LINE"),
    "9101": ("NYK",),
    "9104": ("MOL",),
    "7453": ("無印良品", "MUJI"),
    "3563": ("スシロー",),
    "7550": ("すき家",),
    "4661": ("ディズニー", "東京ディズニーランド"),
    "9064": ("クロネコヤマト", "ヤマト運輸"),
    "9147": ("日本通運", "日通"),
    "5401": ("日鉄", "新日鉄", "新日鉄住金"),
    "8604": ("野村證券",),
    "9501": ("東電", "TEPCO"),
    "9503": ("関電",),
    "2702": ("マクドナルド", "マック"),
    "3197": ("ガスト",),
    "9684": ("スクエニ",),
    "7832": ("バンナム",),
    "9041": ("近鉄", "近畿日本鉄道"),
    "9048": ("名鉄",),
}


def _short_forms(key: str) -> list[str]:
    """「〜ホールディングス」を HD と無しに、「〜グループ」を G に。norm 後の形で置き換える。"""
    out = []
    for long, abbr in (("ホルデイングス", "hd"), ("フイナンシヤルグルプ", "fg"),
                       ("グルプ", "g")):
        if long in key and not (abbr == "g" and "フイナンシヤルグルプ" in key):
            out.append(key.replace(long, abbr))
            bare = key.replace(long, "")
            if len(bare) >= 2:
                out.append(bare)
    return out


def search_keys(code: str, name: str, reading: str = "", english: str = "") -> tuple[str, str]:
    """検索キーを2本の文字列で返す。

    1本目は部分一致・前方一致に使う語（ヨミ・英字社名・略記・通称）、
    2本目は完全一致だけに使う語（英字の頭文字。2〜3文字だと他社の社名に紛れるため）。
    どちらも空白区切り。社名そのものは照合側で norm するので入れない。
    """
    base = norm(name)
    loose: list[str] = [*_short_forms(base)]
    r = norm(reading)
    if r and r != base:
        loose.append(r)
    words = _en_words(english or "")
    e = norm(" ".join(words))
    if e and e != base:
        loose.append(e)
    loose += [norm(a) for a in ALIASES.get(code[:4], ())]

    exact = []
    if len(words) >= 2:
        ini = "".join(w[0] for w in words if w[0].isalnum())
        if 2 <= len(ini) <= 5 and ini != base:
            exact.append(ini)

    seen = {base}
    uniq = [k for k in loose if k and not (k in seen or seen.add(k))]
    return " ".join(uniq), " ".join(exact)


# ---------------------------------------------------------------- 照合

def _subseq_span(q: str, key: str) -> int | None:
    """q が key の頭から順に拾えるなら、拾うのにかかった幅。「東電」→「東京電力」は 3。
    日本語の略称は頭の字を残して詰めるので、頭の字が合うものだけを見る。"""
    if len(q) < 2 or not key or key[0] != q[0]:
        return None
    i = 0
    for j, ch in enumerate(key):
        if ch == q[i]:
            i += 1
            if i == len(q):
                return j + 1
    return None


def _bigrams(s: str) -> set[str]:
    return {s[i:i + 2] for i in range(len(s) - 1)}


def _dice(a: str, b: str) -> float:
    x, y = _bigrams(a), _bigrams(b)
    return 2 * len(x & y) / (len(x) + len(y)) if x and y else 0.0


def match(q: str, base: str, loose: str, exact: str) -> tuple[int, float] | None:
    """(順位, 同順位内の並び) を返す。小さいほど上。一致しなければ None。
    q・base は norm 済み。loose / exact は search_keys の返り値。

      0 社名・通称・ヨミ・英字名、英字の頭文字と完全一致
      1 前方一致
      2 部分一致
      3 略称（頭の字を残して詰めたもの）
      4 綴りの近いもの（打ち間違い）
    """
    keys = [base, *loose.split()] if loose else [base]
    if q in keys:
        return (0, 0)
    if exact and q in exact.split():
        return (0, 1)
    if any(k.startswith(q) for k in keys):
        return (1, 0)
    if any(q in k for k in keys):
        return (2, 0)
    # 英字は詰めた略称を作らない。2〜3文字の英字で拾うと無関係な社名が大量に掛かる
    if not q.isascii():
        spans = [s for k in keys if (s := _subseq_span(q, k)) is not None]
        if spans:
            return (3, min(spans) - len(q))
    if len(q) >= 3:
        # 頭から同じくらいの長さを切って比べる。社名全体と比べると、長い社名ほど不利になる
        best = max(_dice(q, k[:len(q) + d]) for k in keys for d in (-1, 0, 1))
        if best >= 0.5:
            return (4, -best)
    return None
