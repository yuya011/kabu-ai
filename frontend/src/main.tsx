import React from 'react'
import ReactDOM from 'react-dom/client'
import Shell from './Shell.tsx'
import { applySettings } from './settings'
import './index.css'

// index.html の先読みと同じことを、正規の読み込み経路でもう一度やる。
// 先読みが失敗していても（プライベートウィンドウ等）ここで揃う。
applySettings()

// ホーム画面に置いたときに機内でも起動できるようにする。
// 配信 JSON は IndexedDB の担当なので、ここが持つのは画面の外枠だけ。
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => { /* 使えなくてもアプリは動く */ });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Shell />
  </React.StrictMode>,
)
