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
- [x] Vercel Cron による自動実行（毎日 23:00 UTC、JST 08:00）

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
- [x] 運用監視画面（`/admin/ops`）: 全体サマリー・Daily Summary・Newly Loaded Pages・Error Pages・Retry Warnings
- [x] 顧客別 topic 一覧（`/admin/customers`）: ソート・件数切替対応
- [x] 検索画面（`/search`）: キーワード・topic・applicable 絞り込み（ILIKE、最大100件）
- [x] Cookie 認証（`/login` / `/logout` / `requireAuth()`）
- [x] 認証変数分離（`ADMIN_PASSWORD` = ログイン用 / `ADMIN_SECRET` = cookie hash 用）
- [x] Notion DB ビュー URL リンク（`NOTION_DATABASE_VIEW_URL`）
- [x] `/login` UI ブランディング（タイトル「Notion営業議事録AI」・サービス説明文・補足文）
- [x] `/admin/customers` スマホ対応（md未満でカード表示・スマホ用ソートボタン・Notion本文リンク）
- [x] `/search` スマホ対応（md未満でカード表示・applicable バッジ・Notion本文リンク）

### Phase 3（🔄 進行中）: 知識 DB の深化・運用改善

- [x] ページ本文の embeddings 化（pgvector / gemini-embedding-001 / vector(768)）
- [x] extraction retry policy 改善（retryable / non-retryable エラー分類）
  - Notion 404/403/401 → `permanent_error`（恒久失敗。retry_count 増加なし・cron 対象外）
  - Notion 404/403/401 の message fallback 判定（`Error(message)` 化された場合も `NOTION_NOT_FOUND` / `NOTION_UNAUTHORIZED` に分類）
  - `done` / `error` / `permanent_error` / `skipped` 確定時に `processing_started_at` を NULL にして stuck 表示を防止
  - `pages_status_check` を `permanent_error` 許可へ更新（0007 migration）
  - 一時的エラー（5xx・429・ネットワーク）→ `error`（従来通り）
- [x] Cron 土日スキップ（JST 曜日判定。Vercel Cron は UTC 実行のため変換必須）
- [x] `/admin/ops` 日別運用監視強化
  - Daily Summary（直近14日 × 新規取込 / 処理 / done / error / retry⚠ / stuck）
  - Newly Loaded Pages（直近20件、created_at 基準）
  - Recent Error Pages 改善（Notion日付 ≠ エラー検出日時 を明示分離、permanent_error 対応）
  - Retry Warnings から permanent_error を除外
  - Health Summary / Remaining Work に permanent_error カード追加
- [x] Cron 運用ログ追加
  - `[cron:sync-notion]` / `[cron:process-pages]` プレフィックスで分離
  - sync は差分同期・本文取得・backfill 件数をログ出力
  - process は zombie reset、targets、page start/done/timing、stop before timeout をログ出力
  - Vercel Runtime Logs で throughput、ゾンビリセット動作、stuck 原因の切り分けが可能に
- [x] Notion Ops Log 追記
  - Resend メール通知は停止
  - `NOTION_OPS_LOG_PAGE_ID` の専用 Notion ページへ Cron 完了結果を append-only で記録
  - 結果（正常終了 / 一部注意）、同期・処理・エラー件数を運用者向け文言で表示
  - `permanent_error` のみでは「一部注意」「対応必要あり」にしない
  - Notion 書き込み失敗時も Cron 本体は 200 成功扱い、Runtime Logs に warning を残す
  - Notion 書き込みは 10 秒 timeout
- [x] Cron 分離・Function 実行時間対策
  - `/api/cron/sync-notion`: Notion DB差分同期・本文キャッシュ保存専用
  - `/api/cron/process-pages`: DB本文キャッシュを使ったGemini抽出・embedding生成専用
  - `/api/cron/extract` は互換endpointとしてsyncのみ実行
  - process-pages は `processOnePage()` 全体に45秒timeoutを設定し、timeout時も `processing` のまま残さない
  - 次ページ開始条件を `PAGE_START_REQUIRED_MS=25_000` に調整し、実測で1回3件処理を確認
  - `done` 更新時は `status='processing'` 条件付きで遅延完了raceを防止
- [x] Notion 差分同期・本文キャッシュ化
  - `cron_sync_state.last_successful_sync_at` により `last_edited_time` 差分同期を実装
  - 5分 safety window で取りこぼしを防止
  - 新規・更新ページのみ本文取得し、`pages.content / content_hash / content_length` に保存
  - `pending AND content_hash IS NULL` の既存ページを backfill 対象に含める
  - process-pages は Notion API を呼ばず、本文キャッシュがあるページのみ処理
  - Ops Log の Date エラーは `majorErrors` クエリ条件を ISO string 化して解消
- [ ] セマンティック検索 UI（類似事例探索、/search への類似検索追加）
- [ ] HNSW インデックス（ページ数増加時のベクトル検索高速化）
- [ ] RAG による「過去の類似商談を参照しながらの提案支援」
- [ ] 競合情報の自動タグ付け・competitors テーブル化
- [ ] 顧客マスタ（companies テーブル）との紐付け

### Phase 4（⬜ 将来）: 営業 AI アシスタント

