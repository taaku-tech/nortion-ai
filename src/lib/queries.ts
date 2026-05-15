import { or } from 'drizzle-orm';
import { getDb, pages, extractions, sql, eq, and } from './db';

// ─── Admin: 全体サマリー ──────────────────────────────────────────────────────

export type PageStats = {
  total:           number;
  done:            number;
  doneWithDate:    number;
  companyCount:    number;
  pending:         number;
  error:           number;
  processing:      number;
  lastProcessedAt: Date | null;
};

export async function getPageStats(): Promise<PageStats> {
  const db = getDb();

  const rows = await db.execute(sql`
    SELECT
      count(*)::int                                                                              AS total,
      count(*) FILTER (WHERE status = 'done')::int                                              AS done,
      count(*) FILTER (WHERE status = 'done' AND notion_date IS NOT NULL AND notion_date != '')::int AS done_with_date,
      count(DISTINCT company_name) FILTER (WHERE status = 'done' AND company_name IS NOT NULL AND company_name != '')::int AS company_count,
      count(*) FILTER (WHERE status = 'pending')::int                                           AS pending,
      count(*) FILTER (WHERE status = 'error')::int                                             AS error,
      count(*) FILTER (WHERE status = 'processing')::int                                        AS processing,
      max(processed_at)                                                                          AS last_processed_at
    FROM ${pages}
  `);

  const row = (rows as unknown as Array<{
    total: unknown; done: unknown; done_with_date: unknown; company_count: unknown;
    pending: unknown; error: unknown; processing: unknown; last_processed_at: unknown;
  }>)[0];

  return {
    total:           Number(row.total),
    done:            Number(row.done),
    doneWithDate:    Number(row.done_with_date),
    companyCount:    Number(row.company_count),
    pending:         Number(row.pending),
    error:           Number(row.error),
    processing:      Number(row.processing),
    lastProcessedAt: row.last_processed_at instanceof Date
                       ? row.last_processed_at
                       : row.last_processed_at ? new Date(String(row.last_processed_at)) : null,
  };
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
  notionDate:    string | null;
  topic:         string;
  summary:       string;
  sourceExcerpt: string;
  processedAt:   Date | null;
};

export type SortColumn = 'title' | 'notionDate' | 'topic' | 'processedAt';
export type SortOrder  = 'asc'   | 'desc';

