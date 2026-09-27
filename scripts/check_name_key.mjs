/* 社名検索の norm / match が3か所で揃っているかを確かめる。
     src/name_key.py              書き出しと手元の MCP
     worker/nameKey.js            リモート MCP
     frontend/src/browser/nameKey.ts  画面

   コードリストの全社名・ヨミ・英字名と、打たれそうな問い合わせを Python に通し、
   同じ入力を JS / TS に通して1件でも違えば落ちる。

     node scripts/check_name_key.mjs        （Node 22.18 以降。TS をそのまま読む） */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as js from '../worker/nameKey.js';
import * as ts from '../frontend/src/browser/nameKey.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const QUERIES = ['とよた', 'キャノン', '高島屋', '東電', '野村総研', 'スクエニ', 'ntt', 'jt',
  'Toyota Motor Corporation', 'トヨダ', 'キーエンソ', '三菱UFJFG', 'ソフトバンクG', 'ﾄﾖﾀ',
  'ユニクロ', 'JR東日本', '富士フィルム', '(株)髙島屋', 'co', 'セブン&アイ'];

const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(ROOT)})
from src.edinet_client import latest_codelist
from src.name_key import norm, match
d = latest_codelist()
inputs = [s for col in ("提出者名", "提出者名（ヨミ）", "提出者名（英字）")
          for s in d[col].dropna().astype(str)] + json.loads(sys.argv[1])
names = d[d["上場区分"] == "上場"]["提出者名"].dropna().astype(str).tolist()[:400]
qs = [norm(q) for q in json.loads(sys.argv[1])]
json.dump({
  "norm": [[s, norm(s)] for s in inputs],
  "match": [[q, n, match(q, norm(n), "", "")] for q in qs if q for n in names],
}, sys.stdout, ensure_ascii=False)
`;

const out = JSON.parse(execFileSync('python3', ['-c', py, JSON.stringify(QUERIES)],
  { maxBuffer: 1 << 28, encoding: 'utf8' }));

let bad = 0;
const report = (what, input, want, got) => {
  if (++bad <= 20) console.error(`✗ ${what} ${JSON.stringify(input)}: py=${JSON.stringify(want)} got=${JSON.stringify(got)}`);
};

for (const [s, want] of out.norm) {
  for (const [label, mod] of [['js', js], ['ts', ts]]) {
    const got = mod.norm(s);
    if (got !== want) report(`norm(${label})`, s, want, got);
  }
}
for (const [q, name, want] of out.match) {
  for (const [label, mod] of [['js', js], ['ts', ts]]) {
    const got = mod.match(q, mod.norm(name));
    const same = got === null ? want === null
      : want !== null && got[0] === want[0] && Math.abs(got[1] - want[1]) < 1e-9;
    if (!same) report(`match(${label})`, [q, name], want, got);
  }
}

console.log(`norm ${out.norm.length.toLocaleString()} 件 / match ${out.match.length.toLocaleString()} 件 を照合`);
if (bad) {
  console.error(`✗ 不一致 ${bad} 件`);
  process.exit(1);
}
console.log('✓ 3か所で一致');