- [ ] 「この顧客の課題に対する過去の最良アプローチ」を自動提示
- [ ] 商談前ブリーフィング自動生成
- [ ] 提案書ドラフト支援

---

## 現在の実装状況（2026-06-02 時点）

### 本番稼働中

| 機能 | 状態 |
|------|------|
| Notion → Gemini → Supabase パイプライン | ✅ 本番稼働 |
| Vercel Cron（sync 23:00 UTC / process 00:00 UTC、JST 土日スキップ） | ✅ 設定済み |
| 議事録ページ同期・処理（sync-notion / process-pages 分離） | ✅ |
| last_edited_time 差分同期・本文キャッシュ | ✅ |
| extraction retry policy（retryable / non-retryable 分類、message fallback 対応） | ✅ |
| `/admin` ダッシュボード | ✅ |
| `/admin/ops` 運用監視（Daily Summary / Newly Loaded Pages 追加済み） | ✅ |
| `/api/cron/sync-notion` / `/api/cron/process-pages` 運用ログ | ✅ |
| `/api/cron/extract` 互換endpoint（syncのみ、deprecated response） | ✅ |
| Notion Ops Log（`NOTION_OPS_LOG_PAGE_ID` への append-only 運用ログ） | ✅ |
| `/admin/customers` 顧客別一覧（スマホ対応済み） | ✅ |
| `/search` キーワード検索（スマホ対応済み） | ✅ |
| `/login` ブランディング・説明文 | ✅ |
| embedding 生成・保存（gemini-embedding-001 / vector(768)） | ✅ |

### DB schema（適用済み migration）

| ファイル | 内容 |
|---------|------|
| 0001_init.sql | テーブル・インデックス・トリガー |
| 0002_add_applicable.sql | applicable カラム |
| 0003_add_processed_at_index.sql | processed_at インデックス（timeout対策） |
| 0004_add_company_name.sql | company_name カラム |
| 0005_add_location_name.sql | location_name カラム |
| 0006_add_embedding.sql | pgvector 拡張・embedding vector(768) カラム |
| 0007_allow_permanent_error_status.sql | pages_status_check を permanent_error 許可へ更新 |
| 0008_add_cron_sync_state.sql | cron_sync_state テーブル・notion_pages 初期行 |

> `permanent_error` ステータスは `0007_allow_permanent_error_status.sql` で DB の CHECK 制約にも反映済み。

---

## 非目的（今やらないこと）

- CRM システムの置き換え
- 営業議事録DBへの Notion 書き戻し（専用の Notion Ops Log ページへの運用ログ追記は例外）
- リアルタイム処理（Cron による非同期処理で十分）
- 社外公開・顧客向け機能
- 汎用 RAG プラットフォームの構築
- JWT 化・OAuth 化・ユーザー管理追加

---

## 設計方針

- **議事録は読み取り専用**: 営業議事録DBへの Notion 書き戻しは行わない。Cron結果のみ専用の Notion Ops Log ページへ append-only で記録する
- **差分同期**: `last_edited_time` による変更検出で、未変更ページは再処理しない
- **本文キャッシュ**: Notion本文取得は `sync-notion` 側で行い、AI処理はDB上の `pages.content` を使う
- **段階的拡張**: ILIKE 検索から pgvector 類似検索へ段階的に移行
- **スキーマ分離**: `notion_ai` スキーマで他プロジェクトと分離
- **逐次実行**: admin 系ページの DB クエリは全て逐次 await（`Promise.all` 禁止。`max:1` + Supabase Transaction Pooler では接続競合が発生するため）
- **手動 migration**: `drizzle-kit migrate` は使わず Supabase SQL Editor で手動適用
- **embedding**: 3072次元を `.slice(0, 768)` で切り詰め保存（Matryoshka 方式）。類似検索は未実装
- **permanent_error**: Notion 404/403/401 等の恒久失敗は `permanent_error` に分類し、retry_count を増やさず次回 cron 対象からも除外する。Retry Warnings の対象外。既知の削除済みページやテストページであれば通常運用上は対応不要
- **Cron スケジュール**: `/api/cron/sync-notion` は `0 23 * * *`、`/api/cron/process-pages` は `0 0 * * *`。Vercel Hobby の最大59分の実行遅延を考慮して時間帯を分離する。JST 土日はコード側でスキップ（安全装置）
- **Notion Ops Log**: メール通知ではなく `NOTION_OPS_LOG_PAGE_ID` の専用ページに Cron 完了結果を追記。書き込み失敗時も Cron 本体は失敗させない

---

## 既知の課題・TODO

| 優先度 | 課題 |
|--------|------|
| 高 | セマンティック検索 UI（/search に pgvector 類似検索を追加） |
| 中 | HNSW インデックス（ページ数増加時のベクトル検索高速化） |
| 中 | Gemini モデル・プロンプト変更時の再抽出方法が手動リセットのみ |
| 中 | 競合出現頻度（`getCompetitorFrequency`）は実装済みだが UI から削除済み。活用方法検討 |
| 低 | ネストされた Notion ブロック（toggle 内など）は本文取得対象外 |
| 低 | キーワード検索は ILIKE のみ（pg_trgm 未導入、pgvector 類似検索 UI 未実装） |
| 低 | permanent_error ページの一括リセット UI（現状は SQL 手動実行のみ） |