export async function getCustomerTopics(
  limit: 30 | 100 | 'all' = 30,
  sort:  SortColumn = 'processedAt',
  order: SortOrder  = 'desc',
): Promise<CustomerTopic[]> {
  const db = getDb();

  const colRef =
    sort === 'title'      ? pages.title
    : sort === 'notionDate' ? pages.notionDate
    : sort === 'topic'      ? extractions.topic
    :                         pages.processedAt;

  const orderExpr = order === 'asc'
    ? sql`${colRef} asc nulls last`
    : sql`${colRef} desc nulls last`;

  const query = db
    .select({
      title:         pages.title,
      notionDate:    pages.notionDate,
      topic:         extractions.topic,
      summary:       extractions.summary,
      sourceExcerpt: extractions.sourceExcerpt,
      processedAt:   pages.processedAt,
    })
    .from(extractions)
    .innerJoin(pages, eq(extractions.pageId, pages.pageId))
    .where(eq(extractions.applicable, true))
    .orderBy(orderExpr);

  if (limit === 'all') return query;
  return query.limit(limit);
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

// ─── Admin: 週別議事録件数（notion_date 基準） ─────────────────────────────────

export type WeeklyRow = { weekStart: string; count: number };

export async function getWeeklyMeetingCounts(): Promise<WeeklyRow[]> {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT
      to_char(date_trunc('week', notion_date::date), 'YYYY-MM-DD') AS week_start,
      count(*)::int AS count
    FROM ${pages}
    WHERE status = 'done'
      AND notion_date IS NOT NULL
      AND notion_date != ''
    GROUP BY date_trunc('week', notion_date::date)
    ORDER BY date_trunc('week', notion_date::date) DESC
    LIMIT 12
  `);
  return (rows as unknown as Array<{ week_start: unknown; count: unknown }>)
    .map(r => ({ weekStart: String(r.week_start), count: Number(r.count) }));
}

// ─── Admin: 会社別議事録件数（title 末尾の日付サフィックスを除去して推定） ─────

export type CompanyRow = { companyName: string; count: number; latestNotionDate: string | null };

export async function getCompanyMeetingCounts(): Promise<CompanyRow[]> {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT
      company_name,
      count(*)::int    AS count,
      max(notion_date) AS latest_notion_date
    FROM ${pages}
    WHERE status = 'done'
      AND company_name IS NOT NULL
      AND company_name != ''
    GROUP BY company_name
    ORDER BY count DESC, latest_notion_date DESC NULLS LAST
    LIMIT 30
  `);
  return (rows as unknown as Array<{ company_name: unknown; count: unknown; latest_notion_date: unknown }>)
    .map(r => ({
      companyName:      String(r.company_name),
      count:            Number(r.count),
      latestNotionDate: r.latest_notion_date ? String(r.latest_notion_date) : null,
    }));
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

// ─── Ops: 最近のエラーページ ──────────────────────────────────────────────────

export type ErrorPage = {
  title:       string | null;
  notionDate:  string | null;
  retryCount:  number;
  processedAt: Date | null;
  errorType:   string | null;
  errorMsg:    string | null;
};

export async function getRecentErrorPages(): Promise<ErrorPage[]> {
  const db = getDb();
  return db
    .select({
      title:       pages.title,
      notionDate:  pages.notionDate,
      retryCount:  pages.retryCount,
      processedAt: pages.processedAt,
      errorType:   pages.errorType,
      errorMsg:    pages.errorMsg,
    })
    .from(pages)
    .where(eq(pages.status, 'error'))
    .orderBy(sql`${pages.processedAt} desc nulls last`)
    .limit(10);
}

// ─── Ops: retry_count 上位 ───────────────────────────────────────────────────

export type RetryWarning = {
  title:       string | null;
  status:      string;
  retryCount:  number;
  processedAt: Date | null;
};

export async function getRetryWarnings(): Promise<RetryWarning[]> {
  const db = getDb();
  return db
    .select({
      title:       pages.title,
      status:      pages.status,
      retryCount:  pages.retryCount,
      processedAt: pages.processedAt,
    })
    .from(pages)
    .where(sql`${pages.retryCount} > 0`)
    .orderBy(sql`${pages.retryCount} desc`)
    .limit(10);
}

// ─── Ops: 残処理サマリー（zombie候補含む） ────────────────────────────────────

export type RemainingWork = {
  pending:          number;
  error:            number;
  processing:       number;
  zombieCandidates: number;
};

export async function getRemainingWork(): Promise<RemainingWork> {
  const db = getDb();
  const zombieTimeoutMin = parseInt(process.env.ZOMBIE_TIMEOUT_MIN ?? '15', 10);
  const zombieCutoffIso = new Date(Date.now() - zombieTimeoutMin * 60 * 1000).toISOString();

  const rows = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE status = 'pending')::int     AS pending,
      count(*) FILTER (WHERE status = 'error')::int       AS error,
      count(*) FILTER (WHERE status = 'processing')::int  AS processing,
      count(*) FILTER (
        WHERE status = 'processing'
          AND processing_started_at < ${zombieCutoffIso}::timestamptz
      )::int AS zombie_candidates
    FROM ${pages}
  `);

  const row = (rows as unknown as Array<{
    pending: unknown; error: unknown; processing: unknown; zombie_candidates: unknown;
  }>)[0];

  return {
    pending:          Number(row.pending),
    error:            Number(row.error),
    processing:       Number(row.processing),
    zombieCandidates: Number(row.zombie_candidates),
  };
}
