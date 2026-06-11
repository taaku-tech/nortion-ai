import { desc, sql } from 'drizzle-orm';
import { getDb, pages } from '@/lib/db';
import { getConfig } from '@/lib/config';
import {
  assertCronAuth,
  getJstWeekday,
  isWeekendJst,
  processPages,
  resetZombieProcessing,
  selectProcessingTargets,
} from '@/lib/cron/extractWorkflow';
import { appendProcessOpsLogToNotion } from '@/lib/notion/opsLogWriter';

export const maxDuration = 300;

export async function GET(req: Request): Promise<Response> {
  const startedAtMs = Date.now();

  if (!assertCronAuth(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const jstWeekday = getJstWeekday(now);
  const weekendJst = isWeekendJst(now);
  console.log('[cron:process-pages] start', { startedAt: now.toISOString(), weekdayJst: jstWeekday, isWeekendJst: weekendJst });

  if (weekendJst) {
    console.log('[cron:process-pages] skip', { reason: 'weekend_jst' });
    return Response.json({ ok: true, mode: 'process', skipped: true, reason: 'weekend_jst' });
  }

  const db = getDb();
  const { processing } = getConfig();
  const { zombieCount, zombieCutoff } = await resetZombieProcessing(db);
  const targets = await selectProcessingTargets(db, processing.batchSize);
  console.log('[cron:process-pages] targets selected', {
    count:           targets.length,
    pending:         targets.filter((p) => p.status === 'pending').length,
    doneNoEmbedding: targets.filter((p) => p.status === 'done').length,
  });

  const result = await processPages(
    db,
    targets,
    startedAtMs,
    now,
    maxDuration,
    processing.sleepMs,
    zombieCutoff,
  );

  console.log('[cron:process-pages] end', {
    ...result,
    zombieReset: zombieCount,
  });

  try {
    const jstTodayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(now);
    const jstDayStart = new Date(`${jstTodayStr}T00:00:00+09:00`);
    const jstDayStartIso = jstDayStart.toISOString();
    const majorErrors = await db
      .select({ title: pages.title, errorType: pages.errorType, errorMsg: pages.errorMsg })
      .from(pages)
      .where(sql`${pages.status} IN ('error', 'permanent_error') AND ${pages.updatedAt} >= ${jstDayStartIso}`)
      .orderBy(desc(pages.updatedAt))
      .limit(5);

    const opsLogPayload = {
      executedAt:           now,
      cronResult:           'ok',
      processed:            result.processed,
      done:                 result.done,
      error:                result.error,
      permanentError:       result.permanentError,
      embedded:             result.embedded,
      stuckProcessing:      result.stuckProcessing,
      remaining:            result.remaining,
      contentMissing:       result.contentMissing,
      stoppedBeforeTimeout: result.stoppedBeforeTimeout,
      skipped:              result.skipped,
      majorErrors,
    };
    await appendProcessOpsLogToNotion(opsLogPayload);
    console.log('[cron:process-pages] notion ops log write success');
  } catch (err) {
    console.warn('[cron:process-pages] notion ops log write failed', { error: String(err).slice(0, 1000) });
  }

  return Response.json({
    ok: true,
    mode: 'process',
    zombieReset: zombieCount,
    ...result,
  });
}
