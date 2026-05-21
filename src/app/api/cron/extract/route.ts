import { eq, and, lt, gte, sql, inArray, or, isNull } from 'drizzle-orm';
import { getDb, pages, extractions } from '@/lib/db';
import { getConfig } from '@/lib/config';
import { fetchNotionPages, fetchPageContent } from '@/lib/notionClient';
import { extractTopics, generateEmbedding, toErrorType, isNonRetryable, TOPICS, type Topic } from '@/lib/geminiClient';
import type { ErrorType } from '@/lib/db';
import { sendOpsSummaryEmail } from '@/lib/email/opsSummaryMailer';

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

  // ── [0.5] JST 土日チェック ───────────────────────────────────────────────────
  // Vercel Cron は UTC 実行のため、必ず Asia/Tokyo 基準で曜日を判定する
  const jstWeekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    weekday:  'short',
  }).format(new Date());
  const isWeekendJst = jstWeekday === 'Sat' || jstWeekday === 'Sun';

  console.log('[cron:extract] start', { startedAt: new Date().toISOString(), weekdayJst: jstWeekday, isWeekendJst });

  if (isWeekendJst) {
    console.log('[cron:extract] skip', { reason: 'weekend_jst' });
    return Response.json({ ok: true, skipped: true, reason: 'weekend_jst' });
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
    .returning({ pageId: pages.pageId, title: pages.title });

  const zombieCount = zombieRows.length;
  console.log('[cron:extract] zombie reset', {
    count: zombieCount,
    pages: zombieRows.slice(0, 5).map((r) => ({ pageId: r.pageId, title: r.title })),
  });

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
  // pending ページ + embedding 未保存の done ページを対象にする
  const targets = await db
    .select()
    .from(pages)
    .where(
      or(
        eq(pages.status, 'pending'),
        and(eq(pages.status, 'done'), isNull(pages.embedding)),
      )
    )
    .limit(processing.batchSize)
    .for('update', { skipLocked: true });

  console.log('[cron:extract] targets selected', {
    count:           targets.length,
    pending:         targets.filter((p) => p.status === 'pending').length,
    doneNoEmbedding: targets.filter((p) => p.status === 'done').length,
  });

  let doneCount     = 0;
  let errorCount    = 0;
  let skippedCount  = 0;
  let embeddedCount = 0;

  for (const page of targets) {
    // processing にセット（ゾンビ検出のために processing_started_at を記録）
    await db
      .update(pages)
      .set({ status: 'processing', processingStartedAt: now })
      .where(eq(pages.pageId, page.pageId));

    console.log('[cron:extract] page start', {
      pageId:         page.pageId,
      title:          page.title,
      previousStatus: page.status,
      retryCount:     page.retryCount,
    });

    try {
      // 本文取得
      const { text, contentHash, contentLength } = await fetchPageContent(page.pageId);

      // content_hash 一致チェック（本文変更なし判定）
      const hashMatch = page.contentHash !== null && page.contentHash === contentHash && text.trim() !== '';

      // extraction skip チェック
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

      // embedding skip チェック（content_hash 一致かつ embedding 保存済みの場合はスキップ）
      const embeddingSkipped = hashMatch && page.embedding !== null;

      // extraction・embedding ともにスキップ可能 → done
      if (extractionSkipped && embeddingSkipped) {
        await db.update(pages).set({ status: 'done' }).where(eq(pages.pageId, page.pageId));
        skippedCount++;
        console.log('[cron:extract] page done', { pageId: page.pageId, result: 'skipped' });
        continue;
      }

      // 本文なし → done（embedding も生成しない）
      if (!text.trim()) {
        await db
          .update(pages)
          .set({ status: 'done', content: '', contentHash, contentLength, processedAt: now })
          .where(eq(pages.pageId, page.pageId));
        doneCount++;
        console.log('[cron:extract] page done', { pageId: page.pageId, result: 'done', note: 'empty_text' });
        continue;
      }

      // Gemini でトピック抽出（必要な場合のみ）
      if (!extractionSkipped) {
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
      }

      // Gemini で embedding 生成（embeddingSkipped = false のため必ず実行）
      const newEmbedding = await generateEmbedding(text);
      embeddedCount++;

      // done に更新（embedding を含む）
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
          embedding:     newEmbedding,
        })
        .where(eq(pages.pageId, page.pageId));

      doneCount++;
      console.log('[cron:extract] page done', { pageId: page.pageId, result: 'done' });

    } catch (err) {
      const errorType    = toErrorType(err, page.retryCount) as ErrorType;
      const errorMsg     = err instanceof Error ? err.message : String(err);
      const nonRetryable = isNonRetryable(err);

      if (nonRetryable) {
        // 404/403/401 等の恒久失敗 → permanent_error（retry_count は増やさない、次回 cron 対象外）
        await db
          .update(pages)
          .set({ status: 'permanent_error', errorType, errorMsg })
          .where(eq(pages.pageId, page.pageId));
      } else {
        // 一時的エラー → error（Notion 側で更新されるか手動リセットで再試行可能）
        await db
          .update(pages)
          .set({ status: 'error', errorType, errorMsg, retryCount: page.retryCount + 1 })
          .where(eq(pages.pageId, page.pageId));
      }

      errorCount++;
      console.log('[cron:extract] page done', {
        pageId:    page.pageId,
        result:    nonRetryable ? 'permanent_error' : 'error',
        errorType,
        errorMsg:  errorMsg.slice(0, 200),
      });
    }

    await sleep(processing.sleepMs);
  }

  // ── [4] 残件数を取得してサマリ返却 ───────────────────────────────────────────
  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(pages)
    .where(eq(pages.status, 'pending'));

  const [{ missingEmbedding }] = await db
    .select({ missingEmbedding: sql<number>`count(*)::int` })
    .from(pages)
    .where(and(eq(pages.status, 'done'), isNull(pages.embedding)));

  console.log('[cron:extract] end', {
    done:               doneCount,
    error:              errorCount,
    skipped:            skippedCount,
    embeddingGenerated: embeddedCount,
    zombieReset:        zombieCount,
    remaining,
    missingEmbedding,
  });

  // ── [5] メール送信 ─────────────────────────────────────────────────────────
  const { email: emailCfg } = getConfig();
  const { resendApiKey, to: emailTo, from: emailFrom } = emailCfg;

  if (emailTo && resendApiKey && emailFrom) {
    try {
      // JST 今日の開始時刻（00:00:00 JST = UTC-9h）
      const jstTodayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(now);
      const jstDayStart = new Date(`${jstTodayStr}T00:00:00+09:00`);

      // 本日新規取込ページ（createdAt が今日 JST 以降。任意 status）
      const newlyLoadedRows = await db
        .select({ title: pages.title, notionDate: pages.notionDate, status: pages.status, errorType: pages.errorType, errorMsg: pages.errorMsg })
        .from(pages)
        .where(gte(pages.createdAt, jstDayStart))
        .orderBy(pages.createdAt);

      // 本日処理完了ページ（processedAt が今日 JST 以降 かつ done）
      const processedTodayRows = await db
        .select({ title: pages.title, notionDate: pages.notionDate, status: pages.status, errorType: pages.errorType, errorMsg: pages.errorMsg })
        .from(pages)
        .where(and(gte(pages.processedAt, jstDayStart), eq(pages.status, 'done')))
        .orderBy(pages.processedAt);

      // 本日エラーページ（updatedAt が今日 JST 以降 かつ error）
      const errorTodayRows = await db
        .select({ title: pages.title, notionDate: pages.notionDate, status: pages.status, errorType: pages.errorType, errorMsg: pages.errorMsg })
        .from(pages)
        .where(and(gte(pages.updatedAt, jstDayStart), eq(pages.status, 'error')))
        .orderBy(pages.updatedAt);

      // permanent_error 全件
      const permanentErrorRows = await db
        .select({ title: pages.title, notionDate: pages.notionDate, status: pages.status, errorType: pages.errorType, errorMsg: pages.errorMsg })
        .from(pages)
        .where(eq(pages.status, 'permanent_error'))
        .orderBy(pages.updatedAt);

      // stuck count（現時点で processing のまま残っているページ数）
      const [{ stuckCount }] = await db
        .select({ stuckCount: sql<number>`count(*)::int` })
        .from(pages)
        .where(eq(pages.status, 'processing'));

      await sendOpsSummaryEmail(
        {
          executedAt:          now,
          done:                doneCount,
          error:               errorCount,
          skipped:             skippedCount,
          embeddingGenerated:  embeddedCount,
          zombieReset:         zombieCount,
          remaining,
          newlyLoadedPages:    newlyLoadedRows,
          processedTodayPages: processedTodayRows,
          errorTodayPages:     errorTodayRows,
          permanentErrorPages: permanentErrorRows,
          stuckCount,
        },
        { apiKey: resendApiKey, to: emailTo, from: emailFrom },
      );

      console.log('[cron:extract] email sent', { to: emailTo });
    } catch (err) {
      console.warn('[cron:extract] email send failed', { error: String(err).slice(0, 200) });
    }
  }

  return Response.json({
    ok:              true,
    synced:          notionPages.length,
    processed:       targets.length,
    done:            doneCount,
    skipped:         skippedCount,
    error:           errorCount,
    embedded:        embeddedCount,
    zombieReset:     zombieCount ?? 0,
    remaining,
    missingEmbedding,
  });
}
