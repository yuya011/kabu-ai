import { useEffect, useRef } from 'react';

/* 広告枠。
 *
 * 発行元IDが設定されていなければ何も描かない。設定前でもアプリはそのまま動くし、
 * 枠の跡も残らない。統計の受け口と同じ考え方である。
 *
 * AdSense は自分で取得したドメインでないと審査を受けられない。
 * github.io は GitHub が持つ共有ドメインなので、独自ドメインに移すまで
 * この値は設定できない（設定しても広告は返らない）。
 */

const CLIENT = import.meta.env.VITE_ADSENSE_CLIENT as string | undefined;

declare global {
  interface Window { adsbygoogle?: unknown[] }
}

let scriptLoaded = false;

function ensureScript() {
  if (scriptLoaded || !CLIENT) return;
  scriptLoaded = true;
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`;
  document.head.appendChild(s);
}

export interface AdSlotProps {
  /** AdSense の広告ユニットID */
  slot: string;
  /** レイアウト。fluid は記事内、horizontal は横長のバナー */
  format?: 'auto' | 'fluid' | 'horizontal';
  /** 枠の上下に入れる余白 */
  style?: React.CSSProperties;
}

export default function AdSlot({ slot, format = 'auto', style }: AdSlotProps) {
  const ref = useRef<HTMLModElement>(null);
  const pushed = useRef(false);

  useEffect(() => {
    if (!CLIENT || pushed.current) return;
    ensureScript();
    // 同じ枠に二度積むと AdSense が例外を投げるので一度だけ
    pushed.current = true;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* 読み込みに失敗しても本題ではないので黙って捨てる */
    }
  }, []);

  if (!CLIENT) return null;

  return (
    <div className="k-ad" style={style}>
      <div className="k-caption" style={{ marginBottom: 4 }}>広告</div>
      <ins
        ref={ref}
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={CLIENT}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
}
