-- Migration: 0001_init
-- 手動実行: Supabase SQL Editor に貼り付けて実行
-- ローカル確認: npm run db:studio

CREATE SCHEMA IF NOT EXISTS notion_ai;

-- ─── pages ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notion_ai.pages (
  page_id               TEXT        PRIMARY KEY,
  title                 TEXT,
  notion_date           TEXT,
  last_edited_time      TIMESTAMPTZ,

  -- 本文キャッシュ
  content               TEXT,
  content_hash          TEXT,
  content_length        INTEGER,

  -- pending | processing | done | error
  status                TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'done', 'error')),

  -- 構造化エラー
  error_type            TEXT,
  error_msg             TEXT,
  retry_count           INTEGER     NOT NULL DEFAULT 0,

  -- タイムスタンプ
  processing_started_at TIMESTAMPTZ,
  processed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notion_ai_pages_status
  ON notion_ai.pages (status);

CREATE INDEX IF NOT EXISTS idx_notion_ai_pages_last_edited
  ON notion_ai.pages (last_edited_time DESC);

-- processing ゾンビ検索用（部分インデックスで絞り込み）
CREATE INDEX IF NOT EXISTS idx_notion_ai_pages_processing_started
  ON notion_ai.pages (processing_started_at)
  WHERE status = 'processing';

-- ─── extractions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notion_ai.extractions (
  id             SERIAL      PRIMARY KEY,
  page_id        TEXT        NOT NULL REFERENCES notion_ai.pages(page_id) ON DELETE CASCADE,
  topic          TEXT        NOT NULL,
  source_excerpt TEXT        NOT NULL DEFAULT '',
  summary        TEXT        NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notion_ai_extractions_page_id
  ON notion_ai.extractions (page_id);

-- (page_id, topic) の UNIQUE により UPSERT で冪等書き込みを保証
CREATE UNIQUE INDEX IF NOT EXISTS idx_notion_ai_extractions_page_topic
  ON notion_ai.extractions (page_id, topic);

-- ─── updated_at 自動更新トリガー ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION notion_ai.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pages_updated_at ON notion_ai.pages;
CREATE TRIGGER trg_pages_updated_at
  BEFORE UPDATE ON notion_ai.pages
  FOR EACH ROW EXECUTE FUNCTION notion_ai.set_updated_at();

DROP TRIGGER IF EXISTS trg_extractions_updated_at ON notion_ai.extractions;
CREATE TRIGGER trg_extractions_updated_at
  BEFORE UPDATE ON notion_ai.extractions
  FOR EACH ROW EXECUTE FUNCTION notion_ai.set_updated_at();
