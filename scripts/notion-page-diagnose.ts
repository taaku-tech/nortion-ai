/**
 * Notion ページ本文取得診断スクリプト
 * 実行: npm run notion:page-diagnose [pageId]
 *
 * pageId 未指定時は DB の先頭 1 件を自動取得する。
 * ブロック構造（type / nesting）と組み立てたテキストを両方表示する。
 */

import 'dotenv/config';

const NOTION_TOKEN        = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID  = process.env.NOTION_DATABASE_ID;
const NOTION_DATE_PROPERTY = process.env.NOTION_DATE_PROPERTY ?? '';
const NOTION_API_VERSION  = process.env.NOTION_API_VERSION ?? '2022-06-28';

if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error('ERROR: NOTION_TOKEN / NOTION_DATABASE_ID が未設定です');
  process.exit(1);
}

const HEADERS = {
  Authorization:    `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': NOTION_API_VERSION,
  'Content-Type':   'application/json',
};

// ─── Notion API helpers ───────────────────────────────────────────────────────

interface RichText { plain_text: string }

interface Block {
  id:           string;
  type:         string;
  has_children: boolean;
  [key: string]: unknown;
}

async function fetchBlocks(blockId: string): Promise<Block[]> {
  const url = `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`blocks fetch failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { results: Block[] };
  return data.results;
}

async function fetchFirstPageId(): Promise<string> {
  const body: Record<string, unknown> = { page_size: 1 };
  if (NOTION_DATE_PROPERTY) {
    body.sorts = [{ property: NOTION_DATE_PROPERTY, direction: 'descending' }];
  }
  const res = await fetch(
    `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
    { method: 'POST', headers: HEADERS, body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error(`DB query failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { results: Array<{ id: string; properties: Record<string, unknown> }> };
  if (!data.results.length) throw new Error('DB にページが存在しません');

  const page = data.results[0];
  // タイトル（"名前" プロパティ）を表示
  const nameProp = page.properties['名前'] as { title?: RichText[] } | undefined;
  const title = nameProp?.title?.map((t) => t.plain_text).join('') ?? '（タイトルなし）';
  console.log(`対象ページ: "${title}" (${page.id})\n`);
  return page.id;
}

// ─── ブロックツリー表示 ───────────────────────────────────────────────────────

const RICH_TEXT_TYPES = new Set([
  'paragraph', 'heading_1', 'heading_2', 'heading_3',
  'bulleted_list_item', 'numbered_list_item',
  'to_do', 'toggle', 'quote', 'callout',
]);

async function printBlockTree(
  blockId: string,
  depth:   number,
  lines:   string[],
): Promise<void> {
  const blocks = await fetchBlocks(blockId);
  const indent = '  '.repeat(depth);

  for (const block of blocks) {
    const content = block[block.type] as { rich_text?: RichText[]; checked?: boolean } | undefined;
    const rawText = content?.rich_text?.map((r) => r.plain_text).join('') ?? '';
    const preview = rawText.slice(0, 60).replace(/\n/g, '↵');

    console.log(`${indent}[${block.type}]${block.has_children ? ' ▼' : ''} "${preview}"`);

    if (RICH_TEXT_TYPES.has(block.type) && rawText.trim()) {
      lines.push(rawText);
    }

    // nested blocks を再帰取得（toggle / callout / bulleted_list_item など）
    if (block.has_children) {
      await printBlockTree(block.id, depth + 1, lines);
    }
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const pageId = process.argv[2] ?? await fetchFirstPageId();

  console.log('=== ブロック構造 ===\n');
  const lines: string[] = [];
  await printBlockTree(pageId, 0, lines);

  const assembled = lines.join('\n');

  console.log('\n=== 組み立てたテキスト ===\n');
  console.log(assembled || '（テキストなし）');

  console.log('\n=== 統計 ===');
  console.log(`行数       : ${lines.length}`);
  console.log(`文字数     : ${assembled.length}`);
  console.log(`改行保持   : ${assembled.includes('\n') ? 'あり' : 'なし（全行 flat）'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
