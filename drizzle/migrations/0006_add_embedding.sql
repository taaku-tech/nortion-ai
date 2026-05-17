-- 0006_add_embedding.sql
-- notion_ai.pages に pgvector の embedding カラムを追加する
-- Supabase では vector 拡張がデフォルト有効だが念のため CREATE EXTENSION IF NOT EXISTS で安全に実行
-- 手動適用: Supabase SQL Editor で実行する

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE notion_ai.pages
ADD COLUMN embedding vector(768);
