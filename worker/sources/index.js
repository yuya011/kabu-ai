/* 情報源の一覧。どれを使うかは環境変数で決まる。
 *
 * 既定は EDINET だけ。EDINET は公共データ利用規約(PDL1.0)で再配信まで
 * 認められているので、公開サーバーから配って構わない。
 * 残り2つは配信元が機械的な取得を禁じているため、SOURCES に明示的に
 * 書いたときだけ動く（各ファイルの冒頭に理由を書いてある）。
 */

import * as edinet from './edinet.js';
import * as tdnet from './tdnet.js';
import * as gnews from './gnews.js';

export const ALL = [edinet, tdnet, gnews];

export const active = (env) => ALL.filter((s) => s.enabled(env));

/** Cron で当日ぶんを集められるもの */
export const collectors = (env) => active(env).filter((s) => s.today);

/** 銘柄を開いたときにその場で引けるもの */
export const responders = (env) => active(env).filter((s) => s.onDemand);

export const attributions = (env) => active(env).map((s) => ({ id: s.id, ...s.attribution }));
