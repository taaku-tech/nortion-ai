/**
 * 環境変数の読み込みとバリデーション。
 * 必須変数が未設定の場合はリクエスト処理時（初回アクセス時）にエラーを投げる。
 * next build 時には評価されないため、ビルドは通る。
 */

type Config = ReturnType<typeof buildConfig>;

let _cache: Config | null = null;

function buildConfig() {
  const required = {
    DATABASE_URL:       process.env.DATABASE_URL,
    NOTION_TOKEN:       process.env.NOTION_TOKEN,
    NOTION_DATABASE_ID: process.env.NOTION_DATABASE_ID,
    GEMINI_API_KEY:     process.env.GEMINI_API_KEY,
    CRON_SECRET:        process.env.CRON_SECRET,
    ADMIN_SECRET:       process.env.ADMIN_SECRET,
    ADMIN_PASSWORD:     process.env.ADMIN_PASSWORD,
  } satisfies Record<string, string | undefined>;

  for (const [key, val] of Object.entries(required)) {
    if (!val) throw new Error(`Missing required env var: ${key}`);
  }

  return {
    db: {
      url: required.DATABASE_URL!,
    },
    notion: {
      token:           required.NOTION_TOKEN!,
      databaseId:      required.NOTION_DATABASE_ID!,
      apiVersion:      process.env.NOTION_API_VERSION       ?? '2022-06-28',
      dateProperty:    process.env.NOTION_DATE_PROPERTY     ?? '日付',
      databaseViewUrl: process.env.NOTION_DATABASE_VIEW_URL ?? null,
    },
    gemini: {
      apiKey: required.GEMINI_API_KEY!,
      model:  process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    },
    cron: {
      secret: required.CRON_SECRET!,
    },
    admin: {
      password: required.ADMIN_PASSWORD!,
      secret:   required.ADMIN_SECRET!,
    },
    processing: {
      batchSize:        parseInt(process.env.BATCH_SIZE        ?? '10',   10),
      sleepMs:          parseInt(process.env.SLEEP_MS          ?? '1000', 10),
      zombieTimeoutMin: parseInt(process.env.ZOMBIE_TIMEOUT_MIN ?? '15',   10),
      maxRetries:       3,
    },
  } as const;
}

/** 設定オブジェクトを取得する（初回呼び出し時にバリデーション＆キャッシュ） */
export function getConfig(): Config {
  if (!_cache) _cache = buildConfig();
  return _cache;
}
