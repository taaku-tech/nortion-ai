import { getConfig } from '@/lib/config';

const NOTION_OPS_LOG_TIMEOUT_MS = 10_000;

export type OpsLogErrorPage = {
  title: string | null;
  errorType: string | null;
  errorMsg: string | null;
};

export type OpsLogData = {
  executedAt: Date;
  cronResult: string;
  newlyLoaded: number;
  processed: number;
  done: number;
  error: number;
  permanentError: number;
  stuckProcessing: number;
  skipped: number;
  majorErrors: OpsLogErrorPage[];
};

export type SyncOpsLogData = {
  executedAt:       Date;
  cronResult:       string;
  synced:           number;
  newlyLoaded:      number;
  updated:          number;
  contentFetched:   number;
  contentBackfilled: number;
  contentFetchError: number;
  error:            number;
  remainingTargets: number;
};

export type ProcessOpsLogData = {
  executedAt:           Date;
  cronResult:           string;
  processed:            number;
  done:                 number;
  error:                number;
  permanentError:       number;
  embedded:             number;
  stuckProcessing:      number;
  remaining:            number;
  contentMissing:       number;
  stoppedBeforeTimeout: boolean;
  skipped:              number;
  majorErrors:          OpsLogErrorPage[];
};

function toOpsLogText(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return '';
  return String(value);
}

function jstDateTimeStr(date: Date): string {
  if (!(date instanceof Date)) return toOpsLogText(date);
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
    hour:     '2-digit',
    minute:   '2-digit',
  }).format(date);
}

function truncate(value: unknown, max: number): string {
  const text = toOpsLogText(value);
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function resultLabel(data: OpsLogData): string {
  if (data.cronResult === 'local-test') return 'ローカル検証';
  if (data.error > 0 || data.stuckProcessing > 0) return '一部注意';
  return '正常終了';
}

function actionRequiredLabel(data: OpsLogData): string {
  return data.error > 0 || data.stuckProcessing > 0 ? 'あり' : 'なし';
}

function actionText(page: OpsLogErrorPage): string {
  if (page.errorType === 'NOTION_NOT_FOUND') {
    return 'Notion側でページが削除済み、Integration未共有、またはID不正の可能性を確認してください。既知のテストページであれば対応不要です。';
  }
  return 'エラー内容を確認し、必要に応じてNotion側のページ更新またはDBの手動リセットを検討してください。';
}

function syncResultLabel(data: SyncOpsLogData): string {
  return data.error > 0 ? '一部注意' : '正常終了';
}

function processResultLabel(data: ProcessOpsLogData): string {
  if (data.error > 0 || data.stuckProcessing > 0) return '一部注意';
  return '正常終了';
}

function paragraph(text: unknown) {
  const content = toOpsLogText(text);
  return {
    object: 'block',
    type:   'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content } }],
    },
  };
}

function bullet(text: unknown) {
  const content = toOpsLogText(text);
  return {
    object: 'block',
    type:   'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content } }],
    },
  };
}

