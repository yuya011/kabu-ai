/* 企業ページ。

   上に「誰か」（社名・業種・主な操作）、その下に「いまの姿」（主要な数字）、
   残りをタブで分ける。業績・資本関係・取引・開示。
   以前は全部を縦に積んでいて、大株主まで辿り着くのに画面を何枚も送る必要があった。

   主な操作は「つながりを見る」。一覧とグラフが別々のアプリのように切れていたので、
   ここから同じ会社を中心にしたグラフへ直に渡す。 */

import { useEffect, useState } from 'react';
import {
  Button, Card, Badge, Tooltip, Spinner, TabList, Tab, CounterBadge,
  Menu, MenuTrigger, MenuPopover, MenuList, MenuItemLink,
  Table, TableHeader, TableRow, TableHeaderCell, TableBody, TableCell,
  Breadcrumb, BreadcrumbItem, BreadcrumbButton, BreadcrumbDivider,
} from '@fluentui/react-components';
import {
  Organization20Regular, Alert20Regular, AlertOn20Regular, Open20Regular, Globe20Regular,
  DocumentPdf20Regular, Document20Regular, ChartMultiple20Regular, ArrowClockwise16Regular,
  ChevronRight16Regular, Search20Regular,
} from '@fluentui/react-icons';
import { useData, useCompany } from '../data';
import { go, href } from '../router';
import { marketLabel } from '../ui/market';
import type { Detail } from '../browser/types';
import { buildPrompt } from '../browser/prompt';
import { recordView } from '../browser/analytics';
import { openSearch } from '../browser/search';
import {
  fetchCompanyLive, liveEnabled, ago, clock, type CompanyLive,
} from '../browser/live';
import * as push from '../browser/push';
import { Favi, oku, pct, signedPct, short, SectionTitle } from '../ui/common';
import { ResultsChart } from '../ui/charts';
import { useAsk, AskButton, AnswerBox } from '../ui/Ask';
import { HoldingRow, TradeRow, EventRow, FilingRow, NewsRow, Empty } from '../ui/Relations';
import { sectorVar } from '../theme';
import AdSlot from '../browser/AdSlot';

type TabKey = 'results' | 'capital' | 'trade' | 'docs';

