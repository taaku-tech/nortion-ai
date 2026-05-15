-- Migration: 0003_add_processed_at_index
-- 手動実行: Supabase SQL Editor に貼り付けて実行
-- 目的: getPageStats の max(processed_at) フルスキャンによる statement timeout を解消

CREATE INDEX IF NOT EXISTS idx_pages_processed_at
  ON notion_ai.pages (processed_at DESC);
