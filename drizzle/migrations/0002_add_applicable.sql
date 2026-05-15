-- Migration: 0002_add_applicable
-- 手動実行: Supabase SQL Editor に貼り付けて実行

ALTER TABLE notion_ai.extractions
  ADD COLUMN IF NOT EXISTS applicable BOOLEAN NOT NULL DEFAULT FALSE;
