-- Migration: 0008_add_cron_sync_state
-- Cron差分同期の成功時刻を保存する

CREATE TABLE IF NOT EXISTS notion_ai.cron_sync_state (
  name                    TEXT PRIMARY KEY,
  last_successful_sync_at TIMESTAMPTZ,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO notion_ai.cron_sync_state (name, last_successful_sync_at)
VALUES ('notion_pages', NULL)
ON CONFLICT (name) DO NOTHING;
