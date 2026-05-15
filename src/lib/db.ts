import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and, lt, sql, inArray } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { getConfig } from './config';

// ─── DB クライアント（サーバーレス向けシングルトン） ──────────────────────────

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (_db) return _db;

  const { db: dbConfig } = getConfig();

  const client = postgres(dbConfig.url, {
    max:     1,     // サーバーレスでは接続数を最小限に
    prepare: false, // Supabase Transaction Pooler (port 6543) では必須
  });

  _db = drizzle(client, { schema });
  return _db;
}

// ─── drizzle-orm ユーティリティの再エクスポート ──────────────────────────────
// 各モジュールが drizzle-orm から直接 import しなくて済むよう一元化する

export { eq, and, lt, sql, inArray };
export { pages, extractions } from '../../drizzle/schema';
export type { Page, NewPage, Extraction, PageStatus, ErrorType } from '../../drizzle/schema';

// ─── SELECT FOR UPDATE SKIP LOCKED の使用例（型確認用コメント） ───────────────
//
// const targets = await db
//   .select()
//   .from(pages)
//   .where(eq(pages.status, 'pending'))
//   .limit(batchSize)
//   .for('update', { skipLocked: true });
//
// ↑ Drizzle が生成する SQL:
//   SELECT * FROM "pages"
//   WHERE "pages"."status" = 'pending'
//   LIMIT $1
//   FOR UPDATE SKIP LOCKED
