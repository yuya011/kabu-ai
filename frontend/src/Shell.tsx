/* アプリの外枠。Fluent 2 の Web アプリの定型に合わせて、
   上にヘッダー（ロゴ・全体検索・よく使う操作）、左にナビゲーション、右に本文を置く。

   ナビは広い画面では本文の横に並べ（inline）、狭い画面では上に被せる（overlay）。
   どちらもヘッダー左端のハンバーガーで開閉する。 */

import { lazy, Suspense, useEffect, useState } from 'react';
import {
  FluentProvider, Button, Tooltip, Spinner,
  NavDrawer, NavDrawerBody, NavItem, NavSectionHeader, NavDivider,
  Hamburger, MessageBar, MessageBarBody, MessageBarTitle,
} from '@fluentui/react-components';
import {
  bundleIcon,
  Home20Regular, Home20Filled, Organization20Regular, Organization20Filled,
  BuildingMultiple20Regular, BuildingMultiple20Filled, News20Regular, News20Filled,
  PlugConnected20Regular, PlugConnected20Filled, Settings20Regular, Settings20Filled,
  Info20Regular,
  WeatherMoon20Regular, WeatherSunny20Regular, Search20Regular,
  Dismiss20Regular,
} from '@fluentui/react-icons';
import { makeTheme } from './theme';
import { useSettings, updateSettings, resolveTheme } from './settings';
import { useRoute, go, href, type Route } from './router';
import { DataProvider, useData } from './data';
import { ThemeCtx } from './ui/common';
import { Wordmark } from './ui/art';
import { CompanySearch } from './ui/CompanySearch';
import { AboutDialog } from './ui/About';
import { useMedia } from './browser/useMedia';
import { liveEnabled } from './browser/live';
import Home from './pages/Home';
import './ui/keiretsu.css';

/* ホーム以外は開いたときに読む。グラフは d3 と force-graph を抱えていて重く、
   ホームだけを見て帰る人にまで配る必要はない */
