/* 「このアプリについて」と出典。

   公共データ利用規約(PDL1.0)は出典と加工した旨の明記を求めている。
   閲覧の統計を取る以上、何を集めて何を集めないかも同じ場所に置く。 */

import {
  Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions,
  Button, Link,
} from '@fluentui/react-components';
import { Dismiss20Regular } from '@fluentui/react-icons';
import { useData, type Source } from '../data';
import { BrandMark } from './art';

const FALLBACK: Source[] = [{
  name: 'EDINET閲覧サイト（金融庁）',
  url: 'https://disclosure2.edinet-fsa.go.jp/',
  license: '公共データ利用規約（PDL1.0）',
  license_url: 'https://disclosure2dl.edinet-fsa.go.jp/guide/static/submit/WZEK0030.html',
}];

export function useSources(): Source[] {
  const { data } = useData();
  return data?.index.sources?.length ? data.index.sources : FALLBACK;
}

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void; mode?: string }) {
  const sources = useSources();
  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface className="k-dialog">
        <DialogBody>
          <DialogTitle action={<Button appearance="subtle" aria-label="閉じる" icon={<Dismiss20Regular />} onClick={onClose} />}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <BrandMark size={28} /> Keiretsu について
            </span>
          </DialogTitle>
          <DialogContent className="k-prose">
            <h3>扱っている情報</h3>
            <p>
              有価証券報告書・臨時報告書に書かれた、政策保有株・大株主・主要な取引先。
              関係の説明は企業自身の記載そのままです。投資助言ではありません。
            </p>
            <h3>記録している情報</h3>
            <p>銘柄ごとの閲覧回数だけです。利用者を識別する情報は取りません。設定から止められます。</p>
            <h3>出典</h3>
            <ul>
              {sources.map((s) => (
                <li key={s.url}>
                  <Link href={s.url} target="_blank" rel="noreferrer">{s.name}</Link>
                  {' · '}
                  <Link href={s.license_url} target="_blank" rel="noreferrer">{s.license}</Link>
                  {s.note && <div className="k-caption">{s.note}</div>}
                </li>
              ))}
            </ul>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={onClose}>閉じる</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** ページ下の出典。どのページでも同じ文言を置く */
export function SourceFooter({ onAbout }: { onAbout?: () => void }) {
  const sources = useSources();
  return (
    <footer className="k-footer">
      <span>
        出典：{sources.map((s, i) => (
          <span key={s.url}>
            {i > 0 && '・'}
            <Link href={s.url} target="_blank" rel="noreferrer" inline>{s.name}</Link>
          </span>
        ))}
        {' '}
        <Link href={sources[0].license_url} target="_blank" rel="noreferrer" inline>{sources[0].license}</Link>
        をもとに加工。投資助言ではありません。
      </span>
      {onAbout && <Link as="button" onClick={onAbout}>このアプリについて</Link>}
    </footer>
  );
}
