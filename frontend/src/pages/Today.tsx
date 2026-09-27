/* 本日の開示。

   Worker が EDINET を10分おきに巡回して集めた、当日の提出書類を新しい順に並べる。
   株主構成や支配権が動くもの（臨時報告書・大量保有・公開買付）は「重要」として色を差し、
   それだけに絞ることもできる。通知の対象と同じ基準である。 */

import { useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Badge, Switch, Skeleton, SkeletonItem, Link, MessageBar, MessageBarBody,
} from '@fluentui/react-components';
import { ArrowClockwise16Regular, Open16Regular, Organization20Regular } from '@fluentui/react-icons';
import { useData } from '../data';
import { go, href } from '../router';
import { fetchTodayLive, liveEnabled, ago, clock, type TodayLive } from '../browser/live';
import { Favi } from '../ui/common';
import { TodayArt } from '../ui/art';

export default function Today() {
  const { data } = useData();
  const [live, setLive] = useState<TodayLive | null | undefined>(undefined);
  const [busy, setBusy] = useState(true);
  const [tick, setTick] = useState(0);
  const [onlyImportant, setOnlyImportant] = useState(false);

  useEffect(() => {
    if (!liveEnabled) return;
    let alive = true;
    setBusy(true);
    fetchTodayLive(200).then((d) => { if (alive) { setLive(d); setBusy(false); } });
    return () => { alive = false; };
  }, [tick]);

  const items = useMemo(() => (live?.items ?? []).filter((it) => !onlyImportant || it.important), [live, onlyImportant]);

  // 時刻の見出しで区切る。1時間ごとにまとめると、昼休みや引け後の山が目で分かる
  const groups = useMemo(() => {
    const m = new Map<string, typeof items>();
    for (const it of items) {
      const h = clock(it.disclosed_at).slice(0, 2) || '--';
      if (!m.has(h)) m.set(h, []);
      m.get(h)!.push(it);
    }
    return [...m];
  }, [items]);

  if (!liveEnabled) {
    return (
      <div className="k-page k-explore-empty">
        <TodayArt />
        <h1 className="k-title">本日の開示</h1>
        <p className="k-lead">この配信では速報の取得先が設定されていません。</p>
      </div>
    );
  }

  const nImportant = live?.items.filter((i) => i.important).length ?? 0;

  return (
    <div className="k-page">
      <header className="k-pagehead">
        <div>
          <h1 className="k-title"><span className="k-live" /> {live && !live.today ? `${live.ymd.slice(5).replace('-', '/')} の開示` : '本日の開示'}</h1>
          <p className="k-lead">
            EDINET に提出された書類を10分おきに集めています。
            {live?.crawled_at && ` 最終巡回は${ago(live.crawled_at)}。`}
            {live && !live.today && ' 今日はまだ提出が無いため、直近の営業日ぶんを出しています。'}
          </p>
        </div>
        <div className="k-pagehead-actions">
          <Switch checked={onlyImportant} onChange={(_, d) => setOnlyImportant(d.checked)}
            label={`重要なものだけ（${nImportant}）`} />
          <Button icon={<ArrowClockwise16Regular />} disabled={busy} onClick={() => setTick((t) => t + 1)}>読み直す</Button>
        </div>
      </header>

      {live === null && (
        <MessageBar intent="warning"><MessageBarBody>速報を取得できませんでした。しばらくしてから読み直してください。</MessageBarBody></MessageBar>
      )}

      <Card className="k-card k-timeline">
        {live === undefined ? (
          <Skeleton>{Array.from({ length: 8 }, (_, i) => <SkeletonItem key={i} size={28} style={{ margin: '10px 0' }} />)}</Skeleton>
        ) : items.length === 0 ? (
          <div className="k-caption" style={{ padding: 16 }}>該当する開示はありません</div>
        ) : groups.map(([h, list]) => (
          <section key={h} className="k-tl-group">
            <div className="k-tl-hour k-num">{h}:00</div>
            <div className="k-tl-items">
              {list.map((it) => {
                const rec = data!.catalog.get(it.code);
                return (
                  <div key={it.id} className="k-tl-row" data-flag={it.important}>
                    <span className="k-num k-time">{clock(it.disclosed_at)}</span>
                    {rec ? <Favi domain={rec.domain} name={rec.name} s17={rec.s17} size={28} /> : <span style={{ width: 28 }} />}
                    <div className="k-tl-main">
                      <Link className="k-tl-co" onClick={() => go(href.company(it.code))}>
                        {it.name ?? rec?.name ?? it.code}
                      </Link>
                      <div className="k-tl-title">{it.title}</div>
                    </div>
                    <div className="k-tl-meta">
                      {it.important && <Badge appearance="filled" color="warning" size="small">重要</Badge>}
                      {it.category && it.category !== it.title && <Badge appearance="outline" color="informative" size="small">{it.category}</Badge>}
                    </div>
                    <div className="k-tl-act">
                      {rec?.kind === 0 && (
                        <Button size="small" appearance="subtle" icon={<Organization20Regular />}
                          aria-label="つながりを見る" title="つながりを見る"
                          onClick={() => go(href.explore(it.code))} />
                      )}
                      <Button size="small" appearance="subtle" icon={<Open16Regular />} as="a"
                        href={it.url} target="_blank" rel="noreferrer" aria-label="書類を開く" title="書類を開く" />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </Card>

      {live?.sources?.length ? (
        <p className="k-note">
          出典：{live.sources.map((a, i) => (
            <span key={a.id}>{i > 0 && '・'}<Link href={a.url} target="_blank" rel="noreferrer" inline>{a.name}</Link></span>
          ))}（{live.sources[0].license}）
        </p>
      ) : null}
    </div>
  );
}
