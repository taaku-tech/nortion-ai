import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

// drizzle-kit は Next.js の env ローダーを使わないため明示的に読み込む
config({ path: '.env.local' });

export default defineConfig({
  schema: './drizzle/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Direct 接続 URL を使用（Pooler は drizzle-kit migrate で DDL 実行不可）
    url: process.env.DATABASE_URL_DIRECT!,
  },
});
