-- Migration: 0005_add_location_name
-- 手動実行: Supabase SQL Editor に貼り付けて実行
-- 目的: Notion の「工場名・拠点名」プロパティを保存するカラムを追加

ALTER TABLE notion_ai.pages
  ADD COLUMN IF NOT EXISTS location_name TEXT;
