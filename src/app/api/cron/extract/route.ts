import { eq, and, lt, sql, inArray } from 'drizzle-orm';
import { getDb, pages, extractions } from '@/lib/db';
import { getConfig } from '@/lib/config';
import { fetchNotionPages, fetchPageContent } from '@/lib/notionClient';
import { extractTopics, toErrorType, TOPICS, type Topic } from '@/lib/geminiClient';
import type { ErrorType } from '@/lib/db';

/** Vercel Function の最大実行時間（秒）。Pro プランは 300 まで設定可能 */
export const maxDuration = 60;

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function minutesAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 1000);
}

// ─── Cron エンドポイント ──────────────────────────────────────────────────────

export async function GET(req: Request): Promise<Response> {
  // ── [0] 認証 ────────────────────────────────────────────────────────────────
  // Vercel は Cron 実行時に Authorization: Bearer {CRON_SECRET} を自動付与する
  const { cron, processing } = getConfig();
  const authHeader  = req.headers.get('authorization');
  const querySecret = new URL(req.url).searchParams.get('secret');

  const isAuthorized =
    authHeader  === `Bearer ${cron.secret}` ||
    querySecret === cron.secret;

  if (!isAuthorized) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  const now = new Date();

  // ── [1] ゾンビリセット ───────────────────────────────────────────────────────
  // processing のまま zombieTimeoutMin 分以上経過したページを pending に戻す
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
    .returning({ pageId: pages.pageId });

  const zombieCount = zombieRows.length;

  // ── [2] Notion 同期（メタ情報のみ取得） ────────────────────────────────────
  let notionPages: Awaited<ReturnType<typeof fetchNotionPages>>;
  try {
    notionPages = await fetchNotionPages();
  } catch (err) {
    return Response.json(
      { error: 'Notion sync failed', detail: String(err) },
      { status: 502 },
    );
  }

  // Upsert:
  //   - 新規ページ       → INSERT status=pending
  //   - last_edited_time が変化したページ → status=pending, content=NULL（再処理）
  //   - 変化なし         → 何もしない（DO NOTHING 相当）
  for (const page of notionPages) {
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
      })
      .onConflictDoUpdate({
        target: pages.pageId,
        set: {
          // last_edited_time が新しい場合のみ更新してステータスをリセット
          title:          sql`CASE WHEN ${pages.lastEditedTime} < excluded.last_edited_time
                                THEN excluded.title
                                ELSE ${pages.title} END`,
          // company_name / location_name は NULL の場合も更新（既存ページへの初回投入に対応）
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
                                THEN NULL
                                ELSE ${pages.content} END`,
          contentHash:    sql`CASE WHEN ${pages.lastEditedTime} < excluded.last_edited_time
                                THEN NULL
                                ELSE ${pages.contentHash} END`,
        },
      });
  }

  // ── [3] 抽出処理（BATCH_SIZE 件まで） ────────────────────────────────────────
  const targets = await db
    .select()
    .from(pages)
    .where(eq(pages.status, 'pending'))
    .limit(processing.batchSize)
    .for('update', { skipLocked: true }); // 将来の並列実行にも対応

  let doneCount    = 0;
  let errorCount   = 0;
  let skippedCount = 0;

  for (const page of targets) {
    // processing にセット（ゾンビ検出のために processing_started_at を記録）
    await db
      .update(pages)
      .set({ status: 'processing', processingStartedAt: now })
      .where(eq(pages.pageId, page.pageId));

    try {
      // 本文取得
      const { text, contentHash, contentLength } = await fetchPageContent(page.pageId);

      // content_hash 一致 → skip（本文変更なし、Gemini API を呼ばない）
      if (page.contentHash !== null && page.contentHash === contentHash && text.trim()) {
        const [{ cnt }] = await db
          .select({ cnt: sql<number>`count(*)::int` })
          .from(extractions)
          .where(and(
            eq(extractions.pageId, page.pageId),
            inArray(extractions.topic, [...TOPICS]),
          ));

        if (cnt === TOPICS.length) {
          console.log('[extract] skipped unchanged page:', { pageId: page.pageId, title: page.title });
          await db.update(pages).set({ status: 'done' }).where(eq(pages.pageId, page.pageId));
          skippedCount++;
          continue;
        }
      }

      // 本文なし → done（再処理不要、Gemini API を呼ばない）
      if (!text.trim()) {
        await db
          .update(pages)
          .set({ status: 'done', content: '', contentHash, contentLength, processedAt: now })
          .where(eq(pages.pageId, page.pageId));
        doneCount++;
        continue;
      }

      // Gemini でトピック抽出（内部でリトライ付き）
      const extracted = await extractTopics(page.title ?? '', text);

      // extractions を UPSERT（冪等性：同一 page_id + topic は上書き）
      for (const topic of TOPICS) {
        const result = extracted[topic as Topic];
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
      }

      // done に更新
      await db
        .update(pages)
        .set({
          status:        'done',
          content:       text,
          contentHash,
          contentLength,
          processedAt:   now,
          errorType:     null,
          errorMsg:      null,
        })
        .where(eq(pages.pageId, page.pageId));

      doneCount++;

    } catch (err) {
      // エラーを構造化して記録（error → pending への自動復帰なし。Notion 側で更新されるか手動リセットで再試行）
      const errorType = toErrorType(err, page.retryCount) as ErrorType;
      const errorMsg  = err instanceof Error ? err.message : String(err);

      await db
        .update(pages)
        .set({
          status:     'error',
          errorType,
          errorMsg,
          retryCount: page.retryCount + 1,
        })
        .where(eq(pages.pageId, page.pageId));

      errorCount++;
    }

    await sleep(processing.sleepMs);
  }

  // ── [4] 残件数を取得してサマリ返却 ───────────────────────────────────────────
  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(pages)
    .where(eq(pages.status, 'pending'));

  return Response.json({
    ok:         true,
    synced:     notionPages.length,
    processed:  targets.length,
    done:       doneCount,
    skipped:    skippedCount,
    error:      errorCount,
    zombieReset: zombieCount ?? 0,
    remaining,
  });
}
