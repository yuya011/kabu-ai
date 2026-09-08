import { useState, lazy, Suspense } from 'react';
import { ArrowLeft } from 'lucide-react';
import CompanyBrowser from './browser/CompanyBrowser';
import GraphExplorer from './browser/GraphExplorer';
import Settings from './browser/Settings';

/* 検証ダッシュボードは初回表示では読み込まない。
   企業ブラウザだけを見る人に、Recharts ごと配る必要はない。 */
const Dashboard = lazy(() => import('./App'));

/* 公開ビルドでは検証ダッシュボードを出さない。
   あれは J-Quants 由来の決算サプライズを表示するもので、
   規約上そのデータを公開サイトに載せられないため、配信データ自体が存在しない。 */
const PUBLIC_BUILD = import.meta.env.VITE_PUBLIC === '1';

type View = 'graph' | 'browser' | 'dashboard' | 'settings';

export default function Shell() {
  const [view, setView] = useState<View>('graph');
  /* 設定から戻る先は、開く前にいた画面。グラフの中心や検索の途中を捨てずに済む */
  const [back, setBack] = useState<View>('graph');

  const openSettings = (from: View) => { setBack(from); setView('settings'); };

  if (view === 'settings') {
    return <Settings onBack={() => setView(back)} />;
  }

  if (view === 'dashboard') {
    return (
      <Suspense fallback={<div style={{ padding: 40, color: '#9ca3af' }}>読み込み中…</div>}>
        <button
          onClick={() => setView('browser')}
          style={{
            position: 'fixed', left: 16, bottom: 16, zIndex: 100,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 980, border: 0,
            background: 'rgba(30,30,30,0.72)',
            backdropFilter: 'saturate(180%) blur(30px)',
            WebkitBackdropFilter: 'saturate(180%) blur(30px)',
            boxShadow: '0 0 0 0.5px rgba(255,255,255,0.12), 0 4px 20px rgba(0,0,0,0.5)',
            color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'default',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif',
          }}
        >
          <ArrowLeft size={14} /> 企業ブラウザへ
        </button>
        <Dashboard />
      </Suspense>
    );
  }

  if (view === 'browser') {
    return <CompanyBrowser
      onOpenDashboard={PUBLIC_BUILD ? undefined : () => setView('dashboard')}
      onBackToGraph={() => setView('graph')}
      onOpenSettings={() => openSettings('browser')} />;
  }

  return <GraphExplorer
    onOpenBrowser={() => setView('browser')}
    onOpenSettings={() => openSettings('graph')} />;
}