export default function Company({ code }: { code: string }) {
  const { data } = useData();
  const rec = data!.catalog.get(code);
  const { detail, loading } = useCompany(code);
  const [tab, setTab] = useState<TabKey>('results');
  const ask = useAsk(code);

  useEffect(() => { recordView(code); window.scrollTo?.(0, 0); document.getElementById('main')?.scrollTo({ top: 0 }); }, [code]);

  if (loading) return <div className="k-center" style={{ height: 320 }}><Spinner label="有報の記載を読み込んでいます" /></div>;
  if (!detail || !rec) {
    return (
      <div className="k-page">
        <h1 className="k-title">{rec?.name ?? code}</h1>
        <p className="k-lead">この会社の有価証券報告書は収録していません。非上場の会社は、上場企業の有報に相手として出てくる関係だけを扱っています。</p>
        {rec && <Button icon={<Search20Regular />} onClick={() => openSearch(rec.name)}>Web で検索</Button>}
      </div>
    );
  }

  const d = detail;
  const cur = d.results?.[0];
  // 詳細の s17 は業種の名前が入っている。索引（catalog）の s17 がコードなので、そちらを使う
  const sc = rec.s17;
  const tile = data!.index.sectors.find((s) => s.code === sc);
  const nCap = d.holdings.length + d.held_by.length + d.shareholders.length;
  const nDocs = (d.events?.length ?? 0) + (d.filings?.length ?? 0) + d.news.length + d.disclosures.length;

  return (
    <div className="k-page k-company">
      <Breadcrumb aria-label="現在地" className="k-crumbs">
        <BreadcrumbItem><BreadcrumbButton onClick={() => go(href.sectors())}>業種と企業</BreadcrumbButton></BreadcrumbItem>
        <BreadcrumbDivider />
        <BreadcrumbItem><BreadcrumbButton onClick={() => go(href.sectors(sc))}>{tile?.name ?? d.s17}</BreadcrumbButton></BreadcrumbItem>
        {/* 公開版は業種と中分類が同じ名前のことが多い。同じなら段を重ねない */}
        {d.s33 && d.s33 !== tile?.name && (<>
          <BreadcrumbDivider />
          <BreadcrumbItem><BreadcrumbButton onClick={() => go(href.sectors(sc, d.s33))}>{d.s33}</BreadcrumbButton></BreadcrumbItem>
        </>)}
        <BreadcrumbDivider />
        <BreadcrumbItem><BreadcrumbButton current>{d.name}</BreadcrumbButton></BreadcrumbItem>
      </Breadcrumb>

      <Card className="k-card k-co-head">
        <span className="k-co-accent" style={{ background: sectorVar(sc) }} />
        <div className="k-co-id">
          <Favi domain={rec.domain} name={d.name} s17={sc} size={56} />
          <div style={{ minWidth: 0 }}>
            <h1 className="k-title k-co-name">{d.name}</h1>
            <div className="k-caption">{[d.formal_name !== d.name ? d.formal_name : null, d.name_en].filter(Boolean).join(' · ')}</div>
            <div className="k-co-badges">
              <Badge appearance="tint" color="brand">{short(d.code)}</Badge>
              <Badge appearance="outline" color="informative">{d.s33}</Badge>
              {d.market && <Badge appearance="outline" color="informative">{marketLabel(d.market)}</Badge>}
              {d.fiscal_year_end && <Badge appearance="outline" color="informative">決算 {d.fiscal_year_end}</Badge>}
              {d.standard && <Badge appearance="outline" color="informative">{d.standard}</Badge>}
            </div>
          </div>
        </div>
        <div className="k-co-actions">
          <Button appearance="primary" icon={<Organization20Regular />} onClick={() => go(href.explore(d.code))}>
            つながりを見る
          </Button>
          <AskButton state={ask} text={`${ask.label} に聞く`}
            onClick={() => ask.run(buildPrompt({ rec, code: d.code, detail: d, path: null }))} />
          <WatchButton code={d.code} />
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button icon={<Open20Regular />}>外部で見る</Button>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {d.domain && <MenuItemLink icon={<Globe20Regular />} href={`https://${d.domain}`} target="_blank" rel="noreferrer">公式サイト</MenuItemLink>}
                {d.doc_id && <MenuItemLink icon={<DocumentPdf20Regular />} target="_blank" rel="noreferrer"
                  href={`https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/${d.doc_id}.pdf`}>有価証券報告書（PDF）</MenuItemLink>}
                {d.doc_id && <MenuItemLink icon={<Document20Regular />} target="_blank" rel="noreferrer"
                  href={`https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?${d.doc_id}`}>EDINET 書類詳細</MenuItemLink>}
                <MenuItemLink icon={<ChartMultiple20Regular />} target="_blank" rel="noreferrer"
                  href={`https://finance.yahoo.co.jp/quote/${short(d.code)}.T`}>株価・IR（Yahoo!ファイナンス）</MenuItemLink>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
        <AnswerBox state={ask} />
      </Card>

      <LiveDisclosures code={d.code} name={d.name} />

      <section className="k-kpi-row" aria-label="主要な数字">
        <Kpi label="売上高" value={oku(d.sales)} note={cur ? `${cur.label}期` : undefined} />
        <Kpi label="営業利益" value={oku(d.op)} note={`利益率 ${pct(d.op_margin)}`} tone={d.op != null && d.op < 0 ? 'k-neg' : ''} />
        <Kpi label="純利益" value={oku(d.np)} tone={d.np != null && d.np < 0 ? 'k-neg' : ''} />
        <Kpi label="自己資本比率" value={pct(d.equity_ratio)} />
        <Kpi label="ROE" value={pct(cur?.roe)} tone={cur?.roe != null && cur.roe < 0 ? 'k-neg' : ''} />
        <Kpi label="従業員" value={cur?.employees != null ? cur.employees.toLocaleString() : '—'} note={d.basis ?? undefined} />
      </section>

      <TabList selectedValue={tab} onTabSelect={(_, v) => setTab(v.value as TabKey)} className="k-co-tabs" size="large">
        <Tab value="results">業績</Tab>
        <Tab value="capital">資本関係 {nCap > 0 && <CounterBadge count={nCap} size="small" appearance="ghost" color="informative" overflowCount={999} />}</Tab>
        <Tab value="trade">取引 {d.trade?.length > 0 && <CounterBadge count={d.trade.length} size="small" appearance="ghost" color="informative" />}</Tab>
        <Tab value="docs">開示 {nDocs > 0 && <CounterBadge count={nDocs} size="small" appearance="ghost" color="informative" />}</Tab>
      </TabList>

      <div className="k-co-panel k-rise" key={tab}>
        {tab === 'results' && <ResultsTab d={d} />}
        {tab === 'capital' && <CapitalTab d={d} />}
        {tab === 'trade' && (
          <Card className="k-card">
            <SectionTitle title="取引関係" note="有報「主要な顧客ごとの情報」と、政策保有の保有目的より" />
            {d.trade?.length ? d.trade.map((t, i) => (
              <TradeRow key={i} rel={t} onOpen={t.code ? () => go(href.company(t.code!)) : undefined} />
            )) : <Empty>有報に主要な取引先の記載がありません。売上の10%以上を占める顧客がいない会社は、この欄が空になります。</Empty>}
          </Card>
        )}
        {tab === 'docs' && <DocsTab d={d} />}
      </div>

      {/* 本文の後ろに置く。操作要素の近くに出すと誤タップを招く */}
      <AdSlot slot="2222222222" />

      <div className="k-co-ids k-caption">
        {d.edinet_code && <span>EDINET {d.edinet_code}</span>}
        {d.corp_number && <span>法人番号 {d.corp_number}</span>}
        {d.capital != null && <span>資本金 {oku(d.capital * 1e6)}円</span>}
        {d.results_submitted && <span>有報 {d.results_submitted} 提出</span>}
      </div>
    </div>
  );
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <Card className="k-kpi-card" appearance="filled-alternative">
      <div className="k-caption">{label}</div>
      <div className={`k-kpi-big k-num ${tone ?? ''}`}>{value}</div>
      {note && <div className="k-caption">{note}</div>}
    </Card>
  );
}

