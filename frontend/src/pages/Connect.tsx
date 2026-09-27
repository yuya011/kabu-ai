/* AI とつなぐ（MCP）。

   この画面が扱うデータを、対話型AI（Claude / Cursor / VS Code / Gemini）から
   直に引けるようにする。つなぎ方は2つあり、性質がはっきり違う。

     リモート … Keiretsu の Worker（/mcp）に URL でつなぐ。入れるものが無い。
     この端末 … uvx が MCP サーバーを取り寄せて起動する。通信がこちらを通らない。

   以前はかぶせ（モーダル）だったが、手順を読みながら別のアプリへ貼りに行く用途で、
   閉じると最初からやり直しになるのが不便だった。ナビから行ける1ページにした。

   Cursor と VS Code は「インストール用リンク」を公開しているので押すだけで入る。
   Claude と Gemini にはその口が無いため、URL か設定を写してもらう。 */

import { useEffect, useRef, useState } from 'react';
import {
  Button, Card, TabList, Tab, Link, Accordion, AccordionItem, AccordionHeader, AccordionPanel,
  MessageBar, MessageBarBody,
} from '@fluentui/react-components';
import {
  Copy16Regular, Checkmark16Regular, CloudLink20Regular, Laptop20Regular, Flash20Regular,
  Open16Regular, Code20Regular, Chat20Regular, ShieldCheckmark20Regular,
} from '@fluentui/react-icons';
import { McpDiagram } from '../ui/art';
import { SectionTitle } from '../ui/common';

const REPO = 'https://github.com/yuya011/kabu-ai';
const NAME = 'kabu-ai';

/* 閲覧統計と同じ Worker に同居している。配信先を変えてもここが追随する */
const WORKER = (import.meta.env.VITE_ANALYTICS_URL as string | undefined) ?? 'https://kabu-stats.yuya011.workers.dev';
const REMOTE_URL = `${WORKER.replace(/\/$/, '')}/mcp`;

/* uvx は取り寄せと起動を一度にやる。利用者に clone を求めずに済む */
const LOCAL_ARGS = ['--from', `git+${REPO}.git`, 'kabu-mcp'];

/* Cursor … base64 にした設定を config= に載せる（cursor:// のカスタムスキーム）
   VS Code … URL エンコードした設定を config= に載せる。vscode.dev の中継を通すのは、
             未対応のブラウザで「不明なプロトコル」にならず、案内ページに落ちるため。 */
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
  install?: { href: string; label: string; external: boolean };
  oneliner?: { label: string; cmd: string };
  paths?: { os: string; path: string }[];
  config?: string;
  note: string;
}

const CLIENTS: { id: ClientId; label: string }[] = [
  { id: 'claude', label: 'Claude' }, { id: 'cursor', label: 'Cursor' },
  { id: 'vscode', label: 'VS Code' }, { id: 'gemini', label: 'Gemini' },
];

