# TODO.md — 未実装・後続タスク

> 実装済み仕様は SPEC.md、構想は Project.md を参照。

---

## 優先度: 高

### 管理画面 `/admin`
- [ ] サマリー（総ページ数・done/pending/error 件数・最終処理日時）
- [ ] topic 別 applicable=true 件数カード表示
- [ ] 顧客別 topic 一覧（title / topic / summary / source_excerpt / processed_at）
- [ ] 時系列推移（notion_date 月別 × topic 別件数）
- [ ] 競合キーワード出現頻度（キーエンス・オムロン・Cognex・DAS・AI検査 etc）
- [ ] ADMIN_SECRET によるアクセス保護（`?key=xxx`）

### 検索画面 `/search`
- [ ] キーワード検索（title / content / source_excerpt / summary を ILIKE）
- [ ] topic 絞り込み
- [ ] applicable=true フィルタ
- [ ] 検索結果表示（title / notion_date / topic / source_excerpt / summary）
- [ ] ADMIN_SECRET によるアクセス保護（`?key=xxx`）

### 本格認証
- [ ] ログイン機能（現状は `?key=xxx` の簡易保護のみ）
- [ ] next-auth または Supabase Auth の導入
- [ ] セッション管理

---

## 優先度: 中

### Notion 本文取得改善
- [ ] ネストされた children ブロック（toggle 内の段落など）の再帰取得
- [ ] 100件超ページネーション対応（現在は page_size=100 の1回のみ）

### 抽出品質改善
- [ ] few-shot examples をプロンプトに追加
- [ ] 「増産」「自動化」の検出率向上の検証
- [ ] applicable=false 率・topic 別件数のモニタリング

### DB 改善
- [ ] `companies` テーブル追加（pages.title からの会社名分離）
- [ ] `competitors` テーブル化（現在は固定キーワード配列）
- [ ] `notion_ai.pages` に `company_name` カラム追加

---

## 優先度: 低（将来構想）

### 全文検索強化
- [ ] pg_trgm 拡張の有効化
- [ ] `GIN` インデックスの追加
- [ ] 日本語形態素解析（pgroonga 等）の検討

### Embeddings / セマンティック検索
- [ ] pgvector 拡張の有効化
- [ ] `extractions.embedding` カラム追加
- [ ] Gemini Embedding API による埋め込み生成
- [ ] 類似事例検索の実装

### RAG / 営業 AI
- [ ] 過去の類似商談事例を参照しながらの提案支援
- [ ] 商談前ブリーフィング自動生成
- [ ] 提案書ドラフト支援

### 運用・監視
- [ ] Vercel Log Drains / Sentry 導入
- [ ] DB 接続確認を含むヘルスチェック（`/api/health` の強化）
- [ ] Cron 失敗時のアラート（Slack 通知等）
- [ ] 処理件数・エラー率のダッシュボード

---

## 技術的負債

- [ ] `scripts/` の診断スクリプトをテストとして整備
- [ ] `npx tsc --noEmit` の CI 組み込み
- [ ] `.env.local` に実 API キーが混入しないよう `.gitignore` を確認
