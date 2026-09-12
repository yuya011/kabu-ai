/* 「AIで使う (MCP)」の案内。

   この画面が扱うデータを、対話型AI（Claude / Cursor / VS Code / Gemini）から
   直に引けるようにする。つなぎ方は2つあり、性質がはっきり違う。

     リモート … kabu-ai の Worker（/mcp）に URL でつなぐ。入れるものが無い。
     この端末 … uvx が MCP サーバーを取り寄せて起動する。通信がこちらを通らない。

   どちらが良いかは人によるので、選ばせたうえで違いを書く。既定はリモート。
   入れるものが無く、失敗する余地が少ない。

   さらに Cursor と VS Code は「インストール用リンク」を公開しているので、
   押すだけで入る。Claude と Gemini にはその口が無いため、URL か設定を写してもらう。
   できる相手にはボタンを出し、できない相手には正直に手順を出す。 */

import { useEffect, useRef, useState } from 'react';
import { Bot, Copy, Check, X, Terminal, ExternalLink, Info, Zap, Cloud, Laptop } from 'lucide-react';
import './apple.css';

const REPO = 'https://github.com/yuya011/kabu-ai';
const NAME = 'kabu-ai';

/* 閲覧統計と同じ Worker に同居している。配信先を変えてもここが追随する */
const WORKER = (import.meta.env.VITE_ANALYTICS_URL as string | undefined)
  ?? 'https://kabu-stats.yuya011.workers.dev';
const REMOTE_URL = `${WORKER.replace(/\/$/, '')}/mcp`;

/* uvx は取り寄せと起動を一度にやる。利用者に clone を求めずに済む */
const LOCAL_ARGS = ['--from', `git+${REPO}.git`, 'kabu-mcp'];

/* インストール用リンクに載せる設定。クライアントごとに鍵の名前が違う。

   Cursor  … base64 にした設定を config= に載せる（cursor:// のカスタムスキーム）
   VS Code … URL エンコードした設定を config= に載せる。vscode:// を直に叩かず
             vscode.dev の中継を通すのは、未対応のブラウザで「不明なプロトコル」に
             ならず、案内ページに落ちるため。

   base64 に + や / が出るとクエリとして解かれたときに壊れるが、いまの設定では
   どちらも出ない（生成したリンクを復号し直して確かめてある）ので、
   Cursor のドキュメントどおり素のまま載せている。 */
const cursorLink = (cfg: object) =>
  `cursor://anysphere.cursor-deeplink/mcp/install?name=${NAME}&config=${btoa(JSON.stringify(cfg))}`;
const vscodeLink = (cfg: object) =>
  `https://vscode.dev/redirect/mcp/install?name=${NAME}&config=${encodeURIComponent(JSON.stringify(cfg))}`;

const wrap = (entry: object) => JSON.stringify({ mcpServers: { [NAME]: entry } }, null, 2);

const UV_INSTALL_MAC = 'curl -LsSf https://astral.sh/uv/install.sh | sh';
const UV_INSTALL_WIN = 'powershell -c "irm https://astral.sh/uv/install.ps1 | iex"';

type Mode = 'remote' | 'local';
type ClientId = 'claude' | 'cursor' | 'vscode' | 'gemini';

interface Step {
  /** 押すだけで入る口。持っていない相手もある */
  install?: { href: string; label: string; external: boolean };
  /** 設定ファイルを触らずに済む近道 */
  oneliner?: { label: string; cmd: string };
  /** 画面から入れるときの道順。設定ファイルが要らない相手もある */
  paths?: { os: string; path: string }[];
  config?: string;
  note: string;
}

const CLIENTS: { id: ClientId; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'vscode', label: 'VS Code' },
  { id: 'gemini', label: 'Gemini' },
];