const STEPS: Record<Mode, Record<ClientId, Step>> = {
  remote: {
    claude: {
      oneliner: { label: 'Claude Code なら1行で済みます', cmd: `claude mcp add --transport http ${NAME} ${REMOTE_URL}` },
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
      install: { href: cursorLink({ type: 'stdio', command: 'uvx', args: LOCAL_ARGS }), label: 'Cursor に追加', external: false },
      paths: [{ os: '手で入れるなら', path: '~/.cursor/mcp.json' }],
      config: wrap({ command: 'uvx', args: LOCAL_ARGS }),
      note: 'ボタンを押すと Cursor が開き、追加してよいか確認が出ます。',
    },
    vscode: {
      install: { href: vscodeLink({ type: 'stdio', command: 'uvx', args: LOCAL_ARGS }), label: 'VS Code に追加', external: true },
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

const TOOLS: [string, string][] = [
  ['search_company', '社名・証券コード・業種で銘柄を引く'],
  ['get_company_profile', '有報「主要な経営指標等の推移」による5期の業績'],
  ['get_holding_network', '政策保有株・大株主・主要取引先（保有目的の原文つき）'],
  ['get_surprise_ranking', '決算サプライズの上位銘柄'],
  ['get_disclosures', 'EDINET の提出書類と臨時報告書の本文'],
];

/* 値打ちが分かるのは、1銘柄で終わらない問いである */
const RECIPES: string[] = [
  'キーエンスが政策保有している上場企業と、その保有目的を一覧にして。持ち合い（相互保有）になっている先には印を付けて。',
  'トヨタ自動車の仕入先として有報に名前が出ている上場企業を挙げて、それぞれの直近の営業利益率と一緒に表にして。',
  '半導体関連の主要銘柄について、直近5期の売上と営業利益の推移を比べて、伸びが鈍っている会社を指摘して。',
  'ニトリホールディングスの直近1年の臨時報告書を読んで、内容を時系列で要約して。',
  '銀行業の中で、政策保有株を多く抱えている会社を調べて、保有目的の書きぶりの違いを比べて。',
];

function CopyBtn({ text, label = 'コピー' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <Button size="small" appearance={done ? 'primary' : 'secondary'}
      icon={done ? <Checkmark16Regular /> : <Copy16Regular />}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch { return; }
        setDone(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setDone(false), 2000);
      }}>
      {done ? 'コピーしました' : label}
    </Button>
  );
}

function Code({ text, label }: { text: string; label?: string }) {
  return (
    <div className="k-code">
      <div className="k-code-head"><span className="k-caption">{label}</span><CopyBtn text={text} /></div>
      <pre>{text}</pre>
    </div>
  );
}

export default function Connect() {
  const [mode, setMode] = useState<Mode>('remote');
  const [client, setClient] = useState<ClientId>('claude');
  const step = STEPS[mode][client];

  return (
    <div className="k-page k-connect">
      <header className="k-pagehead">
        <div>
          <h1 className="k-title">AI とつなぐ</h1>
          <p className="k-lead">
            MCP（Model Context Protocol）でつなぐと、対話型AIがこのサイトのデータを直に引けるようになります。
            銘柄検索・5期の業績・政策保有の関係・臨時報告書の本文を、AI が必要なぶんだけ取りにいきます。
          </p>
        </div>
      </header>

      <Card className="k-card k-mcp-hero">
        <McpDiagram />
      </Card>

      <div className="k-connect-grid">
        <div className="k-stack">
          <Card className="k-card">
            <SectionTitle icon={<span className="k-step">1</span>} title="つなぎ方を選ぶ" />
            <div className="k-modes" role="radiogroup" aria-label="つなぎ方">
              <button className="k-mode" role="radio" aria-checked={mode === 'remote'} data-on={mode === 'remote'} onClick={() => setMode('remote')}>
                <span className="k-mode-head"><CloudLink20Regular /> リモート <span className="k-mode-rec">おすすめ</span></span>
                <span className="k-caption">URL を渡すだけ。入れるものはありません</span>
              </button>
              <button className="k-mode" role="radio" aria-checked={mode === 'local'} data-on={mode === 'local'} onClick={() => setMode('local')}>
                <span className="k-mode-head"><Laptop20Regular /> この端末で動かす</span>
                <span className="k-caption">uv が要る代わりに、通信がこちらを通りません</span>
              </button>
            </div>
          </Card>

          <Card className="k-card">
            {mode === 'remote' ? (
              <>
                <SectionTitle icon={<span className="k-step">2</span>} title="この URL につなぐ" />
                <Code text={REMOTE_URL} label="MCP サーバー（認証不要）" />
              </>
            ) : (
              <>
                <SectionTitle icon={<span className="k-step">2</span>} title="uv を入れる（初回のみ）"
                  note={<>サーバーの取り寄せと起動は <code>uvx</code> が行います。入っていなければ端末で1行流してください。</>} />
                <Code text={UV_INSTALL_MAC} label="macOS / Linux" />
                <Code text={UV_INSTALL_WIN} label="Windows（PowerShell）" />
              </>
            )}
          </Card>

          <Card className="k-card">
            <SectionTitle icon={<span className="k-step">3</span>} title="クライアントに登録する" />
            <TabList selectedValue={client} onTabSelect={(_, d) => setClient(d.value as ClientId)} style={{ marginBottom: 12 }}>
              {CLIENTS.map((c) => <Tab key={c.id} value={c.id}>{c.label}</Tab>)}
            </TabList>

            {step.install && (
              <div className="k-install">
                <Button appearance="primary" icon={<Flash20Regular />} as="a" href={step.install.href}
                  {...(step.install.external ? { target: '_blank', rel: 'noreferrer' } : {})}>
                  {step.install.label}
                </Button>
                <span className="k-caption">押すだけで入ります</span>
              </div>
            )}

            {step.paths && (
              <div className="k-paths">
                {step.paths.map((p) => (
                  <div key={p.os} className="k-path-row">
                    <span className="k-caption">{p.os}</span>
                    <code>{p.path}</code>
                  </div>
                ))}
              </div>
            )}

            {step.oneliner && (
              <>
                <div className="k-caption" style={{ margin: '12px 0 6px' }}>{step.oneliner.label}</div>
                <Code text={step.oneliner.cmd} label="端末で実行" />
              </>
            )}

            {step.config && (step.install ? (
              <Accordion collapsible>
                <AccordionItem value="manual">
                  <AccordionHeader size="small" icon={<Code20Regular />}>手で設定する場合</AccordionHeader>
                  <AccordionPanel><Code text={step.config} label="貼り付ける内容" /></AccordionPanel>
                </AccordionItem>
              </Accordion>
            ) : <Code text={step.config} label="貼り付ける内容" />)}

            <p className="k-note">{step.note}</p>
          </Card>
        </div>

        <div className="k-stack">
          <Card className="k-card">
            <SectionTitle icon={<Chat20Regular />} title="こんな質問ができます" note="1銘柄で終わらない問いほど、つないだ値打ちが出ます" />
            {RECIPES.map((r) => (
              <div key={r} className="k-recipe">
                <span>{r}</span>
                <CopyBtn text={r} label="写す" />
              </div>
            ))}
          </Card>
          <Card className="k-card">
            <SectionTitle icon={<Code20Regular />} title="AI が呼べる道具" />
            {TOOLS.map(([name, what]) => (
              <div key={name} className="k-tool">
                <code>{name}</code>
                <span className="k-caption">{what}</span>
              </div>
            ))}
          </Card>
          <MessageBar intent="info" icon={<ShieldCheckmark20Regular />} layout="multiline">
            <MessageBarBody>
              {mode === 'remote' ? (
                <>
                  リモートでは、AI からの問い合わせが Worker を通ります。銘柄コードはそこを通りますが、
                  利用者を区別する値は受け取らず、問い合わせの記録も残していません。
                  通したくない場合は「この端末で動かす」を選んでください。
                </>
              ) : (
                <>サーバーはこの端末で動き、サイトと同じ公開データを直接読みます。こちらに中継は無く、何を引いたかが残ることはありません。</>
              )}
              {' '}出典は EDINET（金融庁）の有価証券報告書です。{' '}
              <Link href={REPO} target="_blank" rel="noreferrer" inline>ソースと詳しい説明 <Open16Regular style={{ verticalAlign: -3 }} /></Link>
            </MessageBarBody>
          </MessageBar>
        </div>
      </div>
    </div>
  );
}
