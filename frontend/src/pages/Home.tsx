/* ホーム。

   上から「何ができるか → すぐ試す → 規模 → ほかの入口」の順に置く。
   主役は検索なので、見出しのすぐ下にいちばん大きく置く。
   右の図は実際のグラフ画面と同じ文法で描いてあり、押した先の見当がつく。 */

import { useEffect, useState } from 'react';
import {
  Button, Card, Tooltip, Badge, Skeleton, SkeletonItem,
} from '@fluentui/react-components';
import {
  BuildingMultiple20Regular, Organization20Regular, Handshake20Regular,
  DataTrending20Regular, ArrowRight16Regular, ChevronRight16Regular,
  Open16Regular, News20Regular, ArrowTrending20Regular,
} from '@fluentui/react-icons';
import { useData } from '../data';
import { go, href } from '../router';
import { CompanySearch } from '../ui/CompanySearch';
import { HeroArt, ExploreArt, SectorsArt, ConnectArt, TodayArt } from '../ui/art';
import { SectorBars } from '../ui/charts';
import { Favi, SectionTitle, short, trimCo } from '../ui/common';
import { SourceFooter } from '../ui/About';
import AdSlot from '../browser/AdSlot';
import { fetchTrending } from '../browser/analytics';
import { fetchTodayLive, liveEnabled, clock, type TodayLive } from '../browser/live';

/* 初めて開いた人向けの見本。業種が散るように選んである */
const EXAMPLES = ['83060', '72030', '67580', '99840', '45680', '80580'];

export default function Home({ onAbout }: { onAbout: () => void }) {
  const { data } = useData();
  const m = data!.index.meta;
  const catalog = data!.catalog;

  return (
    <div className="k-page k-home">
      <section className="k-hero">
        <div className="k-hero-text k-rise">
          <Badge appearance="tint" shape="rounded" size="large" className="k-hero-badge">
            東証上場 {m.company_count.toLocaleString()} 社 · 有価証券報告書
          </Badge>
          <h1 className="k-display">
            {/* 句の途中で折れないよう、句ごとに塊にする */}
            <span className="k-phrase">上場企業のつながりを、</span><span className="k-phrase">有報の言葉で辿る。</span>
          </h1>
          <p className="k-lead">政策保有・大株主・取引先を、1社を中心にグラフで。</p>
          <CompanySearch size="large" inline autoFocus
            placeholder="社名または証券コードで探す"
            onPick={(c) => go(href.explore(c))}
            action={(c) => (
              <Tooltip content="企業ページを開く" relationship="label">
                <Button size="small" appearance="subtle" icon={<BuildingMultiple20Regular />}
                  onClick={() => go(href.company(c))} />
              </Tooltip>
            )} />
          <div className="k-quick">
            <span className="k-caption">試しに</span>
            {EXAMPLES.map((c) => {
              const rec = catalog.get(c);
              if (!rec) return null;
              return (
                <Button key={c} size="small" shape="circular" appearance="outline"
                  className="k-quick-chip"
                  icon={<Favi domain={rec.domain} name={rec.name} s17={rec.s17} size={16} />}
                  onClick={() => go(href.explore(c))}>
                  {trimCo(rec.name)}
                </Button>
              );
            })}
          </div>
        </div>
        <div className="k-hero-visual k-rise" style={{ animationDelay: '120ms' }}>
          <HeroArt />
        </div>
      </section>

      <section className="k-stats" aria-label="収録の規模">
        <Stat icon={<BuildingMultiple20Regular />} label="上場企業" value={m.company_count} unit="社" />
        <Stat icon={<Organization20Regular />} label="政策保有" value={m.holding_count} unit="件" />
        <Stat icon={<Handshake20Regular />} label="主要な取引先" value={m.customer_count ?? 0} unit="件" />
        <Stat icon={<DataTrending20Regular />} label="5期の業績" value={m.annual_companies ?? 0} unit="社" />
      </section>

      <section>
        <SectionTitle title="機能" />
        <div className="k-features">
          <Feature art={<ExploreArt />} title="つながりを探索"
            text="持ち合い・大株主・取引をグラフで。2社間の経路も辿れます。"
            to={href.explore()} cta="グラフを開く" />
          <Feature art={<SectorsArt />} title="業種と企業"
            text={`${data!.index.sectors.length} 業種の企業を、売上と利益率で比べる。`}
            to={href.sectors()} cta="業種を見る" />
          {liveEnabled && (
            <Feature art={<TodayArt />} title="本日の開示"
              text="臨時報告書・大量保有報告書の速報。"
              to={href.today()} cta="開示を見る" />
          )}
          <Feature art={<ConnectArt />} title="AI とつなぐ"
            text="Claude や Cursor から、このデータを直接引く。"
            to={href.connect()} cta="つなぎ方を見る" />
        </div>
      </section>

      <section className="k-home-grid">
        <Card className="k-card">
          <SectionTitle icon={<BuildingMultiple20Regular />} title="業種の分布"
            action={<Button appearance="transparent" icon={<ArrowRight16Regular />} iconPosition="after"
              as="a" href={href.sectors()}>すべて</Button>} />
          <SectorBars sectors={data!.index.sectors} limit={9} onPick={(c) => go(href.sectors(c))} />
        </Card>
        {liveEnabled ? <TodayCard /> : <PicksCard />}
      </section>

      <AdSlot slot="1111111111" format="horizontal" />

      <SourceFooter onAbout={onAbout} />
    </div>
  );
}