const STEPS: Record<Mode, Record<ClientId, Step>> = {
  remote: {
    claude: {
      oneliner: {
        label: 'Claude Code なら1行で済みます',
        cmd: `claude mcp add --transport http ${NAME} ${REMOTE_URL}`,
      },
      paths: [
        { os: 'Claude Desktop', path: '設定 → コネクタ → カスタムコネクタを追加' },
        { os: 'claude.ai', path: '設定 → コネクタ → カスタムコネクタを追加' },
      ],
      note: '上の URL を貼るだけです。認証は要りません。',
    },
    cursor: {
      install: { href: cursorLink({ url: REMOTE_URL }), label: 'Cursor に追加', external: false },
      paths: [{ os: '手で入れるなら', path: '~/.cursor/mcp.json' }],
      config: wrap({ url: REMOTE_URL }),
      note: 'ボタンを押すと Cursor が開き、追加してよいか確認が出ます。',
    },
    vscode: {
      install: { href: vscodeLink({ type: 'http', url: REMOTE_URL }), label: 'VS Code に追加', external: true },
      paths: [{ os: '手で入れるなら', path: '<プロジェクト>/.vscode/mcp.json' }],
      config: wrap({ type: 'http', url: REMOTE_URL }),
      note: 'ボタンは vscode.dev を経由して VS Code を開きます。.vscode/mcp.json に手で書くときは、いちばん外側の名前が mcpServers ではなく servers になります。',
    },
    gemini: {
      paths: [
        { os: '全体に効かせる', path: '~/.gemini/settings.json' },
        { os: 'このプロジェクトだけ', path: '<プロジェクト>/.gemini/settings.json' },
      ],
      config: wrap({ httpUrl: REMOTE_URL }),
      note: 'Gemini CLI は url ではなく httpUrl で Streamable HTTP につなぎます。',
    },
  },
  local: {
    claude: {
      oneliner: { label: 'Claude Code なら1行で済みます', cmd: `claude mcp add ${NAME} -- uvx ${LOCAL_ARGS.join(' ')}` },
      paths: [
        { os: 'macOS', path: '~/Library/Application Support/Claude/claude_desktop_config.json' },
        { os: 'Windows', path: '%APPDATA%\\Claude\\claude_desktop_config.json' },
      ],
      config: wrap({ command: 'uvx', args: LOCAL_ARGS }),
      note: 'Claude Desktop は 設定 → 開発者 → 設定ファイルを編集 から開けます。貼り付けたら再起動してください。',
    },
    cursor: {
      install: {
        href: cursorLink({ type: 'stdio', command: 'uvx', args: LOCAL_ARGS }),
        label: 'Cursor に追加', external: false,
      },
      paths: [{ os: '手で入れるなら', path: '~/.cursor/mcp.json' }],
      config: wrap({ command: 'uvx', args: LOCAL_ARGS }),
      note: 'ボタンを押すと Cursor が開き、追加してよいか確認が出ます。',
    },
    vscode: {
      install: {
        href: vscodeLink({ type: 'stdio', command: 'uvx', args: LOCAL_ARGS }),
        label: 'VS Code に追加', external: true,
      },
      paths: [{ os: '手で入れるなら', path: '<プロジェクト>/.vscode/mcp.json' }],
      config: wrap({ command: 'uvx', args: LOCAL_ARGS }),
      note: '.vscode/mcp.json に手で書くときは、いちばん外側の名前が mcpServers ではなく servers になります。',
    },
    gemini: {
      paths: [
        { os: '全体に効かせる', path: '~/.gemini/settings.json' },
        { os: 'このプロジェクトだけ', path: '<プロジェクト>/.gemini/settings.json' },
      ],
      config: wrap({ command: 'uvx', args: LOCAL_ARGS }),
      note: '既に settings.json がある場合は、mcpServers の中身だけを足してください。',
    },
  },
};

/* 引ける5つの道具。何が返るかを1行で書いておくと、
   利用者が「これは聞いていいのか」を迷わずに済む。 */
const TOOLS: [string, string][] = [
  ['search_company', '社名・証券コード・業種で銘柄を引く'],
  ['get_company_profile', '有報「主要な経営指標等の推移」による5期の業績'],
  ['get_holding_network', '政策保有株・大株主・主要取引先（保有目的の原文つき）'],
  ['get_surprise_ranking', '決算サプライズの上位銘柄'],
  ['get_disclosures', 'EDINET の提出書類と臨時報告書の本文'],
];

