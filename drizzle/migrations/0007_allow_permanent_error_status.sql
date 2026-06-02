-- Migration: 0007_allow_permanent_error_status
-- permanent_error status を保存できるよう pages_status_check を更新する

ALTER TABLE notion_ai.pages
  DROP CONSTRAINT IF EXISTS pages_status_check;

ALTER TABLE notion_ai.pages
  ADD CONSTRAINT pages_status_check
  CHECK (status IN ('pending', 'processing', 'done', 'error', 'permanent_error'));
