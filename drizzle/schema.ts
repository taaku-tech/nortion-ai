import {
  pgSchema,
  text,
  integer,
  serial,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const notionAi = pgSchema('notion_ai');

export const pages = notionAi.table(
  'pages',
  {
    pageId:              text('page_id').primaryKey(),
    title:               text('title'),
    notionDate:          text('notion_date'),

    // Notion API から取得。変化があれば status を pending に戻して再処理する
    lastEditedTime:      timestamp('last_edited_time', { withTimezone: true }),

    // 本文テキスト（キャッシュ）と変更検出用ハッシュ
    content:             text('content'),
    contentHash:         text('content_hash'),
    contentLength:       integer('content_length'),

    // pending | processing | done | error
    status:              text('status').notNull().default('pending'),

    // 構造化エラー情報
    errorType:           text('error_type'),
    errorMsg:            text('error_msg'),
    retryCount:          integer('retry_count').notNull().default(0),

    // ゾンビ検出の基準時刻（processing にセットした瞬間を記録）
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    processedAt:         timestamp('processed_at',          { withTimezone: true }),

    createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_notion_ai_pages_status').on(t.status),
    index('idx_notion_ai_pages_last_edited').on(t.lastEditedTime),
    index('idx_notion_ai_pages_processing_started').on(t.processingStartedAt),
  ],
);

export const extractions = notionAi.table(
  'extractions',
  {
    id:            serial('id').primaryKey(),
    pageId:        text('page_id').notNull().references(() => pages.pageId, { onDelete: 'cascade' }),
    topic:         text('topic').notNull(),
    applicable:    boolean('applicable').notNull().default(false),
    sourceExcerpt: text('source_excerpt').notNull().default(''),
    summary:       text('summary').notNull().default(''),
    createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_notion_ai_extractions_page_id').on(t.pageId),
    uniqueIndex('idx_notion_ai_extractions_page_topic').on(t.pageId, t.topic),
  ],
);

// ─── 型エクスポート ────────────────────────────────────────────────────────────

export type Page       = typeof pages.$inferSelect;
export type NewPage    = typeof pages.$inferInsert;
export type Extraction = typeof extractions.$inferSelect;

/** pages.status の許容値 */
export type PageStatus = 'pending' | 'processing' | 'done' | 'error';

/** error_type の許容値 */
export type ErrorType =
  | 'NOTION_FETCH'
  | 'GEMINI_API'
  | 'GEMINI_RATE_LIMIT'
  | 'GEMINI_TIMEOUT'
  | 'GEMINI_PARSE'
  | 'DB_WRITE'
  | 'UNKNOWN';
