-- Migration: 0004_add_company_name
-- 手動実行: Supabase SQL Editor に貼り付けて実行
-- 目的: Notion の「会社名」プロパティを保存するカラムを追加

ALTER TABLE notion_ai.pages
  ADD COLUMN IF NOT EXISTS company_name TEXT;
