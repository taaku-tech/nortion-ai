import { eq, and, lt, gte, sql, inArray, or, isNull } from 'drizzle-orm';
import { getDb, pages, extractions, cronSyncState, type Page } from '@/lib/db';
import { getConfig } from '@/lib/config';
import { fetchNotionPages, fetchPageContent } from '@/lib/notionClient';
import { extractTopics, generateEmbedding, toErrorType, isNonRetryable, TOPICS, type Topic } from '@/lib/geminiClient';
import type { ErrorType } from '@/lib/db';

export const FUNCTION_TIMEOUT_BUFFER_MS = 8_000;
export const PAGE_PROCESS_TIMEOUT_MS = 45_000;
export const PAGE_START_REQUIRED_MS = 25_000;
const NOTION_PAGES_SYNC_STATE_NAME = 'notion_pages';
const SYNC_SAFETY_WINDOW_MS = 5 * 60 * 1000;

type Db = ReturnType<typeof getDb>;
type NotionPagesForSync = Awaited<ReturnType<typeof fetchNotionPages>>;

export type ProcessOnePageResult = {
  done:           number;
  error:          number;
  permanentError: number;
  skipped:        number;
  embedded:       number;
};

type PageTiming = {
  fetchMs:      number;
  extractMs:    number;
  embeddingMs:  number;
  dbUpdateMs:   number;
  totalMs:      number;
};

export type SyncNotionResult = {
  synced:           number;
  newlyLoaded:      number;
  updated:          number;
  contentFetched:   number;
  contentBackfilled: number;
  contentFetchError: number;
  error:            number;
  remainingTargets: number;
};

export type ZombieResetResult = {
  zombieCount: number;
  zombieCutoff: Date;
};

export type ProcessPagesResult = {
  selected:             number;
  processed:            number;
  done:                 number;
  error:                number;
  permanentError:       number;
  skipped:              number;
  embedded:             number;
  stoppedBeforeTimeout: boolean;
  remaining:            number;
  missingEmbedding:     number;
  contentMissing:       number;
  stuckProcessing:      number;
};

export function assertCronAuth(req: Request): boolean {
  const { cron } = getConfig();
  const authHeader  = req.headers.get('authorization');
  const querySecret = new URL(req.url).searchParams.get('secret');

  return authHeader === `Bearer ${cron.secret}` || querySecret === cron.secret;
}

export function getJstWeekday(now: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    weekday:  'short',
  }).format(now);
}

export function isWeekendJst(now: Date): boolean {
  const weekday = getJstWeekday(now);
  return weekday === 'Sat' || weekday === 'Sun';
}

function minutesAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 1000);
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // TODO:
  // withTimeout は Promise reject のみで、外部API自体は cancel されない。
  // 将来的に AbortController 対応を検討。
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

export async function resetZombieProcessing(db: Db): Promise<ZombieResetResult> {
  const { processing } = getConfig();
  const zombieCutoff = minutesAgo(processing.zombieTimeoutMin);

  const zombieRows = await db
    .update(pages)
    .set({ status: 'pending', processingStartedAt: null })
    .where(
      and(
        eq(pages.status, 'processing'),
        lt(pages.processingStartedAt, zombieCutoff),
      ),
    )
    .returning({ pageId: pages.pageId, title: pages.title });

  console.log('[cron:process-pages] zombie reset', {
    count: zombieRows.length,
    pages: zombieRows.slice(0, 5).map((r) => ({ pageId: r.pageId, title: r.title })),
  });

  return { zombieCount: zombieRows.length, zombieCutoff };
}

async function getSyncState(db: Db): Promise<Date | null> {
  const rows = await db
    .select({ lastSuccessfulSyncAt: cronSyncState.lastSuccessfulSyncAt })
    .from(cronSyncState)
    .where(eq(cronSyncState.name, NOTION_PAGES_SYNC_STATE_NAME))
    .limit(1);

  return rows[0]?.lastSuccessfulSyncAt ?? null;
}

async function updateSyncState(db: Db, syncedAt: Date): Promise<void> {
  await db
    .insert(cronSyncState)
    .values({
      name:                 NOTION_PAGES_SYNC_STATE_NAME,
      lastSuccessfulSyncAt: syncedAt,
      updatedAt:            syncedAt,
    })
    .onConflictDoUpdate({
      target: cronSyncState.name,
      set: {
        lastSuccessfulSyncAt: syncedAt,
        updatedAt:            syncedAt,
      },
    });
}

