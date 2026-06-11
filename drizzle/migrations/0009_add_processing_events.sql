-- Migration: 0009_add_processing_events
-- 目的: Daily Summary で正常完了件数と再処理件数を正確に集計する

CREATE TABLE IF NOT EXISTS notion_ai.processing_events (
  id              SERIAL      PRIMARY KEY,
  page_id         TEXT        NOT NULL REFERENCES notion_ai.pages(page_id) ON DELETE CASCADE,
  completed_at    TIMESTAMPTZ NOT NULL,
  is_reprocessing BOOLEAN     NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processing_events_completed_at
  ON notion_ai.processing_events (completed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_processing_events_page_completed
  ON notion_ai.processing_events (page_id, completed_at);

INSERT INTO notion_ai.processing_events (page_id, completed_at, is_reprocessing)
SELECT
  p.page_id,
  p.processed_at,
  EXISTS (
    SELECT 1
    FROM notion_ai.extractions e
    WHERE e.page_id = p.page_id
      AND e.created_at < p.processed_at - interval '1 minute'
  )
FROM notion_ai.pages p
WHERE p.status = 'done'
  AND p.processed_at IS NOT NULL
ON CONFLICT (page_id, completed_at) DO NOTHING;