/* そのまま貼れる質問。値打ちが分かるのは、1銘柄で終わらない問いである。 */
const RECIPES: string[] = [
  'キーエンスが政策保有している上場企業と、その保有目的を一覧にして。持ち合い（相互保有）になっている先には印を付けて。',
  'トヨタ自動車の仕入先として有報に名前が出ている上場企業を挙げて、それぞれの直近の営業利益率と一緒に表にして。',
  '半導体関連の主要銘柄について、直近5期の売上と営業利益の推移を比べて、伸びが鈍っている会社を指摘して。',
  'ニトリホールディングスの直近1年の臨時報告書を読んで、内容を時系列で要約して。',
  '銀行業の中で、政策保有株を多く抱えている会社を調べて、保有目的の書きぶりの違いを比べて。',
];

/** 押すと写す。写せたことを2秒だけ見せる。 */
function CopyBtn({ text, label = 'コピー' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;   // 権限が無い環境では黙って何もしない。選択してコピーはできる
    }
    setDone(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 2000);
  };

  return (
    <button className="ap-btn" onClick={copy} style={done ? { color: 'var(--green)' } : undefined}>
      {done ? <Check size={12} /> : <Copy size={12} />}
      <span style={{ marginLeft: 5 }}>{done ? 'コピーしました' : label}</span>
    </button>
  );
}

/** コードの塊。右上にコピーを置く。 */
function Code({ text, label }: { text: string; label?: string }) {
  return (
    <div className="ap-codeblock">
      <div className="ap-codeblock-head">
        <span className="ap-caption">{label}</span>
        <CopyBtn text={text} />
      </div>
      <pre className="ap-code">{text}</pre>
    </div>
  );
}