function buildSyncFilterFrom(lastSuccessfulSyncAt: Date | null): Date | null {
  if (!lastSuccessfulSyncAt) return null;
  return new Date(lastSuccessfulSyncAt.getTime() - SYNC_SAFETY_WINDOW_MS);
}

async function fetchNotionPagesForSync(filterFrom: Date | null): Promise<NotionPagesForSync> {
  // 初回 last_successful_sync_at が NULL の場合のみ全件同期する。
  // 2回目以降は safety window 分だけ巻き戻し、Notion last_edited_time filter で差分同期する。
  // 削除・アーカイブ検知は差分同期だけでは漏れる可能性があるため、
  // 次フェーズで週1回reconcile cronを追加し、Notion側未検出候補をOps Logに出す仕様を検討する。
  return fetchNotionPages(filterFrom);
}

export async function syncNotionPages(db: Db): Promise<SyncNotionResult> {
  const syncStartedAt = new Date();
  const lastSuccessfulSyncAt = await getSyncState(db);
  const filterFrom = buildSyncFilterFrom(lastSuccessfulSyncAt);
  const notionPages = await fetchNotionPagesForSync(filterFrom);
  const pageIds = notionPages.map((page) => page.pageId);
  const notionPageIdSet = new Set(pageIds);
  const existingRows = pageIds.length === 0
    ? []
    : await db
        .select({ pageId: pages.pageId, lastEditedTime: pages.lastEditedTime })
        .from(pages)
        .where(inArray(pages.pageId, pageIds));
  const existingMap = new Map(existingRows.map((row) => [row.pageId, row.lastEditedTime]));
  const backfillRows = await db
    .select({ pageId: pages.pageId, title: pages.title })
    .from(pages)
    .where(and(eq(pages.status, 'pending'), isNull(pages.contentHash)));
  const backfillTargets = backfillRows.filter((row) => !notionPageIdSet.has(row.pageId));

  let newlyLoaded = 0;
  let updated = 0;
  let contentFetched = 0;
  let contentBackfilled = 0;
  let contentFetchError = 0;

  for (const page of notionPages) {
    const existingLastEditedTime = existingMap.get(page.pageId);
    const shouldFetchContent = !existingLastEditedTime || existingLastEditedTime < page.lastEditedTime;
    if (!existingLastEditedTime) {
      newlyLoaded++;
    } else if (existingLastEditedTime < page.lastEditedTime) {
      updated++;
    }

    let contentUpdate: {
      content: string;
      contentHash: string;
      contentLength: number;
    } | null = null;

    if (shouldFetchContent) {
      try {
        const { text, contentHash, contentLength } = await fetchPageContent(page.pageId);
        contentUpdate = { content: text, contentHash, contentLength };
        contentFetched++;
      } catch (err) {
        contentFetchError++;
        console.warn('[cron:sync-notion] page content fetch failed', {
          pageId: page.pageId,
          title:  page.title,
          error:  String(err).slice(0, 1000),
        });
      }
    }

    await db
      .insert(pages)
      .values({
        pageId:         page.pageId,
        title:          page.title,
        companyName:    page.companyName ?? undefined,
        locationName:   page.locationName ?? undefined,
        notionDate:     page.notionDate ?? undefined,
        lastEditedTime: page.lastEditedTime,
        status:         'pending',
        content:        contentUpdate?.content,
        contentHash:    contentUpdate?.contentHash,
        contentLength:  contentUpdate?.contentLength,
      })
      .onConflictDoUpdate({
        target: pages.pageId,
        set: {
          title:          sql`CASE WHEN ${pages.lastEditedTime} < excluded.last_edited_time
                                THEN excluded.title
                                ELSE ${pages.title} END`,
          companyName:    sql`CASE WHEN ${pages.lastEditedTime} < excluded.last_edited_time
                                THEN excluded.company_name
                                WHEN ${pages.companyName} IS NULL
                                THEN excluded.company_name
                                ELSE ${pages.companyName} END`,
          locationName:   sql`CASE WHEN ${pages.lastEditedTime} < excluded.last_edited_time
                                THEN excluded.location_name
                                WHEN ${pages.locationName} IS NULL
                                THEN excluded.location_name
                                ELSE ${pages.locationName} END`,
          notionDate:     sql`CASE WHEN ${pages.lastEditedTime} < excluded.last_edited_time
                                THEN excluded.notion_date
                                ELSE ${pages.notionDate} END`,
          lastEditedTime: sql`CASE WHEN ${pages.lastEditedTime} < excluded.last_edited_time
                                THEN excluded.last_edited_time
                                ELSE ${pages.lastEditedTime} END`,
          status:         sql`CASE WHEN ${pages.lastEditedTime} < excluded.last_edited_time
                                THEN 'pending'
                                ELSE ${pages.status} END`,
          content:        sql`CASE WHEN ${pages.lastEditedTime} < excluded.last_edited_time
                                  AND excluded.content_hash IS NOT NULL
                                THEN excluded.content
                                WHEN ${pages.lastEditedTime} < excluded.last_edited_time
                                THEN NULL
                                ELSE ${pages.content} END`,
          contentHash:    sql`CASE WHEN ${pages.lastEditedTime} < excluded.last_edited_time
                                  AND excluded.content_hash IS NOT NULL
                                THEN excluded.content_hash
                                WHEN ${pages.lastEditedTime} < excluded.last_edited_time
                                THEN NULL
                                ELSE ${pages.contentHash} END`,
          contentLength:  sql`CASE WHEN ${pages.lastEditedTime} < excluded.last_edited_time
                                  AND excluded.content_hash IS NOT NULL
                                THEN excluded.content_length
                                WHEN ${pages.lastEditedTime} < excluded.last_edited_time
                                THEN NULL
                                ELSE ${pages.contentLength} END`,
        },
      });
  }

  for (const page of backfillTargets) {
    try {
      const { text, contentHash, contentLength } = await fetchPageContent(page.pageId);
      await db
        .update(pages)
        .set({
          status: 'pending',
          content: text,
          contentHash,
          contentLength,
        })
        .where(
          and(
            eq(pages.pageId, page.pageId),
            eq(pages.status, 'pending'),
            isNull(pages.contentHash),
          ),
        );
      contentFetched++;
      contentBackfilled++;
    } catch (err) {
      contentFetchError++;
      console.warn('[cron:sync-notion] page content backfill failed', {
        pageId: page.pageId,
        title:  page.title,
        error:  String(err).slice(0, 1000),
      });
    }
  }

  const remainingTargets = await countProcessingTargets(db);
  await updateSyncState(db, syncStartedAt);
  return {
    // synced は「Notion DBで確認したページ数」。新規同期件数ではない。
    synced: notionPages.length,
    newlyLoaded,
    updated,
    contentFetched,
    contentBackfilled,
    contentFetchError,
    error: 0,
    remainingTargets,
  };
}

