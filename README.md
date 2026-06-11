# nortion-ai

Notion 議事録を Gemini API でトピック別に抽出し、Supabase に保存する自動処理システム。

---

## セットアップ

### 1. 依存パッケージインストール

```bash
npm install
```

### 2. 環境変数の設定

```bash
cp .env.example .env.local
```

`.env.local` を編集し、以下を設定してください。

| 変数 | 必須 | 説明 |
|------|------|------|
| `DATABASE_URL` | ✅ | Supabase Transaction Pooler URL（port 6543） |
| `DATABASE_URL_DIRECT` | ✅ | Supabase Direct Connection URL（port 5432、migration用） |
| `NOTION_TOKEN` | ✅ | Notion Integration のアクセストークン |
| `NOTION_DATABASE_ID` | ✅ | 対象 Notion データベースの ID |
| `NOTION_OPS_LOG_PAGE_ID` | - | Cron完了結果を追記する専用 Notion 運用ログページ ID |
| `NOTION_DATE_PROPERTY` | - | 日付プロパティ名（未設定時は "日付"。空文字でsort無効） |
| `GEMINI_API_KEY` | ✅ | Google Gemini API キー |
| `CRON_SECRET` | ✅ | Cron エンドポイント保護用シークレット |
| `ADMIN_PASSWORD` | ✅ | `/login` のログインパスワード |
| `ADMIN_SECRET` | ✅ | cookie hash / session integrity 用シークレット |
| `GEMINI_MODEL` | - | 使用モデル（デフォルト: gemini-2.5-flash） |
| `BATCH_SIZE` | - | 1回の Cron で処理する最大件数（デフォルト: 10） |
| `SLEEP_MS` | - | ページ間処理の待機時間 ms（デフォルト: 1000） |
| `ZOMBIE_TIMEOUT_MIN` | - | processing タイムアウト分（デフォルト: 15） |
| `NOTION_API_VERSION` | - | Notion API バージョン（デフォルト: 2022-06-28） |

シークレット生成:

```bash
openssl rand -hex 32
```

### 3. Supabase マイグレーション

Supabase ダッシュボードの **SQL Editor** で以下のファイルを順番に実行してください。

```
drizzle/migrations/0001_init.sql       # テーブル・インデックス・トリガー作成
drizzle/migrations/0002_add_applicable.sql  # applicable カラム追加
drizzle/migrations/0003_add_processed_at_index.sql
drizzle/migrations/0004_add_company_name.sql
drizzle/migrations/0005_add_location_name.sql
drizzle/migrations/0006_add_embedding.sql
drizzle/migrations/0007_allow_permanent_error_status.sql
drizzle/migrations/0008_add_cron_sync_state.sql
drizzle/migrations/0009_add_processing_events.sql
```

> **注意**: `drizzle-kit migrate` は使用しません。手動 SQL 適用で統一しています。

### 4. Notion プロパティの確認

実際の Notion DB プロパティ名を確認するには:

```bash
npm run notion:diagnose
```

日付プロパティが "日付" 以外の場合は `.env.local` に設定:

```
NOTION_DATE_PROPERTY=開催日
```

---

## ローカル開発

```bash
npm run dev
```

### 動作確認

```bash
# ヘルスチェック
curl http://localhost:3000/api/health

# Cron 手動実行（Authorization ヘッダー）
SECRET=$(grep CRON_SECRET .env.local | cut -d= -f2)
curl -H "Authorization: Bearer $SECRET" http://localhost:3000/api/cron/extract

# Cron 手動実行（ブラウザ・URL確認用）
curl "http://localhost:3000/api/cron/extract?secret=$SECRET"
```

レスポンス例:

```json
{
  "ok": true,
  "synced": 10,
  "processed": 5,
  "done": 5,
  "error": 0,
  "zombieReset": 0,
  "remaining": 0
}
```

### 診断ツール

```bash
# Notion DB プロパティ確認
npm run notion:diagnose

# ページ本文取得テスト（先頭1件）
npm run notion:page-diagnose

# 抽出結果品質確認
npm run db:extract-check
```

---

## Vercel デプロイ

### 1. GitHub リポジトリへ push

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/<org>/<repo>.git
git push -u origin main
```

### 2. Vercel プロジェクト作成

1. [vercel.com](https://vercel.com) → **Add New Project**
2. GitHub リポジトリをインポート
3. Framework: **Next.js**（自動検出）
4. **Deploy**

### 3. 環境変数の設定

Vercel ダッシュボード → **Settings → Environment Variables** で以下を設定:

```
DATABASE_URL
NOTION_TOKEN
NOTION_DATABASE_ID
NOTION_OPS_LOG_PAGE_ID （任意）
NOTION_DATE_PROPERTY
GEMINI_API_KEY
CRON_SECRET
ADMIN_PASSWORD
ADMIN_SECRET
GEMINI_MODEL        （任意）
BATCH_SIZE          （任意）
SLEEP_MS            （任意）
ZOMBIE_TIMEOUT_MIN  （任意）
NOTION_API_VERSION  （任意）
```

> `DATABASE_URL_DIRECT` は Vercel Function からは不要です（migration 用のみ）。

### 4. Cron 実行確認

`vercel.json` に以下が設定されており、毎日 23:00 UTC（JST 翌 08:00）から自動実行されます。
JST 土日はコード側でスキップされます。

```json
{
  "crons": [
    { "path": "/api/cron/sync-notion", "schedule": "0 23 * * *" },
    { "path": "/api/cron/process-pages", "schedule": "0 0 * * *" }
  ]
}
```

`/api/cron/process-pages` は次の時間帯となる 00:00 UTC（JST 09:00）に実行します。
Vercel Hobby の Cron は指定時刻から最大59分遅延する可能性があるため、同期とAI処理の実行時間帯を分離して順序逆転を防ぎます。

Vercel ダッシュボード → **Settings → Cron Jobs** で実行ログを確認できます。

手動トリガー（Vercel 本番）:

```bash
# Authorization ヘッダー
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-project>.vercel.app/api/cron/sync-notion

curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-project>.vercel.app/api/cron/process-pages

# ブラウザ・URL確認用
curl "https://<your-project>.vercel.app/api/cron/sync-notion?secret=$CRON_SECRET"
curl "https://<your-project>.vercel.app/api/cron/process-pages?secret=$CRON_SECRET"
```

### 5. Supabase で結果確認

Supabase ダッシュボード → **SQL Editor**:

```sql
-- 処理状況
SELECT status, count(*) FROM notion_ai.pages GROUP BY status;

-- applicable=true の抽出結果
SELECT p.title, e.topic, e.summary
FROM notion_ai.extractions e
JOIN notion_ai.pages p ON p.page_id = e.page_id
WHERE e.applicable = true
ORDER BY p.processed_at DESC
LIMIT 20;
```

---

## 利用可能なスクリプト

| コマンド | 説明 |
|---------|------|
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 本番ビルド |
| `npm run verify:build` | 本番ビルド、型チェック、差分チェック |
| `npm run notion:diagnose` | Notion DB プロパティ一覧表示 |
| `npm run notion:page-diagnose` | ページ本文取得テスト |
| `npm run db:extract-check` | 抽出結果品質確認 |
| `npm run db:studio` | Drizzle Studio（DB GUI） |
