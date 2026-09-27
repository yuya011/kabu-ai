/* 設定。

   Fluent の設定画面の定型に合わせて、1項目1行（左に名前と説明、右に操作）で並べ、
   関係する項目をカードでまとめる。保存は即時で、保存ボタンは置かない。 */

import { useEffect, useState } from 'react';
import {
  Button, Card, Switch, RadioGroup, Radio, Input, Link, Badge, Spinner,
  MessageBar, MessageBarBody,
} from '@fluentui/react-components';
import {
  DarkTheme20Regular, Search20Regular, Sparkle20Regular, ShieldCheckmark20Regular, Eye20Regular,
  Alert20Regular, Database20Regular, Delete20Regular, Checkmark16Regular, Open16Regular, Dismiss16Regular,
  Key20Regular,
} from '@fluentui/react-icons';
import { clearCache } from '../browser/cache';
import * as push from '../browser/push';
import { verifyKey, PROVIDERS, PROVIDER_ORDER, type Provider } from '../browser/ai';
import {
  useSettings, updateSettings, resetSettings, getApiKey, setApiKey, maskKey,
  FONT_SCALES, ENGINES, type Theme,
} from '../settings';
import { useData } from '../data';
import { SectionTitle } from '../ui/common';

function Row({ label, hint, children, htmlFor }: {
  label: string; hint?: React.ReactNode; children: React.ReactNode; htmlFor?: string;
}) {
  return (
    <div className="k-setrow">
      <div className="k-setrow-text">
        <label className="k-setrow-label" htmlFor={htmlFor}>{label}</label>
        {hint && <div className="k-caption">{hint}</div>}
      </div>
      <div className="k-setrow-ctl">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const s = useSettings();
  const spec = PROVIDERS[s.provider];
  const model = s.models[s.provider];
  const hasKey = !!getApiKey(s.provider);
  const [cleared, setCleared] = useState(false);

  return (
    <div className="k-page k-settings">
      <header className="k-pagehead">
        <div>
          <h1 className="k-title">設定</h1>
          <p className="k-lead">変更はすぐに反映され、この端末にだけ保存されます。</p>
        </div>
      </header>

      <Card className="k-card">
        <SectionTitle icon={<DarkTheme20Regular />} title="表示" />
        <Row label="配色" hint="自動にすると、端末の設定に合わせて切り替わります。">
          <RadioGroup layout="horizontal" value={s.theme} onChange={(_, d) => updateSettings({ theme: d.value as Theme })}>
            <Radio value="auto" label="自動" /><Radio value="light" label="ライト" /><Radio value="dark" label="ダーク" />
          </RadioGroup>
        </Row>
        <Row label="文字の大きさ" hint="表もグラフの社名も一緒に変わります。">
          <RadioGroup layout="horizontal" value={String(s.fontScale)}
            onChange={(_, d) => updateSettings({ fontScale: Number(d.value) })}>
            {FONT_SCALES.map((f) => <Radio key={f.value} value={String(f.value)} label={f.label} />)}
          </RadioGroup>
        </Row>
        <Row label="動きを減らす" hint="画面の切り替えや図の動きを止めます。端末側で「視差効果を減らす」を入れている場合は、この設定に関わらず止まります。">
          <Switch checked={s.reduceMotion} onChange={(_, d) => updateSettings({ reduceMotion: d.checked })} />
        </Row>
      </Card>

      <Card className="k-card">
        <SectionTitle icon={<Search20Regular />} title="外部検索"
          note="取引先や大株主には有報を出していない会社が多く、こちらには社名しかありません。行の虫めがねを押すと、その社名で検索を開きます。" />
        <Row label="検索エンジン">
          <RadioGroup layout="horizontal" value={s.engine} onChange={(_, d) => updateSettings({ engine: d.value as any })}>
            {ENGINES.map((e) => <Radio key={e.value} value={e.value} label={e.label} />)}
          </RadioGroup>
        </Row>
      </Card>

      <Card className="k-card">
        <SectionTitle icon={<Sparkle20Regular />} title="AI"
          note="有報から抜いた業績・政策保有・保有目的を添えて質問を組み立てます。キーを入れるとこの画面の中で答えが出ます。入れない場合は、選んだ提供元のチャット画面が開きます。" />
        <Row label="提供元" hint="キーとモデルは提供元ごとに別々に覚えます。">
          <RadioGroup layout="horizontal" value={s.provider} onChange={(_, d) => updateSettings({ provider: d.value as Provider })}>
            {PROVIDER_ORDER.map((p) => <Radio key={p} value={p} label={PROVIDERS[p].label} />)}
          </RadioGroup>
        </Row>
        <ApiKeyRow provider={s.provider} model={model} />
        <Row label="答えの出し方" hint={hasKey ? undefined : 'キーを入れると「この画面で答える」を選べます。'}>
          <RadioGroup layout="horizontal" value={s.aiMode} onChange={(_, d) => updateSettings({ aiMode: d.value as any })}>
            <Radio value="open" label={spec.chatLabel} />
            <Radio value="inapp" label="この画面で答える" disabled={!hasKey} />
          </RadioGroup>
        </Row>
        {/* モデル名は各社の都合で増減する。選ばせるだけだと、新しいモデルが出たときに
            この画面を直すまで使えない。直接書けるようにしておく */}
        <Row label="モデル" htmlFor="k-model"
          hint={spec.models.find((m) => m.value === model)?.note ?? '一覧にないモデル名も、そのまま書けば使えます。'}>
          <Input id="k-model" list={`models-${s.provider}`} value={model} spellCheck={false} autoComplete="off"
            onChange={(_, d) => updateSettings({ models: { ...s.models, [s.provider]: d.value.trim() } })} />
          <datalist id={`models-${s.provider}`}>
            {spec.models.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </datalist>
        </Row>
      </Card>

      <Card className="k-card">
        <SectionTitle icon={<ShieldCheckmark20Regular />} title="キーの扱い" />
        <div className="k-prose">
          <p>入力したキーは<b>この端末の中だけ</b>に保存され、通信も端末から各社へ直接出ます。このサイトには受け口となるサーバがないので、キーがこちら側を通ることはありません。閲覧統計にも載せていません。</p>
          <p>ただし、ブラウザに置く以上は<b>そのブラウザを使える人には取り出せます</b>。共有の端末では入れないでください。キーはこの用途専用に作り、使う分だけの上限を各社の管理画面で設定しておくのが安全です。</p>
          <p>Gemini には無料枠があります。Claude と ChatGPT は従量課金のみで、使った分だけ各社から請求されます。</p>
        </div>
      </Card>

      <Card className="k-card">
        <SectionTitle icon={<Eye20Regular />} title="記録" />
        <Row label="閲覧の記録を送る" hint="どの銘柄が何回開かれたかという数だけを送ります。利用者を区別する値（ID・Cookie・端末情報・IPアドレス）は作らず、送らず、保存しません。">
          <Switch checked={s.analytics} onChange={(_, d) => updateSettings({ analytics: d.checked })} />
        </Row>
      </Card>

      <NotifyCard />

      <Card className="k-card">
        <SectionTitle icon={<Database20Regular />} title="この端末のデータ" />
        <Row label="保存した配信データを消す" hint="企業のデータは端末内（IndexedDB）に版付きで持っています。消しても次に開いたときに取り直します。">
          <Button icon={cleared ? <Checkmark16Regular /> : <Delete20Regular />}
            onClick={async () => { await clearCache(); setCleared(true); setTimeout(() => setCleared(false), 2600); }}>
            {cleared ? '消しました' : '消す'}
          </Button>
        </Row>
        <Row label="設定を既定に戻す" hint="API キーは消えません（上の「削除」で消せます）。">
          <Button onClick={resetSettings}>既定に戻す</Button>
        </Row>
      </Card>
    </div>
  );
}

function ApiKeyRow({ provider, model }: { provider: Provider; model: string }) {
  const spec = PROVIDERS[provider];
  const saved = getApiKey(provider);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'ok' | string>('idle');

  useEffect(() => { setEditing(false); setDraft(''); setState('idle'); }, [provider]);

  const save = async () => {
    const key = draft.trim();
    if (!key) return;
    setState('checking');
    try {
      await verifyKey(provider, key, model);
      setApiKey(provider, key);
      // 鍵を入れたのは使うためなので、答えの出し方も合わせて切り替える
      updateSettings({ aiMode: 'inapp' });
      setDraft(''); setEditing(false); setState('ok');
      setTimeout(() => setState('idle'), 2600);
    } catch (e) {
      setState(e instanceof Error ? e.message : String(e));
    }
  };

  const failed = typeof state === 'string' && !['idle', 'checking', 'ok'].includes(state);

  return (
    <>
      <Row label={`${spec.label} の API キー`} htmlFor="k-key"
        hint={<>
          {saved && !editing ? 'この端末にだけ保存されています。ほかの端末には引き継がれません。'
            : `${spec.keyHint}貼り付けると疎通を確かめてから保存します。`}
          {' '}<Link href={spec.keyUrl} target="_blank" rel="noreferrer" inline>キーを作る <Open16Regular style={{ verticalAlign: -3 }} /></Link>
        </>}>
        {saved && !editing ? (
          <>
            <Badge appearance="tint" color="success" icon={<Key20Regular />} size="large" className="k-num">{maskKey(saved)}</Badge>
            <Button onClick={() => { setEditing(true); setState('idle'); }}>入れ替える</Button>
            <Button icon={<Delete20Regular />} onClick={() => { setApiKey(provider, ''); setEditing(true); }}>削除</Button>
          </>
        ) : (
          <>
            <Input id="k-key" type="password" value={draft} placeholder={spec.keyPlaceholder}
              autoComplete="off" spellCheck={false}
              onChange={(_, d) => { setDraft(d.value); setState('idle'); }}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
            <Button appearance="primary" disabled={!draft.trim() || state === 'checking'} onClick={save}
              icon={state === 'checking' ? <Spinner size="extra-tiny" /> : undefined}>
              確かめて保存
            </Button>
            {saved && <Button appearance="subtle" icon={<Dismiss16Regular />} onClick={() => setEditing(false)}>やめる</Button>}
          </>
        )}
      </Row>
      {state === 'ok' && <MessageBar intent="success" className="k-inline-msg"><MessageBarBody>キーが通りました</MessageBarBody></MessageBar>}
      {failed && <MessageBar intent="error" className="k-inline-msg"><MessageBarBody>{state}</MessageBarBody></MessageBar>}
    </>
  );
}

/* 通知は、端末が対応していて、かつサーバ側に鍵が入っているときだけ出す */
function NotifyCard() {
  const codes = push.useWatch();
  const { data } = useData();
  const [state, setState] = useState<push.PushState>('unsupported');
  const [busy, setBusy] = useState(false);

  useEffect(() => { push.state().then(setState); }, []);
  if (state === 'unavailable') return null;

  const toggle = async (on: boolean) => {
    setBusy(true);
    if (on) setState(await push.enable());
    else { await push.disable(); setState('off'); }
    setBusy(false);
  };

  return (
    <Card className="k-card">
      <SectionTitle icon={<Alert20Regular />} title="通知" />
      {state === 'unsupported' ? (
        <p className="k-note">
          この端末では通知を使えません。iPhone・iPad では、Safari の共有メニューから<b>ホーム画面に追加</b>して、
          そこから開いたときだけ通知を受け取れます（iOS 16.4 以降）。
        </p>
      ) : (
        <>
          <Row label="重要な開示を通知する"
            hint="下に並べた銘柄に臨時報告書・大量保有報告書・公開買付の届出が出たときだけ鳴らします。有価証券報告書や四半期報告書は日程の決まった定期開示なので対象にしていません。">
            <Switch checked={state === 'on'} disabled={busy} onChange={(_, d) => toggle(d.checked)} />
          </Row>
          {state === 'denied' && (
            <MessageBar intent="warning" className="k-inline-msg">
              <MessageBarBody>ブラウザ側で通知が拒否されています。サイトの設定から許可し直してください。</MessageBarBody>
            </MessageBar>
          )}
          <Row label={`通知する銘柄（${codes.length} 社）`}
            hint={codes.length ? '企業ページの「通知」ボタンからも出し入れできます。' : 'まだありません。企業ページの「通知」ボタンから追加します。'}>
            <span />
          </Row>
          {codes.map((c) => (
            <div key={c} className="k-setrow k-setrow-sub">
              <span className="k-num k-caption">{c.slice(0, 4)}</span>
              <span style={{ flex: 1 }}>{data?.catalog.get(c)?.name ?? '—'}</span>
              <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} aria-label="外す"
                onClick={() => push.toggleWatch(c)} />
            </div>
          ))}
          <p className="k-note">
            預けるのは「この購読で、この銘柄を鳴らす」という組だけです。購読の宛先はブラウザの配信元が発行する URL で、
            こちらから利用者を特定する材料にはなりません。通知を切れば、その控えも消します。
          </p>
        </>
      )}
    </Card>
  );
}
