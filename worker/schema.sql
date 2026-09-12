-- 閲覧統計。個人を識別する列は持たない。
-- 同じ「銘柄・日・時間帯・国」の組にまとめて数えるので、行数は利用者数に比例しない。
CREATE TABLE IF NOT EXISTS views (
  code    TEXT NOT NULL,
  ymd     TEXT NOT NULL,   -- UTC の日付
  hour    INTEGER NOT NULL,-- UTC の時
  country TEXT NOT NULL,   -- Cloudflare が付ける国コード。IP は保存しない
  n       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (code, ymd, hour, country)
);

CREATE INDEX IF NOT EXISTS idx_views_ymd ON views (ymd);

-- 当日の開示速報。Cron が10分おきに積み、数日で捨てる。
-- 過去分は静的データ（有報・提出書類一覧）が持っているので、ここは速報専用の置き場。
-- id は「情報源:書類ID」。同じものを二度入れないためだけの鍵で、これで再実行が安全になる。
CREATE TABLE IF NOT EXISTS today_disclosures (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL,
  name         TEXT,
  title        TEXT NOT NULL,
  url          TEXT NOT NULL,
  disclosed_at TEXT NOT NULL,  -- 日本時間 'YYYY-MM-DD HH:MM'
  ymd          TEXT NOT NULL,  -- 日本時間の日付。掃除の単位
  category     TEXT,
  important    INTEGER NOT NULL DEFAULT 0,
  source       TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_disc_ymd  ON today_disclosures (ymd, disclosed_at DESC);
CREATE INDEX IF NOT EXISTS idx_disc_code ON today_disclosures (code, disclosed_at DESC);

-- Web Push の購読。ここも識別子は持たない。
-- endpoint は配信元（FCM 等）が発行する URL で、こちらから人を特定する材料にはならない。
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- どの銘柄の開示で鳴らすか。購読を消すと連鎖で消える
CREATE TABLE IF NOT EXISTS push_watch (
  endpoint TEXT NOT NULL,
  code     TEXT NOT NULL,
  PRIMARY KEY (endpoint, code)
);

CREATE INDEX IF NOT EXISTS idx_watch_code ON push_watch (code);

-- 巡回の最終実行時刻など。画面に「⚪︎分前に更新」を出すために使う
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