async function appendChildrenToNotion(children: Array<ReturnType<typeof paragraph> | ReturnType<typeof bullet>>): Promise<void> {
  const { notion } = getConfig();
  if (!notion.opsLogPageId) return;
  const opsLogPageId = String(notion.opsLogPageId);
  const notionToken = String(notion.token);
  const notionApiVersion = String(notion.apiVersion);
  const url = `https://api.notion.com/v1/blocks/${opsLogPageId}/children`;
  const headers = {
    Authorization:    `Bearer ${notionToken}`,
    'Content-Type':   'application/json',
    'Notion-Version': notionApiVersion,
  };
  const safeChildren = JSON.parse(JSON.stringify(
    children,
    (_key, value) => value instanceof Date ? value.toISOString() : value,
  ));
  const body = JSON.stringify({ children: safeChildren });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NOTION_OPS_LOG_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers,
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Notion ops log write failed: ${res.status} ${body.slice(0, 1000)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function appendSyncOpsLogToNotion(data: SyncOpsLogData): Promise<void> {
  const children = [
    paragraph(`[nortion-ai] ${jstDateTimeStr(data.executedAt)} JST Notion同期結果`),
    bullet(`結果: ${syncResultLabel(data)}`),
    bullet(`Notionから同期したページ数: ${data.synced}`),
    bullet(`新規ページ数: ${data.newlyLoaded}`),
    bullet(`更新ページ数: ${data.updated}`),
    bullet(`本文取得数: ${data.contentFetched}`),
    bullet(`本文補完数: ${data.contentBackfilled}`),
    bullet(`本文取得エラー: ${data.contentFetchError}`),
    bullet(`エラー: ${data.error}`),
    bullet(`処理対象ページ数: ${data.remainingTargets}`),
  ];

  await appendChildrenToNotion(children);
}

export async function appendProcessOpsLogToNotion(data: ProcessOpsLogData): Promise<void> {
  const children = [
    paragraph(`[nortion-ai] ${jstDateTimeStr(data.executedAt)} JST AI処理結果`),
    bullet(`結果: ${processResultLabel(data)}`),
    bullet(`今回処理したページ: ${data.processed}`),
    bullet(`正常完了: ${data.done}`),
    bullet(`一時エラー: ${data.error}`),
    bullet(`恒久エラー（再試行しないエラー）: ${data.permanentError}`),
    bullet(`embedding生成数: ${data.embedded}`),
    bullet(`処理停止の疑い: ${data.stuckProcessing}`),
    bullet(`時間切れ前の安全停止: ${data.stoppedBeforeTimeout ? 'あり' : 'なし'}`),
    bullet(`remaining: ${data.remaining}`),
    bullet(`本文未取得のpending: ${data.contentMissing}`),
    bullet(`スキップ: ${data.skipped > 0 ? 'あり' : 'なし'} (${data.skipped})`),
  ];

  if (data.majorErrors.length > 0) {
    children.push(paragraph('確認が必要な項目'));
    for (const page of data.majorErrors.slice(0, 5)) {
      children.push(bullet(page.title ?? '（タイトルなし）'));
      children.push(bullet(`種別: ${page.errorType ?? 'UNKNOWN'}`));
      children.push(bullet(`内容: ${truncate(page.errorMsg, 160)}`));
      children.push(bullet(`対応: ${actionText(page)}`));
    }
  }

  await appendChildrenToNotion(children);
}

export async function appendOpsLogToNotion(data: OpsLogData): Promise<void> {
  const children = [
    paragraph(`[nortion-ai] ${jstDateTimeStr(data.executedAt)} JST 自動取り込み結果`),
    bullet(`結果: ${resultLabel(data)}`),
    bullet(`対応必要: ${actionRequiredLabel(data)}`),
    bullet(`Notionから新しく同期したページ: ${data.newlyLoaded}`),
    bullet(`今回処理したページ: ${data.processed}`),
    bullet(`正常完了: ${data.done}`),
    bullet(`一時エラー: ${data.error}`),
    bullet(`恒久エラー（再試行しないエラー）: ${data.permanentError}`),
    bullet(`処理停止の疑い: ${data.stuckProcessing}`),
    bullet(`スキップ: ${data.skipped > 0 ? 'あり' : 'なし'} (${data.skipped})`),
  ];

  if (data.permanentError > 0) {
    children.push(paragraph('恒久エラーは、Notion上で対象ページが見つからない等の理由で再試行対象から除外されたものです。既知の削除済みページやテストページであれば対応不要です。'));
  }

  if (data.majorErrors.length > 0) {
    children.push(paragraph('確認が必要な項目'));
    for (const page of data.majorErrors.slice(0, 5)) {
      children.push(bullet(page.title ?? '（タイトルなし）'));
      children.push(bullet(`種別: ${page.errorType ?? 'UNKNOWN'}`));
      children.push(bullet(`内容: ${truncate(page.errorMsg, 160)}`));
      children.push(bullet(`対応: ${actionText(page)}`));
    }
  }

  await appendChildrenToNotion(children);
}
