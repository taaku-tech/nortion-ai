import { getDb } from '@/lib/db';
import {
  assertCronAuth,
  getJstWeekday,
  isWeekendJst,
  syncNotionPages,
} from '@/lib/cron/extractWorkflow';
import { appendSyncOpsLogToNotion } from '@/lib/notion/opsLogWriter';

export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  if (!assertCronAuth(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const jstWeekday = getJstWeekday(now);
  const weekendJst = isWeekendJst(now);
  console.log('[cron:sync-notion] start', { startedAt: now.toISOString(), weekdayJst: jstWeekday, isWeekendJst: weekendJst });

  if (weekendJst) {
    console.log('[cron:sync-notion] skip', { reason: 'weekend_jst' });
    return Response.json({ ok: true, mode: 'sync', skipped: true, reason: 'weekend_jst' });
  }

  const db = getDb();
  let result;
  try {
    result = await syncNotionPages(db);
    console.log('[cron:sync-notion] end', result);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log('[cron:sync-notion] failed', { error: errorMsg.slice(0, 1000) });
    result = { synced: 0, newlyLoaded: 0, updated: 0, contentFetched: 0, contentBackfilled: 0, contentFetchError: 0, error: 1, remainingTargets: 0 };
  }

  try {
    await appendSyncOpsLogToNotion({
      executedAt:       now,
      cronResult:       result.error > 0 ? 'error' : 'ok',
      synced:           result.synced,
      newlyLoaded:      result.newlyLoaded,
      updated:          result.updated,
      contentFetched:   result.contentFetched,
      contentBackfilled: result.contentBackfilled,
      contentFetchError: result.contentFetchError,
      error:            result.error,
      remainingTargets: result.remainingTargets,
    });
    console.log('[cron:sync-notion] notion ops log write success');
  } catch (err) {
    console.warn('[cron:sync-notion] notion ops log write failed', { error: String(err).slice(0, 1000) });
  }

  if (result.error > 0) {
    return Response.json({ ok: false, mode: 'sync', ...result }, { status: 502 });
  }

  return Response.json({ ok: true, mode: 'sync', ...result });
}