const Explore = lazy(() => import('./pages/Explore'));
const Sectors = lazy(() => import('./pages/Sectors'));
const Company = lazy(() => import('./pages/Company'));
const Today = lazy(() => import('./pages/Today'));
const Connect = lazy(() => import('./pages/Connect'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

const I = {
  home: bundleIcon(Home20Filled, Home20Regular),
  explore: bundleIcon(Organization20Filled, Organization20Regular),
  sectors: bundleIcon(BuildingMultiple20Filled, BuildingMultiple20Regular),
  today: bundleIcon(News20Filled, News20Regular),
  connect: bundleIcon(PlugConnected20Filled, PlugConnected20Regular),
  settings: bundleIcon(Settings20Filled, Settings20Regular),
};

/** ナビの選択はルートの種類で決まる。企業ページは業種の下にいる扱い */
const navValue = (r: Route) => (r.name === 'company' ? 'sectors' : r.name);

const TITLES: Record<Route['name'], string> = {
  home: 'ホーム', explore: 'つながりを探索', sectors: '業種と企業', company: '企業',
  today: '本日の開示', connect: 'AI とつなぐ', settings: '設定',
};

export default function Shell() {
  const s = useSettings();
  const mode = resolveTheme(s.theme);
  const theme = makeTheme(mode, s.fontScale);

  return (
    // FluentProvider の className はポータル（ツールチップ等の差し込み口）にも付く。
    // 画面の骨格のクラスをここに付けると、全画面の板がポータルの数だけ重なるので、内側に置く。
    <FluentProvider theme={theme} className="k-provider">
      <ThemeCtx.Provider value={{ theme, mode }}>
        <DataProvider>
          <div className="k-root" data-mode={mode}>
            <Frame mode={mode} />
          </div>
        </DataProvider>
      </ThemeCtx.Provider>
    </FluentProvider>
  );
}

function Frame({ mode }: { mode: 'light' | 'dark' }) {
  const route = useRoute();
  const { data, error } = useData();
  const narrow = useMedia('(max-width: 900px)');
  const [navOpen, setNavOpen] = useState(!narrow);
  const [about, setAbout] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);

  // 幅が変わったら、開閉の既定もそれに合わせ直す
  useEffect(() => { setNavOpen(!narrow); }, [narrow]);
  // 被せる型のナビは、行き先を選んだら閉じる
  useEffect(() => { if (narrow) setNavOpen(false); setMobileSearch(false); }, [route, narrow]);

  useEffect(() => {
    const name = TITLES[route.name];
    document.title = route.name === 'home' ? 'Keiretsu — 上場企業のつながりを有報から' : `${name} · Keiretsu`;
  }, [route]);

  const nav = (
    <NavDrawer
      open={navOpen}
      type={narrow ? 'overlay' : 'inline'}
      onOpenChange={(_, d) => setNavOpen(d.open)}
      selectedValue={navValue(route)}
      className="k-nav"
      density="medium"
    >
      {narrow && (
        <div className="k-nav-head">
          <Hamburger onClick={() => setNavOpen(false)} />
          <Wordmark size={24} />
        </div>
      )}
      <NavDrawerBody>
        <NavItem href={href.home()} value="home" icon={<I.home />}>ホーム</NavItem>
        <NavItem href={href.explore(route.name === 'explore' ? route.code : null)} value="explore" icon={<I.explore />}>
          つながりを探索
        </NavItem>
        <NavItem href={href.sectors()} value="sectors" icon={<I.sectors />}>業種と企業</NavItem>
        {liveEnabled && <NavItem href={href.today()} value="today" icon={<I.today />}>本日の開示</NavItem>}
        <NavSectionHeader>連携</NavSectionHeader>
        <NavItem href={href.connect()} value="connect" icon={<I.connect />}>AI とつなぐ（MCP）</NavItem>
        <NavDivider />
        <NavItem href={href.settings()} value="settings" icon={<I.settings />}>設定</NavItem>
        <NavItem value="about" icon={<Info20Regular />}
          onClick={(e) => { e.preventDefault(); setAbout(true); }}>
          このアプリについて
        </NavItem>
      </NavDrawerBody>
      <div className="k-nav-foot k-caption">
        出典 EDINET（金融庁）· PDL1.0
        {data && <div>{data.index.meta.generated_at} 時点</div>}
      </div>
    </NavDrawer>
  );

  return (
    <div className="k-app">
      <header className="k-header">
        <Tooltip content={navOpen ? 'ナビゲーションを閉じる' : 'ナビゲーションを開く'} relationship="label">
          <Hamburger onClick={() => setNavOpen((v) => !v)} aria-expanded={navOpen} />
        </Tooltip>
        <a className="k-brand" href={href.home()} aria-label="Keiretsu ホーム">
          <Wordmark size={26} />
        </a>

        {!narrow && route.name !== 'home' && (
          <div className="k-header-search">
            <CompanySearch size="medium" placeholder="企業を検索（社名・証券コード）"
              onPick={(c) => go(href.company(c))}
              action={(c) => (
                <Tooltip content="この会社を中心にグラフを描く" relationship="label">
                  <Button size="small" appearance="subtle" icon={<I.explore />}
                    onClick={() => go(href.explore(c))} />
                </Tooltip>
              )} />
          </div>
        )}

        <div className="k-header-actions">
          {narrow && route.name !== 'home' && (
            <Tooltip content="企業を検索" relationship="label">
              <Button appearance="subtle" icon={mobileSearch ? <Dismiss20Regular /> : <Search20Regular />}
                onClick={() => setMobileSearch((v) => !v)} />
            </Tooltip>
          )}
          <Tooltip content={mode === 'dark' ? 'ライトにする' : 'ダークにする'} relationship="label">
            <Button appearance="subtle"
              icon={mode === 'dark' ? <WeatherSunny20Regular /> : <WeatherMoon20Regular />}
              onClick={() => updateSettings({ theme: mode === 'dark' ? 'light' : 'dark' })} />
          </Tooltip>
          {!narrow && (
            <Button appearance="subtle" icon={<I.connect />} as="a" href={href.connect()}>
              AI とつなぐ
            </Button>
          )}
          <Tooltip content="設定" relationship="label">
            <Button appearance="subtle" icon={<I.settings />} as="a" href={href.settings()} />
          </Tooltip>
        </div>
      </header>

      {narrow && mobileSearch && (
        <div className="k-mobile-search">
          <CompanySearch autoFocus placeholder="社名・証券コード" onPick={(c) => go(href.company(c))} />
        </div>
      )}

      <div className="k-body">
        {nav}
        <main className="k-main" data-route={route.name} id="main">
          {error ? (
            <div className="k-page">
              <MessageBar intent="error">
                <MessageBarBody>
                  <MessageBarTitle>データを読み込めません</MessageBarTitle>
                  {error} — <code>python scripts/export_browser_json.py</code> を実行してください。
                </MessageBarBody>
              </MessageBar>
            </div>
          ) : !data ? (
            <div className="k-center"><Spinner label="企業の索引を読み込んでいます" /></div>
          ) : (
            <Suspense fallback={<div className="k-center"><Spinner size="small" /></div>}>
              <Page route={route} onAbout={() => setAbout(true)} />
            </Suspense>
          )}
        </main>
      </div>

      <AboutDialog open={about} onClose={() => setAbout(false)} mode={mode} />
    </div>
  );
}

function Page({ route, onAbout }: { route: Route; onAbout: () => void }) {
  switch (route.name) {
    case 'explore': return <Explore code={route.code} />;
    case 'sectors': return <Sectors s17={route.s17} s33={route.s33} mkt={route.mkt} />;
    case 'company': return <Company key={route.code} code={route.code} />;
    case 'today': return <Today />;
    case 'connect': return <Connect />;
    case 'settings': return <SettingsPage />;
    default: return <Home onAbout={onAbout} />;
  }
}