function ResultsTab({ d }: { d: Detail }) {
  const pretaxLabel = d.standard && d.standard !== 'Japan GAAP' ? '税引前利益' : '経常利益';
  if (!d.results?.length && !d.financials.length) {
    return <Card className="k-card"><Empty>業績を取り出せませんでした。</Empty></Card>;
  }
  return (
    <>
      {d.results?.length > 0 && (
        <Card className="k-card">
          <SectionTitle title="業績の推移"
            note={`有報「主要な経営指標等の推移」${d.basis ? ` · ${d.basis}` : ''}${d.standard ? ` · ${d.standard}` : ''}`} />
          <ResultsChart rows={d.results} pretaxLabel={pretaxLabel} />
          <div className="k-table-scroll">
            <Table size="small" className="k-table" aria-label="業績の推移">
              <TableHeader>
                <TableRow>
                  {['期', '売上高', '営業利益', pretaxLabel, '純利益', '自己資本比率', 'ROE', 'EPS', '配当', '従業員'].map((h, i) => (
                    <TableHeaderCell key={h} className={i ? 'k-th-num' : ''}>{h}</TableHeaderCell>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.results.map((r) => (
                  <TableRow key={r.label + r.rel}>
                    <TableCell className="k-num">{r.label}</TableCell>
                    <TableCell className="k-td-num k-num">{oku(r.sales)}</TableCell>
                    <TableCell className={`k-td-num k-num ${r.op != null && r.op < 0 ? 'k-neg' : ''}`}>{oku(r.op)}</TableCell>
                    <TableCell className={`k-td-num k-num ${r.pretax != null && r.pretax < 0 ? 'k-neg' : ''}`}>{oku(r.pretax)}</TableCell>
                    <TableCell className={`k-td-num k-num ${r.np != null && r.np < 0 ? 'k-neg' : ''}`}>{oku(r.np)}</TableCell>
                    <TableCell className="k-td-num k-num">{pct(r.equity_ratio)}</TableCell>
                    <TableCell className={`k-td-num k-num ${r.roe != null && r.roe < 0 ? 'k-neg' : ''}`}>{pct(r.roe)}</TableCell>
                    <TableCell className="k-td-num k-num">{r.eps != null ? r.eps.toFixed(1) : '—'}</TableCell>
                    <TableCell className="k-td-num k-num">{r.dividend != null ? `${r.dividend}円` : '—'}</TableCell>
                    <TableCell className="k-td-num k-num">{r.employees != null ? r.employees.toLocaleString() : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="k-note">
            年1回の開示なので四半期の動きは映りません。営業利益は推移表に載らず損益計算書から取るため、直近2期ぶんだけです。
          </p>
        </Card>
      )}

      {d.financials.length > 0 && (
        <Card className="k-card">
          <SectionTitle title="決算の推移" note={`決算短信 · ${d.financials.length} 期`} />
          <div className="k-table-scroll">
            <Table size="small" className="k-table">
              <TableHeader><TableRow>
                {['開示日', '期', '売上高', '営業利益', '純利益', 'EPS', '通期営業利益（会社予想）'].map((h, i) => (
                  <TableHeaderCell key={h} className={i > 1 ? 'k-th-num' : ''}>{h}</TableHeaderCell>
                ))}
              </TableRow></TableHeader>
              <TableBody>
                {d.financials.map((f, i) => (
                  <TableRow key={i}>
                    <TableCell className="k-num">{f.date}</TableCell><TableCell>{f.period}</TableCell>
                    <TableCell className="k-td-num k-num">{oku(f.sales)}</TableCell>
                    <TableCell className="k-td-num k-num">{oku(f.op)}</TableCell>
                    <TableCell className="k-td-num k-num">{oku(f.np)}</TableCell>
                    <TableCell className="k-td-num k-num">{f.eps != null ? f.eps.toFixed(2) : '—'}</TableCell>
                    <TableCell className="k-td-num k-num">{oku(f.f_op)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {d.surprises.length > 0 && (
        <Card className="k-card">
          <SectionTitle title="通期進捗と株価反応" note="進捗率の水準は四半期で決まるため、比較できるのは同日順位のほう" />
          <div className="k-table-scroll">
            <Table size="small" className="k-table">
              <TableHeader><TableRow>
                {['開示日', '期', '通期進捗（予想比）', '同日順位', '5日超過リターン'].map((h, i) => (
                  <TableHeaderCell key={h} className={i > 1 ? 'k-th-num' : ''}>{h}</TableHeaderCell>
                ))}
              </TableRow></TableHeader>
              <TableBody>
                {d.surprises.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell className="k-num">{s.date}</TableCell><TableCell>{s.period}</TableCell>
                    <TableCell className="k-td-num k-num">{pct(s.progress, 0)}</TableCell>
                    <TableCell className={`k-td-num k-num ${s.pctile == null ? '' : s.pctile > 0.5 ? 'k-pos' : 'k-neg'}`}>
                      {s.pctile == null ? '—' : `上位 ${(100 - s.pctile * 100).toFixed(0)}% / ${s.day_n}社`}
                    </TableCell>
                    <TableCell className={`k-td-num k-num ${s.excess == null ? '' : s.excess > 0 ? 'k-pos' : 'k-neg'}`}>{signedPct(s.excess, 2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </>
  );
}

function CapitalTab({ d }: { d: Detail }) {
  const mutual = d.holdings.filter((h) => h.mutual === '有').length;
  const total = d.holdings.reduce((a, h) => a + (h.value ?? 0), 0);
  return (
    <div className="k-two">
      <Card className="k-card">
        <SectionTitle title="政策保有している銘柄"
          note={<>有報「特定投資株式の明細」 · {d.holdings.length} 銘柄 · 計 {oku(total)}円{mutual > 0 && ` · 持ち合い ${mutual}`}</>} />
        {d.holdings.length ? d.holdings.map((h, i) => (
          <HoldingRow key={i} code={h.code} name={h.name || h.raw} value={h.value} shares={h.shares}
            purpose={h.purpose} mutual={h.mutual} onOpen={h.code ? () => go(href.company(h.code!)) : undefined} />
        )) : <Empty>政策保有株の記載がありません</Empty>}
      </Card>
      <div className="k-stack">
        <Card className="k-card">
          <SectionTitle title="この会社を政策保有している企業" note={`${d.held_by.length} 社の有報に記載`} />
          {d.held_by.length ? d.held_by.map((h, i) => (
            <HoldingRow key={i} code={h.code} name={h.name} value={h.value}
              purpose={h.purpose} mutual={h.mutual} onOpen={() => go(href.company(h.code))} />
          )) : <Empty>ほかの上場企業の有報に、保有先として載っていません</Empty>}
        </Card>
        <Card className="k-card">
          <SectionTitle title="大株主" note="有報「大株主の状況」。信託口・カストディ等を除いた上位" />
          {d.shareholders.length ? d.shareholders.map((s, i) => (
            <div key={i} className="k-rel" data-tap={!!s.code} onClick={() => s.code && go(href.company(s.code))}
              role={s.code ? 'link' : undefined} tabIndex={s.code ? 0 : undefined}>
              <div className="k-rel-head">
                <span className="k-rank k-num">{s.rank ?? '—'}</span>
                <span className="k-rel-name">{s.name}</span>
                {s.code && <Badge appearance="tint" color="brand" size="small">上場</Badge>}
                {s.code && <ChevronRight16Regular className="k-muted" />}
              </div>
            </div>
          )) : <Empty>大株主の記載を取り出せませんでした</Empty>}
        </Card>
      </div>
    </div>
  );
}

function DocsTab({ d }: { d: Detail }) {
  return (
    <div className="k-two">
      <Card className="k-card">
        <SectionTitle title="最近の出来事" note="臨時報告書の本文より" />
        {d.events?.length ? d.events.map((e, i) => <EventRow key={i} ev={e} />) : <Empty>直近1年の臨時報告書はありません</Empty>}
      </Card>
      <div className="k-stack">
        <Card className="k-card">
          <SectionTitle title="提出書類" note="EDINET" />
          {d.filings?.length ? d.filings.map((f, i) => <FilingRow key={i} f={f} />) : <Empty>記録がありません</Empty>}
        </Card>
        {d.disclosures.length > 0 && (
          <Card className="k-card">
            <SectionTitle title="適時開示" note="TDnet" />
            {d.disclosures.map((x, i) => (
              <FilingRow key={i} f={{ doc_id: '', title: x.title, submitted: x.date, doc_type: '' }} />
            ))}
          </Card>
        )}
        {d.news.length > 0 && (
          <Card className="k-card">
            <SectionTitle title="ニュース" />
            {d.news.map((n, i) => <NewsRow key={i} n={n} />)}
          </Card>
        )}
      </div>
    </div>
  );
}

/* ---------------- 速報 ----------------
   静的な配信データは1日1回の作り直しなので、その日に出た開示は載らない。
   Worker が10分おきに集めたぶんを、画面を開いたときに引く。無ければ枠ごと出さない。 */

function LiveDisclosures({ code, name }: { code: string; name: string }) {
  const [live, setLive] = useState<CompanyLive | null>(null);
  const [busy, setBusy] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!liveEnabled) return;
    let alive = true;
    setBusy(true);
    fetchCompanyLive(code, name).then((d) => { if (alive) { setLive(d); setBusy(false); } });
    return () => { alive = false; };
  }, [code, name, tick]);

  if (!liveEnabled || (!busy && !live?.items.length) || (busy && !live)) return null;

  return (
    <Card className="k-card k-live-card">
      <SectionTitle icon={<span className="k-live" />} title="最新の開示"
        note={live?.crawled_at ? `${ago(live.crawled_at)}に更新` : undefined}
        action={<Button size="small" appearance="subtle" icon={<ArrowClockwise16Regular />} disabled={busy}
          onClick={() => setTick((t) => t + 1)} aria-label="読み直す" />} />
      {live!.items.map((it) => (
        <a key={it.id} className="k-rel k-rel-link" data-tap="true" data-flag={it.important}
          href={it.url} target="_blank" rel="noreferrer">
          <div className="k-rel-head">
            <span className="k-num k-time">{clock(it.disclosed_at)}</span>
            <span className="k-rel-name k-rel-wrap">{it.title}</span>
            {it.important && <Badge appearance="tint" color="warning" size="small">重要</Badge>}
            <Open20Regular className="k-muted" />
          </div>
        </a>
      ))}
    </Card>
  );
}

/** この銘柄の重要な開示を通知する。初回は許可のダイアログが出る */
function WatchButton({ code }: { code: string }) {
  const watched = push.useWatch().includes(code);
  const [state, setState] = useState<push.PushState>('unsupported');
  useEffect(() => { push.state().then(setState); }, []);
  if (state === 'unsupported' || state === 'unavailable') return null;
  const denied = state === 'denied';
  return (
    <Tooltip relationship="label" content={denied ? 'ブラウザ側で通知が拒否されています'
      : watched ? '通知を止める' : '重要な開示（臨時報告書・大量保有・公開買付）を通知する'}>
      <Button icon={watched ? <AlertOn20Regular /> : <Alert20Regular />}
        appearance={watched ? 'primary' : 'secondary'}
        onClick={async () => {
          await push.toggleWatch(code);
          if (!watched && state !== 'on') setState(await push.enable());
        }}>
        {watched ? '通知中' : '通知'}
      </Button>
    </Tooltip>
  );
}