export async function countProcessingTargets(db: Db): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pages)
    .where(
      or(
        and(eq(pages.status, 'pending'), sql`${pages.contentHash} IS NOT NULL`),
        and(eq(pages.status, 'done'), isNull(pages.embedding), sql`${pages.contentHash} IS NOT NULL`),
      ),
    );
  return count;
}

export async function selectProcessingTargets(db: Db, batchSize: number): Promise<Page[]> {
  return db
    .select()
    .from(pages)
    .where(
      or(
        and(eq(pages.status, 'pending'), sql`${pages.contentHash} IS NOT NULL`),
        and(eq(pages.status, 'done'), isNull(pages.embedding), sql`${pages.contentHash} IS NOT NULL`),
      )
    )
    .limit(batchSize)
    .for('update', { skipLocked: true });
}

export async function processPages(
  db: Db,
  targets: Page[],
  startedAtMs: number,
  now: Date,
  maxDuration: number,
  sleepMs: number,
  zombieCutoff: Date,
): Promise<ProcessPagesResult> {
  let processed = 0;
  let done = 0;
  let error = 0;
  let permanentError = 0;
  let skipped = 0;
  let embedded = 0;
  let stoppedBeforeTimeout = false;

  for (const page of targets) {
    try {
      const elapsedMs = Date.now() - startedAtMs;
      const remainingMs = maxDuration * 1000 - elapsedMs;
      const requiredMs = PAGE_START_REQUIRED_MS;
      if (remainingMs < requiredMs) {
        stoppedBeforeTimeout = true;
        console.log('[cron:process-pages] stop before timeout', {
          pageId:    page.pageId,
          elapsedMs,
          remainingMs,
          requiredMs,
          sleepMs,
        });
        break;
      }

      const result = await withTimeout(
        processOnePage(db, page, now),
        PAGE_PROCESS_TIMEOUT_MS,
        'processOnePage',
      );
      processed      += 1;
      done           += result.done;
      error          += result.error;
      permanentError += result.permanentError;
      skipped        += result.skipped;
      embedded       += result.embedded;
    } catch (err) {
      const result = await markPageError(db, page, err);
      processed      += 1;
      error          += result.error;
      permanentError += result.permanentError;
    }

    const sleepStartedAt = Date.now();
    await new Promise<void>((resolve) => setTimeout(resolve, sleepMs));
    console.log('[cron:process-pages] sleep', {
      requestedMs: sleepMs,
      actualMs:    Date.now() - sleepStartedAt,
    });
  }

  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(pages)
    .where(eq(pages.status, 'pending'));

  const [{ missingEmbedding }] = await db
    .select({ missingEmbedding: sql<number>`count(*)::int` })
    .from(pages)
    .where(and(eq(pages.status, 'done'), isNull(pages.embedding)));

  const [{ contentMissing }] = await db
    .select({ contentMissing: sql<number>`count(*)::int` })
    .from(pages)
    .where(and(
      eq(pages.status, 'pending'),
      isNull(pages.contentHash),
    ));

  const [{ stuckProcessing }] = await db
    .select({ stuckProcessing: sql<number>`count(*)::int` })
    .from(pages)
    .where(and(
      eq(pages.status, 'processing'),
      lt(pages.processingStartedAt, zombieCutoff),
    ));

  return {
    selected: targets.length,
    processed,
    done,
    error,
    permanentError,
    skipped,
    embedded,
    stoppedBeforeTimeout,
    remaining,
    missingEmbedding,
    contentMissing,
    stuckProcessing,
  };
}

