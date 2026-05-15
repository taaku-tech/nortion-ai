import { or } from 'drizzle-orm';
import { getDb, pages, extractions, sql, eq, and } from './db';

// ─── Admin: 全体サマリー ──────────────────────────────────────────────────────

export type PageStats = {
  total:           number;
  done:            number;
  pending:         number;
  error:           number;
  processing:      number;
  lastProcessedAt: Date | null;
};

export async function getPageStats(): Promise<PageStats> {
  const db = getDb();

  const rows = await db
    .select({
      status: pages.status,
      count:  sql<number>`count(*)::int`,
    })
    .from(pages)
    .groupBy(pages.status);

  const [lastRow] = await db
    .select({ lastProcessedAt: sql<Date | null>`max(processed_at)` })
    .from(pages);

  const stats: PageStats = {
    total: 0, done: 0, pending: 0, error: 0, processing: 0,
    lastProcessedAt: lastRow?.lastProcessedAt ?? null,
  };

  for (const row of rows) {
    stats.total += row.count;
    if      (row.status === 'done')       stats.done       = row.count;
    else if (row.status === 'pending')    stats.pending    = row.count;
    else if (row.status === 'error')      stats.error      = row.count;
    else if (row.status === 'processing') stats.processing = row.count;
  }

  return stats;
}

// ─── Admin: topic 別件数（applicable=true） ──────────────────────────────────

export type TopicCount = { topic: string; count: number };

export async function getTopicCounts(): Promise<TopicCount[]> {
  const db = getDb();
  return db
    .select({
      topic: extractions.topic,
      count: sql<number>`count(*)::int`,
    })
    .from(extractions)
    .where(eq(extractions.applicable, true))
    .groupBy(extractions.topic)
    .orderBy(sql`count(*) desc`);
}

// ─── Admin: 顧客別 topic 一覧 ─────────────────────────────────────────────────

export type CustomerTopic = {
  title:         string | null;
  topic:         string;
  summary:       string;
  sourceExcerpt: string;
  processedAt:   Date | null;
};

export async function getCustomerTopics(limit = 100): Promise<CustomerTopic[]> {
  const db = getDb();
  return db
    .select({
      title:         pages.title,
      topic:         extractions.topic,
      summary:       extractions.summary,
      sourceExcerpt: extractions.sourceExcerpt,
      processedAt:   pages.processedAt,
    })
    .from(extractions)
    .innerJoin(pages, eq(extractions.pageId, pages.pageId))
    .where(eq(extractions.applicable, true))
    .orderBy(sql`${pages.processedAt} desc nulls last`)
    .limit(limit);
}

// ─── Admin: 時系列推移（月別 × topic 別） ────────────────────────────────────

export type MonthlyRow = { month: string; topic: string; count: number };

export async function getMonthlyTrend(): Promise<MonthlyRow[]> {
  const db = getDb();
  return db
    .select({
      month: sql<string>`substring(${pages.notionDate}, 1, 7)`,
      topic: extractions.topic,
      count: sql<number>`count(*)::int`,
    })
    .from(extractions)
    .innerJoin(pages, eq(extractions.pageId, pages.pageId))
    .where(
      and(
        eq(extractions.applicable, true),
        sql`${pages.notionDate} is not null`,
        sql`${pages.notionDate} != ''`,
      ),
    )
    .groupBy(
      sql`substring(${pages.notionDate}, 1, 7)`,
      extractions.topic,
    )
    .orderBy(sql`substring(${pages.notionDate}, 1, 7) desc`);
}

// ─── Admin: 競合出現頻度 ──────────────────────────────────────────────────────

export const COMPETITOR_KEYWORDS = [
  'キーエンス',
  'オムロン',
  'Cognex',
  'コグネックス',
  'DAS',
  'AI検査',
] as const;

export type CompetitorCount = { keyword: string; count: number };

export async function getCompetitorFrequency(): Promise<CompetitorCount[]> {
  const db = getDb();

  const rows = await db.execute(sql`
    SELECT
      k.keyword,
      count(distinct e.page_id)::int AS count
    FROM (VALUES
      (${'キーエンス'}),
      (${'オムロン'}),
      (${'Cognex'}),
      (${'コグネックス'}),
      (${'DAS'}),
      (${'AI検査'})
    ) AS k(keyword)
    LEFT JOIN ${extractions} e
      ON e.summary        ILIKE '%' || k.keyword || '%'
      OR e.source_excerpt ILIKE '%' || k.keyword || '%'
    GROUP BY k.keyword
    ORDER BY count DESC
  `);

  return (rows as unknown as Array<{ keyword: string; count: unknown }>)
    .map(r => ({ keyword: r.keyword, count: Number(r.count) }));
}

// ─── Search: キーワード検索 ───────────────────────────────────────────────────

export type SearchResult = {
  title:         string | null;
  notionDate:    string | null;
  topic:         string;
  sourceExcerpt: string;
  summary:       string;
  processedAt:   Date | null;
};

export async function searchExtractions(params: {
  keyword?:      string;
  topic?:        string;
  applicableOnly?: boolean;
}): Promise<SearchResult[]> {
  const db = getDb();

  const whereClause = and(
    params.applicableOnly ? eq(extractions.applicable, true) : undefined,
    params.topic          ? eq(extractions.topic, params.topic) : undefined,
    params.keyword
      ? or(
          sql`${pages.title} ilike ${'%' + params.keyword + '%'}`,
          sql`${pages.content} ilike ${'%' + params.keyword + '%'}`,
          sql`${extractions.sourceExcerpt} ilike ${'%' + params.keyword + '%'}`,
          sql`${extractions.summary} ilike ${'%' + params.keyword + '%'}`,
        )
      : undefined,
  );

  return db
    .select({
      title:         pages.title,
      notionDate:    pages.notionDate,
      topic:         extractions.topic,
      sourceExcerpt: extractions.sourceExcerpt,
      summary:       extractions.summary,
      processedAt:   pages.processedAt,
    })
    .from(extractions)
    .innerJoin(pages, eq(extractions.pageId, pages.pageId))
    .where(whereClause)
    .orderBy(sql`${pages.processedAt} desc nulls last`)
    .limit(100);
}
