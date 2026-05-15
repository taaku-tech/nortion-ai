# TODO.md — 未実装・後続タスク

> 実装済み仕様は `docs/SPEC.md`、構想は `docs/Project.md` を参照。

---

## 優先度: 高（Phase 3 準備）

### Embeddings / セマンティック検索

- [ ] pgvector 拡張の有効化（Supabase SQL Editor）
- [ ] `extractions.embedding` カラム追加
- [ ] Gemini Embedding API による埋め込み生成
- [ ] Cron 処理への embedding 生成ステップ追加
- [ ] 類似事例検索の実装（`/search` に追加）

---

## 優先度: 中

### Notion 本文取得改善

- [ ] ネストされた children ブロック（toggle 内の段落など）の再帰取得
- [ ] 100件超のページネーション対応（現在は page_size=100 の1回のみ）

### 抽出品質改善

- [ ] few-shot examples をプロンプトに追加
- [ ] 「増産」「自動化」の検出率向上の検証
- [ ] applicable=false 率・topic 別件数のモニタリング

### DB 改善

- [ ] `companies` テーブル追加（顧客マスタとして company_name を正規化）
- [ ] `competitors` テーブル化（現在は固定キーワード配列）

### 運用・監視

- [ ] Cron 失敗時のアラート（Slack 通知等）
- [ ] DB 接続確認を含むヘルスチェック（`/api/health` の強化）
- [ ] Vercel Log Drains / Sentry 導入

---

## 優先度: 低（将来構想）

### 全文検索強化

- [ ] pg_trgm 拡張の有効化
- [ ] `GIN` インデックスの追加（`pages.content`）
- [ ] 日本語形態素解析（pgroonga 等）の検討

### RAG / 営業 AI

- [ ] 過去の類似商談事例を参照しながらの提案支援
- [ ] 商談前ブリーフィング自動生成
- [ ] 提案書ドラフト支援

### 本格認証

- [ ] next-auth または Supabase Auth の導入（現状は cookie 簡易認証）
- [ ] セッション管理・ユーザー別権限

---

## 技術的負債

- [ ] `scripts/` の診断スクリプトをテストとして整備
- [ ] `npx tsc --noEmit` の CI 組み込み