export async function processOnePage(db: Db, page: Page, now: Date): Promise<ProcessOnePageResult> {
  const pageStartedAt = Date.now();
  const timing: PageTiming = {
    fetchMs:     0,
    extractMs:   0,
    embeddingMs: 0,
    dbUpdateMs:  0,
    totalMs:     0,
  };

  await db
    .update(pages)
    .set({ status: 'processing', processingStartedAt: now })
    .where(eq(pages.pageId, page.pageId));

  console.log('[cron:process-pages] page start', {
    pageId:         page.pageId,
    title:          page.title,
    previousStatus: page.status,
    retryCount:     page.retryCount,
  });

  try {
    const text = page.content;
    const contentHash = page.contentHash;
    const contentLength = page.contentLength;

    if (text === null || contentHash === null) {
      const dbUpdateStartedAt = Date.now();
      await db
        .update(pages)
        .set({ status: 'pending', processingStartedAt: null })
        .where(and(
          eq(pages.pageId, page.pageId),
          eq(pages.status, 'processing'),
        ));
      timing.dbUpdateMs += Date.now() - dbUpdateStartedAt;
      timing.totalMs = Date.now() - pageStartedAt;
      console.log('[cron:process-pages] page timing', { pageId: page.pageId, ...timing });
      console.log('[cron:process-pages] page done', { pageId: page.pageId, result: 'skipped', note: 'content_missing' });
      return { done: 0, error: 0, permanentError: 0, skipped: 1, embedded: 0 };
    }

    const hashMatch = page.status === 'done' && text.trim() !== '';

    let extractionSkipped = false;
    if (hashMatch) {
      const [{ cnt }] = await db
        .select({ cnt: sql<number>`count(*)::int` })
        .from(extractions)
        .where(and(
          eq(extractions.pageId, page.pageId),
          inArray(extractions.topic, [...TOPICS]),
        ));
      if (cnt === TOPICS.length) {
        extractionSkipped = true;
      }
    }

    const embeddingSkipped = hashMatch && page.embedding !== null;

    if (extractionSkipped && embeddingSkipped) {
      const dbUpdateStartedAt = Date.now();
      await db
        .update(pages)
        .set({ status: 'done', processingStartedAt: null })
        .where(and(
          eq(pages.pageId, page.pageId),
          eq(pages.status, 'processing'),
        ));
      timing.dbUpdateMs += Date.now() - dbUpdateStartedAt;
      timing.totalMs = Date.now() - pageStartedAt;
      console.log('[cron:process-pages] page timing', { pageId: page.pageId, ...timing });
      console.log('[cron:process-pages] page done', { pageId: page.pageId, result: 'skipped' });
      return { done: 0, error: 0, permanentError: 0, skipped: 1, embedded: 0 };
    }

    if (!text.trim()) {
      const dbUpdateStartedAt = Date.now();
      await db
        .update(pages)
        .set({ status: 'done', content: '', contentHash, contentLength: contentLength ?? 0, processedAt: now, processingStartedAt: null })
        .where(and(
          eq(pages.pageId, page.pageId),
          eq(pages.status, 'processing'),
        ));
      timing.dbUpdateMs += Date.now() - dbUpdateStartedAt;
      timing.totalMs = Date.now() - pageStartedAt;
      console.log('[cron:process-pages] page timing', { pageId: page.pageId, ...timing });
      console.log('[cron:process-pages] page done', { pageId: page.pageId, result: 'done', note: 'empty_text' });
      return { done: 1, error: 0, permanentError: 0, skipped: 0, embedded: 0 };
    }

    if (!extractionSkipped) {
      const extractStartedAt = Date.now();
      const extracted = await extractTopics(page.title ?? '', text);
      timing.extractMs = Date.now() - extractStartedAt;

      for (const topic of TOPICS) {
        const result = extracted[topic as Topic];
        const dbUpdateStartedAt = Date.now();
        await db
          .insert(extractions)
          .values({
            pageId:        page.pageId,
            topic,
            applicable:    result.applicable,
            sourceExcerpt: result.applicable ? result.source_excerpt : '',
            summary:       result.applicable ? result.summary        : '',
          })
          .onConflictDoUpdate({
            target: [extractions.pageId, extractions.topic],
            set: {
              applicable:    result.applicable,
              sourceExcerpt: result.applicable ? result.source_excerpt : '',
              summary:       result.applicable ? result.summary        : '',
            },
          });
        timing.dbUpdateMs += Date.now() - dbUpdateStartedAt;
      }
    }

    const embeddingStartedAt = Date.now();
    const newEmbedding = await generateEmbedding(text);
    timing.embeddingMs = Date.now() - embeddingStartedAt;

    const dbUpdateStartedAt = Date.now();
    await db
      .update(pages)
      .set({
        status:        'done',
        content:       text,
        contentHash,
        contentLength: contentLength ?? text.length,
        processedAt:   now,
        errorType:     null,
        errorMsg:      null,
        processingStartedAt: null,
        embedding:     newEmbedding,
      })
      .where(and(
        eq(pages.pageId, page.pageId),
        eq(pages.status, 'processing'),
      ));
    timing.dbUpdateMs += Date.now() - dbUpdateStartedAt;
    timing.totalMs = Date.now() - pageStartedAt;

    console.log('[cron:process-pages] page timing', { pageId: page.pageId, ...timing });
    console.log('[cron:process-pages] page done', { pageId: page.pageId, result: 'done' });
    return { done: 1, error: 0, permanentError: 0, skipped: 0, embedded: 1 };
  } catch (err) {
    return markPageError(db, page, err);
  }
}

