import { useEffect, useState } from 'react';
import {
  ArrowLeft, Search as SearchIcon, Sparkles, Database, Check, Loader2,
  Trash2, ExternalLink, Info, Contrast, Eye, ShieldCheck, AlertTriangle,
  BellRing, X,
} from 'lucide-react';
import './apple.css';
import { clearCache, loadIndex } from './cache';
import * as push from './push';
import type { BrowserIndex } from './types';
import { verifyKey, PROVIDERS, PROVIDER_ORDER, type Provider } from './ai';
import {
  useSettings, updateSettings, resetSettings, getApiKey, setApiKey, maskKey,
  FONT_SCALES, ENGINES, type Theme,
} from '../settings';

function Section({ icon, title, note, children }: {
  icon: React.ReactNode; title: string; note?: string; children: React.ReactNode;
}) {
  return (
    <div className="ap-card" style={{ marginBottom: 16 }}>
      <div className="ap-card-head">
        <span className="sec" style={{ display: 'flex' }}>{icon}</span>
        <span className="ap-title3">{title}</span>
      </div>
      {note && (
        <div className="ap-footnote" style={{ padding: '10px 16px 0', lineHeight: 1.6 }}>
          {note}
        </div>
      )}
      {children}
    </div>
  );
}

/** 設定1件の行。左に名前と説明、右に操作を置く。 */
function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="ap-row" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 150, flex: 1 }}>
        <div className="ap-headline">{label}</div>
        {hint && (
          <div className="ap-footnote" style={{ marginTop: 3, lineHeight: 1.55 }}>{hint}</div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {children}
      </div>
    </div>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className="ap-switch" role="switch" aria-checked={on} data-on={on}
      onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

function Choice<T extends string | number>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="ap-segmented">
      {options.map((o) => (
        <button key={String(o.value)} className="ap-seg" data-on={value === o.value}
          onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/* ---------------- 通知 ----------------

   端末が対応していて、かつサーバ側に鍵が入っているときだけ出す。
   できないことを画面に出しても、押せるものが増えるわけではない。 */

function NotifySection() {
  const codes = push.useWatch();
  const [state, setState] = useState<push.PushState>('unsupported');
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => { push.state().then(setState); }, []);

  // 銘柄コードだけ並べても読めない。索引は端末に入っているので引くのは安い
  useEffect(() => {
    if (!codes.length) return;
    loadIndex<BrowserIndex>(`${import.meta.env.BASE_URL}data/browser/index.json`)
      .then((ix) => setNames(Object.fromEntries(ix.nodes.map(([c, n]) => [c, n]))))
      .catch(() => { /* 名前が出ないだけ。コードは出る */ });
  }, [codes.length]);

  // サーバ側に鍵が無い構成では、欄ごと出さない
  if (state === 'unavailable') return null;

  const toggle = async (on: boolean) => {
    setBusy(true);
    if (on) setState(await push.enable());
    else { await push.disable(); setState('off'); }
    setBusy(false);
  };

  return (
    <Section icon={<BellRing size={13} />} title="通知">
      {state === 'unsupported' ? (
        <div className="ap-row" style={{ display: 'block', lineHeight: 1.75 }}>
          <div className="ap-footnote">
            この端末では通知を使えません。iPhone・iPad では、Safari の共有メニューから
            <b>ホーム画面に追加</b>して、そこから開いたときだけ通知を受け取れます（iOS 16.4 以降）。
          </div>
        </div>
      ) : (
        <>
          <Field label="重要な開示を通知する"
            hint="下に並べた銘柄に臨時報告書・大量保有報告書・公開買付の届出が出たときだけ鳴らします。有価証券報告書や四半期報告書は日程の決まった定期開示なので対象にしていません。決算短信は TDnet 側にしかなく、いまは取得していません。">
            <Switch on={state === 'on'} onChange={(v) => !busy && toggle(v)} />
          </Field>

          {state === 'denied' && (
            <div className="ap-row" style={{ display: 'block' }}>
              <div className="ap-footnote">
                <AlertTriangle size={11} style={{ verticalAlign: -1, marginRight: 4, color: 'var(--orange)' }} />
                ブラウザ側で通知が拒否されています。サイトの設定から許可し直してください。
              </div>
            </div>
          )}

          <Field label="通知する銘柄"
            hint={codes.length
              ? '銘柄の画面のベルからも出し入れできます。'
              : 'まだありません。銘柄の画面の右上にあるベルから追加します。'}>
            <span className="ap-num sec">{codes.length} 社</span>
          </Field>

          {codes.map((c) => (
            <div key={c} className="ap-row">
              <span className="ap-num ter" style={{ fontSize: 11, width: 40 }}>{c}</span>
              <span className="ap-body">{names[c] ?? '—'}</span>
              <button className="ap-iconbtn" title="外す" aria-label="外す"
                style={{ marginLeft: 'auto' }}
                onClick={() => push.toggleWatch(c)}>
                <X size={12} />
              </button>
            </div>
          ))}

          <div className="ap-row" style={{ display: 'block', lineHeight: 1.75 }}>
            <div className="ap-footnote">
              預けるのは「この購読で、この銘柄を鳴らす」という組だけです。
              購読の宛先はブラウザの配信元が発行する URL で、こちらから利用者を特定する
              材料にはなりません。通知を切れば、その控えも消します。
            </div>
          </div>
        </>
      )}
    </Section>
  );
}

/* ---------------- Gemini のキー ---------------- */

function ApiKeyField({ provider, model }: { provider: Provider; model: string }) {
  const spec = PROVIDERS[provider];
  const saved = getApiKey(provider);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'ok' | string>('idle');

  // 提供元を切り替えたら、前の欄の状態を持ち越さない
  useEffect(() => { setEditing(false); setDraft(''); setState('idle'); }, [provider]);

  const save = async () => {
    const key = draft.trim();
    if (!key) return;
    setState('checking');
    try {
      await verifyKey(provider, key, model);
      setApiKey(provider, key);
      // 鍵を入れたのは使うためなので、答えの出し方も合わせて切り替える。
      // 「開く」に戻したければ下の欄で選び直せる。
      updateSettings({ aiMode: 'inapp' });
      setDraft('');
      setEditing(false);
      setState('ok');
      setTimeout(() => setState('idle'), 2600);
    } catch (e) {
      setState(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <Field label={`${spec.label} の API キー`}
        hint={saved && !editing
          ? 'この端末にだけ保存されています。ほかの端末には引き継がれません。'
          : `${spec.keyHint}貼り付けると疎通を確かめてから保存します。`}>
        {saved && !editing ? (
          <>
            <span className="ap-num sec" style={{ fontSize: 12 }}>{maskKey(saved)}</span>
            <button className="ap-btn" onClick={() => { setEditing(true); setState('idle'); }}>
              入れ替える
            </button>
            <button className="ap-btn" onClick={() => { setApiKey(provider, ''); setEditing(true); }}>
              <Trash2 size={11} style={{ verticalAlign: -1, marginRight: 4 }} />削除
            </button>
          </>
        ) : (
          <>
            <input className="ap-input" type="password" value={draft}
              placeholder={spec.keyPlaceholder}
              autoComplete="off" spellCheck={false}
              onChange={(e) => { setDraft(e.target.value); setState('idle'); }}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
            <button className="ap-btn" disabled={!draft.trim() || state === 'checking'}
              onClick={save}>
              {state === 'checking'
                ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
                : '確かめて保存'}
            </button>
            {saved && (
              <button className="ap-btn ap-btn-plain" onClick={() => setEditing(false)}>やめる</button>
            )}
          </>
        )}
      </Field>

      {state === 'ok' && (
        <div className="ap-row ap-footnote" style={{ color: 'var(--green)' }}>
          <Check size={12} /> キーが通りました
        </div>
      )}
      {typeof state === 'string' && !['idle', 'checking', 'ok'].includes(state) && (
        <div className="ap-row ap-footnote" style={{ color: 'var(--red)', lineHeight: 1.55 }}>
          <AlertTriangle size={12} style={{ flex: '0 0 12px' }} /> {state}
        </div>
      )}

      <a className="ap-linkbtn" href={spec.keyUrl} target="_blank" rel="noreferrer">
        <ExternalLink size={13} className="sec" /> {spec.label} のキーを作る
      </a>
    </>
  );
}

/* ---------------- 本体 ---------------- */

export default function Settings({ onBack }: { onBack: () => void }) {
  const s = useSettings();
  const spec = PROVIDERS[s.provider];
  const model = s.models[s.provider];
  const hasKey = !!getApiKey(s.provider);
  const [cleared, setCleared] = useState(false);

  return (
    <div className="ap ap-main" style={{ height: '100dvh' }}>
      <div className="ap-toolbar">
        <button className="ap-btn ap-btn-plain" style={{ marginLeft: -6 }} onClick={onBack}>
          <ArrowLeft size={14} />
        </button>
        <span className="ap-title3">設定</span>
      </div>

      <div className="ap-content">
        <div className="ap-content-inner" style={{ maxWidth: 720 }}>
          <div className="ap-in">
            <Section icon={<Contrast size={13} />} title="表示">
              <Field label="配色" hint="自動にすると、端末の設定に合わせて切り替わります。">
                <Choice<Theme> value={s.theme} onChange={(theme) => updateSettings({ theme })}
                  options={[
                    { value: 'auto', label: '自動' },
                    { value: 'light', label: 'ライト' },
                    { value: 'dark', label: 'ダーク' },
                  ]} />
              </Field>
              <Field label="文字の大きさ" hint="一覧の表も、グラフの社名も一緒に変わります。">
                <Choice<number> value={s.fontScale}
                  onChange={(fontScale) => updateSettings({ fontScale })}
                  options={FONT_SCALES} />
              </Field>
              <Field label="動きを減らす"
                hint="画面が切り替わるときの動きを止めます。端末側で「視差効果を減らす」を入れている場合は、この設定に関わらず止まります。">
                <Switch on={s.reduceMotion}
                  onChange={(reduceMotion) => updateSettings({ reduceMotion })} />
              </Field>
            </Section>

            <Section icon={<SearchIcon size={13} />} title="外部検索"
              note="取引先や大株主には有価証券報告書を出していない会社が多く、こちらには社名しかありません。行の虫めがねを押すと、その社名で検索を開きます。">
              <Field label="検索エンジン">
                <Choice value={s.engine} onChange={(engine) => updateSettings({ engine })}
                  options={ENGINES} />
              </Field>
            </Section>

            <Section icon={<Sparkles size={13} />} title="AI"
              note="有報から抜いた業績・政策保有・保有目的を添えて質問を組み立てます。キーを入れるとこの画面の中で答えが出ます。入れない場合は、選んだ提供元のチャット画面が開きます。">
              <Field label="提供元" hint="キーとモデルは提供元ごとに別々に覚えます。">
                <Choice<Provider> value={s.provider}
                  onChange={(provider) => updateSettings({ provider })}
                  options={PROVIDER_ORDER.map((p) => ({ value: p, label: PROVIDERS[p].label }))} />
              </Field>

              <ApiKeyField provider={s.provider} model={model} />

              <Field label="答えの出し方"
                hint={hasKey ? undefined : 'キーを入れると「この画面で答える」を選べます。'}>
                <Choice value={s.aiMode} onChange={(aiMode) => updateSettings({ aiMode })}
                  options={[
                    { value: 'open', label: spec.chatLabel },
                    { value: 'inapp', label: 'この画面で答える' },
                  ]} />
              </Field>

              {/* モデル名は各社の都合で増減する。選ばせるだけだと、新しいモデルが
                  出たときにこの画面を直すまで使えない。直接書けるようにしておく */}
              <Field label="モデル"
                hint={spec.models.find((m) => m.value === model)?.note
                  ?? '一覧にないモデル名も、そのまま書けば使えます。'}>
                <input className="ap-input" list={`models-${s.provider}`} value={model}
                  spellCheck={false} autoComplete="off"
                  onChange={(e) => updateSettings({
                    models: { ...s.models, [s.provider]: e.target.value.trim() },
                  })} />
                <datalist id={`models-${s.provider}`}>
                  {spec.models.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </datalist>
              </Field>
            </Section>

            <Section icon={<ShieldCheck size={13} />} title="キーの扱い">
              <div className="ap-row" style={{ display: 'block', lineHeight: 1.75 }}>
                <div className="ap-footnote">
                  入力したキーは <b>この端末の中だけ</b>に保存され、通信も端末から各社へ直接出ます。
                  このサイトには受け口となるサーバがないので、キーがこちら側を通ることはありません。
                  閲覧統計にも載せていません。
                </div>
                <div className="ap-footnote" style={{ marginTop: 10 }}>
                  ただし、ブラウザに置く以上は<b>そのブラウザを使える人には取り出せます</b>。
                  共有の端末では入れないでください。キーはこの用途専用に作り、
                  使う分だけの上限を各社の管理画面で設定しておくのが安全です。
                </div>
                <div className="ap-footnote" style={{ marginTop: 10 }}>
                  Gemini には無料枠があります。Claude と ChatGPT は従量課金のみで、
                  使った分だけ各社から請求されます。
                </div>
              </div>
            </Section>

            <Section icon={<Eye size={13} />} title="記録">
              <Field label="閲覧の記録を送る"
                hint="どの銘柄が何回開かれたかという数だけを送ります。利用者を区別する値（ID・Cookie・端末情報・IPアドレス）は作らず、送らず、保存しません。">
                <Switch on={s.analytics}
                  onChange={(analytics) => updateSettings({ analytics })} />
              </Field>
            </Section>

            <NotifySection />

            <Section icon={<Database size={13} />} title="この端末のデータ">
              <Field label="保存した配信データを消す"
                hint="企業のシャードは端末内（IndexedDB）に版付きで持っています。消しても次に開いたときに取り直します。">
                <button className="ap-btn" onClick={async () => {
                  await clearCache();
                  setCleared(true);
                  setTimeout(() => setCleared(false), 2600);
                }}>
                  {cleared ? <><Check size={11} style={{ verticalAlign: -1, marginRight: 4 }} />消しました</>
                    : '消す'}
                </button>
              </Field>
              <Field label="設定を既定に戻す" hint="APIキーは消えません（上の「削除」で消せます）。">
                <button className="ap-btn" onClick={resetSettings}>戻す</button>
              </Field>
            </Section>

            <div className="ap-footnote" style={{ padding: '4px 4px 40px', lineHeight: 1.7 }}>
              <Info size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
              出典：<a href="https://disclosure2.edinet-fsa.go.jp/" target="_blank" rel="noreferrer"
                style={{ color: 'var(--blue)' }}>EDINET閲覧サイト</a>（金融庁）・
              <a href="https://disclosure2dl.edinet-fsa.go.jp/guide/static/submit/WZEK0030.html"
                target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>PDL1.0</a>
              。投資判断の助言は行いません。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
