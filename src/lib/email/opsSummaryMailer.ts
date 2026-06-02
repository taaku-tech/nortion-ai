const RESEND_API_URL = 'https://api.resend.com/emails';

export type SummaryPage = {
  title: string | null;
  notionDate: string | null;
  status: string;
  errorType: string | null;
  errorMsg: string | null;
};

export type OpsSummaryData = {
  executedAt: Date;
  done: number;
  error: number;
  skipped: number;
  embeddingGenerated: number;
  zombieReset: number;
  remaining: number;
  newlyLoadedPages: SummaryPage[];
  processedTodayPages: SummaryPage[];
  errorTodayPages: SummaryPage[];
  permanentErrorPages: SummaryPage[];
  stuckCount: number;
};

function jstDateTimeStr(date: Date): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function jstDateStr(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(date);
}

function pageLines(page: SummaryPage, index: number): string[] {
  const title = page.title ?? '（タイトルなし）';
  const datePart = page.notionDate ? ` (${page.notionDate})` : '';
  const lines = [
    `  ${index + 1}. ${title}${datePart}`,
    `     status: ${page.status}`,
  ];
  if (page.errorType) lines.push(`     error_type: ${page.errorType}`);
  if (page.errorMsg) {
    const msg = page.errorMsg.length > 100
      ? page.errorMsg.slice(0, 100) + '...'
      : page.errorMsg;
    lines.push(`     error_msg: ${msg}`);
  }
  return lines;
}

function buildBody(data: OpsSummaryData): string {
  const lines: string[] = [
    `実行日時: ${jstDateTimeStr(data.executedAt)} JST`,
    '',
    '== 処理結果 ==',
    `  done:                ${data.done}`,
    `  error:               ${data.error}`,
    `  skipped:             ${data.skipped}`,
    `  embedding generated: ${data.embeddingGenerated}`,
    `  zombie reset:        ${data.zombieReset}`,
    `  残件数 (pending):    ${data.remaining}`,
    '',
    '== 本日新規取込ページ ==',
  ];

  if (data.newlyLoadedPages.length === 0) {
    lines.push('  (なし)');
  } else {
    for (let i = 0; i < data.newlyLoadedPages.length; i++) {
      lines.push(...pageLines(data.newlyLoadedPages[i], i));
    }
  }

  lines.push('', '== 本日処理完了ページ ==');
  if (data.processedTodayPages.length === 0) {
    lines.push('  (なし)');
  } else {
    for (let i = 0; i < data.processedTodayPages.length; i++) {
      lines.push(...pageLines(data.processedTodayPages[i], i));
    }
  }

  lines.push('', '== 本日エラーページ ==');
  if (data.errorTodayPages.length === 0) {
    lines.push('  (なし)');
  } else {
    for (let i = 0; i < data.errorTodayPages.length; i++) {
      lines.push(...pageLines(data.errorTodayPages[i], i));
    }
  }

  lines.push('', '== Permanent Error（全件） ==');
  if (data.permanentErrorPages.length === 0) {
    lines.push('  (なし)');
  } else {
    for (let i = 0; i < data.permanentErrorPages.length; i++) {
      lines.push(...pageLines(data.permanentErrorPages[i], i));
    }
  }

  lines.push('', '== Stuck (processing 残り) ==');
  if (data.stuckCount > 0) {
    lines.push(`  ⚠ ${data.stuckCount} 件が processing のままです`);
    lines.push('  → 次回 cron で zombie reset される予定です');
  } else {
    lines.push('  (なし)');
  }

  lines.push('', '---', 'nortion-ai ops summary');

  return lines.join('\n');
}

export async function sendOpsSummaryEmail(
  data: OpsSummaryData,
  config: { apiKey: string; to: string; from: string },
): Promise<void> {
  const subject = `[nortion-ai] Daily extract summary - ${jstDateStr(data.executedAt)}`;
  const text = buildBody(data);

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: config.from, to: [config.to], subject, text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API error: ${res.status} ${body.slice(0, 1000)}`);
  }
}
