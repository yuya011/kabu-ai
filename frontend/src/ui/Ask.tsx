/* 外部AIに聞く。

   キーが無ければ、選んだ提供元のチャット画面を開いてプロンプトを渡す。
   キーがあるときだけ、この画面の中に答えを流す。
   グラフのインスペクタと企業ページの両方から使う。 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Spinner, MessageBar, MessageBarBody, MessageBarTitle } from '@fluentui/react-components';
import { Sparkle20Regular, Checkmark20Regular, Dismiss16Regular, Stop16Regular } from '@fluentui/react-icons';
import { ask as askAi, openChat, PROVIDERS } from '../browser/ai';
import { useSettings, currentAi } from '../settings';

interface Answer { text: string; busy: boolean; error?: string }

export function useAsk(resetKey: string | null) {
  const settings = useSettings();
  const [asked, setAsked] = useState<'copied' | 'opened' | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(async (prompt: string) => {
    const { provider, key, model } = currentAi(settings);
    if (settings.aiMode !== 'inapp' || !key) {
      setAsked(await openChat(provider, prompt));
      setTimeout(() => setAsked(null), 3200);
      return;
    }
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setAnswer({ text: '', busy: true });
    try {
      await askAi(prompt, {
        provider, key, model, signal: ac.signal,
        onText: (chunk) => setAnswer((a) => ({ text: (a?.text ?? '') + chunk, busy: true })),
      });
      setAnswer((a) => ({ text: a?.text ?? '', busy: false }));
    } catch (e) {
      if (ac.signal.aborted) return; // 別の質問に切り替わっただけ
      setAnswer({ text: '', busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  }, [settings]);

  const close = useCallback(() => { abort.current?.abort(); setAnswer(null); }, []);

  // 対象が変われば、前の答えは用済み
  useEffect(() => { abort.current?.abort(); setAnswer(null); setAsked(null); }, [resetKey]);

  return { run, close, asked, answer, label: PROVIDERS[settings.provider].label };
}

export function AskButton({ state, onClick, disabled, text }: {
  state: ReturnType<typeof useAsk>;
  onClick: () => void;
  disabled?: boolean;
  text: string;
}) {
  const busy = !!state.answer?.busy;
  return (
    <Button appearance="secondary" className="k-ask" onClick={onClick} disabled={disabled || busy}
      icon={busy ? <Spinner size="extra-tiny" /> : state.asked ? <Checkmark20Regular /> : <Sparkle20Regular />}>
      {busy ? '聞いています…'
        : state.asked === 'copied' ? 'プロンプトをコピーしました'
        : state.asked === 'opened' ? `${state.label} を開きました`
        : text}
    </Button>
  );
}

export function AnswerBox({ state }: { state: ReturnType<typeof useAsk> }) {
  const a = state.answer;
  if (!a) return null;
  if (a.error) {
    return (
      <MessageBar intent="error" className="k-answer-err">
        <MessageBarBody>
          <MessageBarTitle>答えられませんでした</MessageBarTitle>
          {a.error}
        </MessageBarBody>
        <Button appearance="transparent" size="small" icon={<Dismiss16Regular />} onClick={state.close} aria-label="閉じる" />
      </MessageBar>
    );
  }
  return (
    <div className="k-answer" aria-live="polite">
      <div className="k-answer-head">
        <Sparkle20Regular />
        {state.label} の答え
        <Button appearance="subtle" size="small" style={{ marginLeft: 'auto' }}
          icon={a.busy ? <Stop16Regular /> : <Dismiss16Regular />}
          aria-label={a.busy ? '止める' : '閉じる'} onClick={state.close} />
      </div>
      {a.text || <span className="k-caption">書き始めを待っています…</span>}
    </div>
  );
}
