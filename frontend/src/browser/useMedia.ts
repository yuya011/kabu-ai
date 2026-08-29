import { useEffect, useState } from 'react';

/** メディアクエリの成否を購読する。SSR はしないので初期値も同期で取れる。 */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(
    () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}