export async function markPageError(db: Db, page: Page, err: unknown): Promise<ProcessOnePageResult> {
  const errorType    = toErrorType(err, page.retryCount) as ErrorType;
  const errorMsg     = err instanceof Error ? err.message : String(err);
  const nonRetryable = isNonRetryable(err);

  try {
    if (nonRetryable) {
      await db
        .update(pages)
        .set({ status: 'permanent_error', errorType, errorMsg, processingStartedAt: null })
        .where(eq(pages.pageId, page.pageId));
    } else {
      await db
        .update(pages)
        .set({ status: 'error', errorType, errorMsg, retryCount: page.retryCount + 1, processingStartedAt: null })
        .where(eq(pages.pageId, page.pageId));
    }
  } catch (dbErr) {
    console.error('[cron:process-pages] page status update failed', {
      pageId:    page.pageId,
      errorType,
      error:     String(dbErr).slice(0, 200),
    });
  }

  console.log('[cron:process-pages] page done', {
    pageId:    page.pageId,
    result:    nonRetryable ? 'permanent_error' : 'error',
    errorType,
    errorMsg:  errorMsg.slice(0, 200),
  });

  return { done: 0, error: nonRetryable ? 0 : 1, permanentError: nonRetryable ? 1 : 0, skipped: 0, embedded: 0 };
}