export default function McpModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('remote');
  const [client, setClient] = useState<ClientId>('claude');
  const step = STEPS[mode][client];

  // Esc で閉じる。開いている間は後ろを動かさない
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="ap ap-backdrop" onClick={onClose}>
      <div className="ap-modal" role="dialog" aria-modal="true" aria-label="AIで使う (MCP)"
        onClick={(e) => e.stopPropagation()}>

        <div className="ap-modal-head">
          <Bot size={18} style={{ color: 'var(--blue)' }} />
          <div style={{ flex: 1 }}>
            <div className="ap-title3">AIで使う (MCP)</div>
            <div className="ap-caption">この画面のデータを対話型AIから直に引く</div>
          </div>
          <button className="ap-iconbtn" aria-label="閉じる" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="ap-modal-body">
          <p className="ap-footnote" style={{ lineHeight: 1.7 }}>
            つなぐと、対話型AIから有価証券報告書のデータを直に引けるようになります。
            銘柄検索・5期の業績・政策保有の関係・臨時報告書の本文を、AIが必要なぶんだけ取りにいきます。
          </p>

          <div className="ap-modal-sec">
            <div className="ap-modal-sec-title">1. つなぎ方を選ぶ</div>
            <div className="ap-modal-modes">
              <button className="ap-modecard" data-on={mode === 'remote'} onClick={() => setMode('remote')}>
                <span className="ap-modecard-head"><Cloud size={14} /> リモート</span>
                <span className="ap-caption">URL を渡すだけ。入れるものはありません</span>
              </button>
              <button className="ap-modecard" data-on={mode === 'local'} onClick={() => setMode('local')}>
                <span className="ap-modecard-head"><Laptop size={14} /> この端末で動かす</span>
                <span className="ap-caption">uv が要る代わりに、通信がこちらを通りません</span>
              </button>
            </div>
          </div>

          {mode === 'remote' ? (
            <div className="ap-modal-sec">
              <div className="ap-modal-sec-title">2. この URL につなぐ</div>
              <Code text={REMOTE_URL} label="MCP サーバー（認証不要）" />
            </div>
          ) : (
            <div className="ap-modal-sec">
              <div className="ap-modal-sec-title">2. uv を入れる（初回のみ）</div>
              <p className="ap-footnote" style={{ marginBottom: 8 }}>
                サーバーの取り寄せと起動は <code className="ap-inline-code">uvx</code> が行います。
                uv に含まれているので、入っていなければ端末で1行流してください。
              </p>
              <Code text={UV_INSTALL_MAC} label="macOS / Linux" />
              <Code text={UV_INSTALL_WIN} label="Windows (PowerShell)" />
            </div>
          )}

          <div className="ap-modal-sec">
            <div className="ap-modal-sec-title">3. クライアントに登録する</div>

            <div className="ap-segmented" style={{ marginBottom: 12 }}>
              {CLIENTS.map((c) => (
                <button key={c.id} className="ap-seg" data-on={client === c.id}
                  onClick={() => setClient(c.id)}>{c.label}</button>
              ))}
            </div>

            {step.install && (
              <div className="ap-modal-install">
                <a className="ap-action-primary" href={step.install.href}
                  {...(step.install.external ? { target: '_blank', rel: 'noreferrer' } : {})}>
                  <Zap size={13} /> {step.install.label}
                </a>
                <span className="ap-caption">押すだけで入ります</span>
              </div>
            )}

            {step.paths && (
              <div className="ap-kv" style={{ marginBottom: step.config ? 8 : 0 }}>
                {step.paths.map((p) => (
                  <div key={p.path} className="ap-modal-path">
                    <span className="ap-caption" style={{ minWidth: 108 }}>{p.os}</span>
                    <code className="ap-inline-code" style={{ flex: 1 }}>{p.path}</code>
                  </div>
                ))}
              </div>
            )}

            {step.oneliner && (
              <>
                <p className="ap-footnote" style={{ margin: '10px 0 6px', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Terminal size={12} /> {step.oneliner.label}
                </p>
                <Code text={step.oneliner.cmd} label="端末で実行" />
              </>
            )}

            {step.config && (
              step.install ? (
                <details className="ap-modal-fold">
                  <summary className="ap-footnote">手で設定する場合</summary>
                  <div style={{ marginTop: 8 }}><Code text={step.config} label="貼り付ける内容" /></div>
                </details>
              ) : (
                <Code text={step.config} label="貼り付ける内容" />
              )
            )}

            <p className="ap-footnote" style={{ marginTop: 10, lineHeight: 1.7 }}>{step.note}</p>
          </div>

          <div className="ap-modal-sec">
            <div className="ap-modal-sec-title">4. こんな質問ができます</div>
            <div className="ap-card" style={{ marginBottom: 10 }}>
              {RECIPES.map((r) => (
                <div key={r} className="ap-row" style={{ alignItems: 'flex-start', gap: 10 }}>
                  <span className="ap-footnote" style={{ flex: 1, lineHeight: 1.65 }}>{r}</span>
                  <CopyBtn text={r} label="写す" />
                </div>
              ))}
            </div>
            <div className="ap-card">
              {TOOLS.map(([name, what]) => (
                <div key={name} className="ap-row" style={{ gap: 10 }}>
                  <code className="ap-inline-code" style={{ minWidth: 168 }}>{name}</code>
                  <span className="ap-footnote" style={{ flex: 1 }}>{what}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="ap-modal-note">
            <Info size={13} style={{ flex: '0 0 13px', marginTop: 2 }} />
            <div className="ap-footnote" style={{ lineHeight: 1.7 }}>
              {mode === 'remote' ? (
                <>
                  リモートでは、AI からの問い合わせが kabu-ai の Worker を通ります。
                  銘柄コードはそこを通りますが、<strong>利用者を区別する値は受け取らず、
                  問い合わせの記録も残していません</strong>（閲覧統計とは別の口です）。
                  通したくない場合は「この端末で動かす」を選んでください。
                  そちらは端末から配信元へ直接出るので、こちらを一切通りません。
                </>
              ) : (
                <>
                  サーバーはこの端末で動き、サイトと同じ公開データを直接読みます。
                  こちらに中継は無く、何を引いたかがこちら側に残ることはありません。
                </>
              )}
              <br />
              出典は EDINET（金融庁）の有価証券報告書です。
              決算短信ベースの決算サプライズは、出所の利用規約により公開データには含めていません。
              <br />
              <a href={REPO} target="_blank" rel="noreferrer"
                style={{ color: 'var(--blue)', display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
                ソースと詳しい説明 <ExternalLink size={11} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