function Stat({ icon, label, value, unit }: { icon: React.ReactNode; label: string; value: number; unit: string }) {
  return (
    <Card className="k-stat" appearance="filled-alternative">
      <span className="k-stat-ico">{icon}</span>
      <div>
        <div className="k-caption">{label}</div>
        <div className="k-stat-value k-num">{value.toLocaleString()}<span className="k-stat-unit">{unit}</span></div>
      </div>
    </Card>
  );
}

function Feature({ art, title, text, to, cta }: {
  art: React.ReactNode; title: string; text: string; to: string; cta: string;
}) {
  return (
    <Card className="k-feature" onClick={() => go(to)} focusMode="off" role="link" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') go(to); }}>
      <div className="k-feature-art">{art}</div>
      <div className="k-feature-body">
        <h3>{title}</h3>
        <p>{text}</p>
        <span className="k-feature-cta">{cta}<ChevronRight16Regular /></span>
      </div>
    </Card>
  );
}

/** 本日の開示の先頭。全部は専用ページで */
function TodayCard() {
  const { data } = useData();
  const [live, setLive] = useState<TodayLive | null | undefined>(undefined);
  useEffect(() => { fetchTodayLive(6).then(setLive); }, []);
  if (live === null || (live && !live.items.length)) return <PicksCard />;

  return (
    <Card className="k-card">
      <SectionTitle icon={<News20Regular />} title={live && !live.today ? '直近の開示' : '本日の開示'}
        action={<Button appearance="transparent" icon={<ArrowRight16Regular />} iconPosition="after"
          as="a" href={href.today()}>すべて</Button>} />
      {live === undefined ? (
        <Skeleton aria-label="読み込み中">
          {[0, 1, 2, 3].map((i) => <SkeletonItem key={i} size={24} style={{ marginBottom: 12 }} />)}
        </Skeleton>
      ) : (
        <div className="k-list">
          {live.items.map((it) => {
            const rec = data!.catalog.get(it.code);
            return (
              <div key={it.id} className="k-list-row" data-flag={it.important}
                role="link" tabIndex={0} onClick={() => go(href.company(it.code))}
                onKeyDown={(e) => { if (e.key === 'Enter') go(href.company(it.code)); }}>
                <span className="k-num k-time">{clock(it.disclosed_at)}</span>
                {rec && <Favi domain={rec.domain} name={rec.name} s17={rec.s17} size={24} />}
                <span className="k-list-main">
                  <span className="k-list-title">{it.name ?? rec?.name ?? it.code}</span>
                  <span className="k-caption k-ellipsis">{it.title}</span>
                </span>
                {it.important && <Badge appearance="tint" color="warning" size="small">重要</Badge>}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** よく見られている会社。統計の受け口が無ければ見本の会社を出す */
function PicksCard() {
  const { data } = useData();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [trending, setTrending] = useState(false);
  useEffect(() => {
    fetchTrending(8).then((t) => {
      const got = t.map((x) => x.code).filter((c) => data!.catalog.get(c)?.kind === 0);
      if (got.length >= 4) { setCodes(got); setTrending(true); } else setCodes(EXAMPLES);
    });
  }, [data]);

  return (
    <Card className="k-card">
      <SectionTitle icon={<ArrowTrending20Regular />}
        title={trending ? 'よく見られている企業' : '主な企業'} />
      <div className="k-list">
        {(codes ?? []).map((c) => {
          const rec = data!.catalog.get(c);
          if (!rec) return null;
          return (
            <div key={c} className="k-list-row" role="link" tabIndex={0}
              onClick={() => go(href.explore(c))}
              onKeyDown={(e) => { if (e.key === 'Enter') go(href.explore(c)); }}>
              <Favi domain={rec.domain} name={rec.name} s17={rec.s17} size={28} />
              <span className="k-list-main">
                <span className="k-list-title">{rec.name}</span>
                <span className="k-caption">{short(c)} · {rec.s33}</span>
              </span>
              <Tooltip content="企業ページ" relationship="label">
                <Button size="small" appearance="subtle" icon={<Open16Regular />}
                  onClick={(e) => { e.stopPropagation(); go(href.company(c)); }} />
              </Tooltip>
              <ChevronRight16Regular className="k-muted" />
            </div>
          );
        })}
        {!codes && (
          <Skeleton>{[0, 1, 2, 3, 4].map((i) => <SkeletonItem key={i} size={28} style={{ marginBottom: 12 }} />)}</Skeleton>
        )}
      </div>
    </Card>
  );
}
