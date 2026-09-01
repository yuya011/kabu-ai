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
