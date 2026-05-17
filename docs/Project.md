# Project: nortion-ai — 営業議事録 AI 知識化システム

## なぜこのシステムを作るか

営業活動の中で蓄積されている Notion 議事録には、顧客の課題・ニーズ・競合情報・価格感度など、
戦略的に価値の高い情報が散在している。しかし現状は：

- 議事録が個人ごとに断片化し、組織横断での活用ができていない
- 過去の商談情報を検索・参照するコストが高い
- 「どの顧客が自動化に関心を持っているか」のような横断分析ができない
- 新人営業が過去事例から学ぶ仕組みがない

このシステムは、蓄積された議事録を AI で構造化し、**営業知識 DB** として活用できる状態にすることを目的とする。

---

## フェーズ別ロードマップ

### Phase 0（✅ 完了）: 基盤構築

- [x] Notion API による議事録取得
- [x] Gemini API によるトピック別抽出
- [x] Supabase PostgreSQL への保存（`notion_ai` スキーマ）
- [x] Vercel Cron による自動実行（毎日 3:00 UTC）

### Phase 1（✅ 完了）: 運用安定化

- [x] applicable フラグ導入（営業的に重要な記述のみ）
- [x] Gemini prompt 精緻化（topic 優先ルール・source_excerpt 原文引用限定）
- [x] ヘルスチェックエンドポイント（`/api/health`）
- [x] ゾンビリセット（processing タイムアウト検出）
- [x] content_hash による Gemini extraction skip（本文変化なし時のスキップ）
- [x] エラー構造化記録（`error_type` / `error_msg`）
- [x] Notion metadata 拡張（company_name・location_name）
- [x] 診断スクリプト整備（notion-diagnose / db-extract-check）

### Phase 2（✅ 完了）: 閲覧 UI

- [x] 管理画面（`/admin`）: 営業・訪問状況ダッシュボード
  - 全体サマリー（訪問件数・会社数・topic抽出個数・最終処理日）
  - 週別訪問件数（直近12週、棒グラフ）
  - 会社別議事録件数（横スクロールカード形式、上位30社）
  - topic 別件数（applicable=true）
  - 時系列推移（月別 × topic 別）
- [x] 運用監視画面（`/admin/ops`）: Extraction Health / Error Pages / Retry Warnings / Remaining Work
- [x] 顧客別 topic 一覧（`/admin/customers`）: ソート・件数切替対応
- [x] 検索画面（`/search`）: キーワード・topic・applicable 絞り込み（ILIKE、最大100件）
- [x] Cookie 認証（`/login` / `/logout` / `requireAuth()`）
- [x] 認証変数分離（`ADMIN_PASSWORD` = ログイン用 / `ADMIN_SECRET` = cookie hash 用）
- [x] Notion DB ビュー URL リンク（`NOTION_DATABASE_VIEW_URL`）
- [x] `/login` UI ブランディング（タイトル「Notion営業議事録AI」・サービス説明文・補足文）
- [x] `/admin/customers` スマホ対応（md未満でカード表示・スマホ用ソートボタン・Notion本文リンク）
- [x] `/search` スマホ対応（md未満でカード表示・applicable バッジ・Notion本文リンク）

### Phase 3（⬜ 次）: 知識 DB の深化

- [ ] ページ本文の embeddings 化（pgvector）
- [ ] セマンティック検索（類似事例探索）
- [ ] RAG による「過去の類似商談を参照しながらの提案支援」
- [ ] 競合情報の自動タグ付け・competitors テーブル化
- [ ] 顧客マスタ（companies テーブル）との紐付け

### Phase 4（⬜ 将来）: 営業 AI アシスタント

- [ ] 「この顧客の課題に対する過去の最良アプローチ」を自動提示
- [ ] 商談前ブリーフィング自動生成
- [ ] 提案書ドラフト支援

---

## 現在の実装状況（2026-05-15 時点）

### 本番稼働中

| 機能 | 状態 |
|------|------|
| Notion → Gemini → Supabase パイプライン | ✅ 本番稼働 |
| Vercel Cron（毎日 3:00 UTC） | ✅ 設定済み |
| 議事録ページ処理（37件処理済み） | ✅ |
| `/admin` ダッシュボード | ✅ |
| `/admin/ops` 運用監視 | ✅ |
| `/admin/customers` 顧客別一覧（スマホ対応済み） | ✅ |
| `/search` キーワード検索（スマホ対応済み） | ✅ |
| `/login` ブランディング・説明文 | ✅ |

### DB schema（適用済み migration）

| ファイル | 内容 |
|---------|------|
| 0001_init.sql | テーブル・インデックス・トリガー |
| 0002_add_applicable.sql | applicable カラム |
| 0003_add_processed_at_index.sql | processed_at インデックス（timeout対策） |
| 0004_add_company_name.sql | company_name カラム |
| 0005_add_location_name.sql | location_name カラム |

---

## 非目的（今やらないこと）

- CRM システムの置き換え
- Notion 編集・書き込み
- リアルタイム処理（Cron による非同期処理で十分）
- 社外公開・顧客向け機能
- 汎用 RAG プラットフォームの構築
- JWT 化・OAuth 化・ユーザー管理追加

---

## 設計方針

- **議事録は読み取り専用**: Notion への書き戻しは行わない
- **差分同期**: `last_edited_time` による変更検出で、未変更ページは再処理しない
- **段階的拡張**: 最初は ILIKE 検索、将来 pg_trgm → pgvector へ移行
- **スキーマ分離**: `notion_ai` スキーマで他プロジェクトと分離（KIGEN-NAVIGATOR DB 内に同居）
- **逐次実行**: `/admin` の DB クエリは `Promise.all` ではなく逐次 await（Supabase Transaction Pooler との相性対策）
- **手動 migration**: `drizzle-kit migrate` は使わず Supabase SQL Editor で手動適用

---

## 既知の課題・TODO

| 優先度 | 課題 |
|--------|------|
| 中 | Gemini モデル・プロンプト変更時の再抽出方法が手動リセットのみ |
| 中 | 競合出現頻度（`getCompetitorFrequency`）は実装済みだが UI から削除済み。活用方法検討 |
| 低 | ネストされた Notion ブロック（toggle 内など）は本文取得対象外 |
| 低 | 全文検索は ILIKE のみ（pg_trgm / pgvector 未導入） |
