import { createHash } from 'crypto';
import { getConfig } from './config';

// ─── 型定義 ───────────────────────────────────────────────────────────────────

export interface NotionPageMeta {
  pageId:         string;
  title:          string;
  notionDate:     string | null;
  lastEditedTime: Date;
}

export interface NotionPageContent {
  text:        string;
  contentHash: string;
  contentLength: number;
}

// Notion API レスポンスの必要部分のみ型付け
interface NotionRichText {
  plain_text: string;
}

interface NotionBlock {
  type: string;
  [key: string]: unknown;
}

// ─── 対応ブロックタイプ ───────────────────────────────────────────────────────

const SUPPORTED_BLOCK_TYPES = new Set([
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'toggle',
  'quote',
  'callout',
]);

// ─── ヘッダー生成 ─────────────────────────────────────────────────────────────

function buildHeaders(): Record<string, string> {
  const { notion } = getConfig();
  return {
    Authorization:   `Bearer ${notion.token}`,
    'Content-Type':  'application/json',
    'Notion-Version': notion.apiVersion,
  };
}

// ─── ページ一覧取得 ───────────────────────────────────────────────────────────

/**
 * Notion データベースの全ページをメタ情報のみ取得する。
 * ページネーション対応（100件 × N ページ）。
 * 本文テキストは取得しない（処理フェーズで個別取得）。
 */
export async function fetchNotionPages(): Promise<NotionPageMeta[]> {
  const { notion } = getConfig();
  const url = `https://api.notion.com/v1/databases/${notion.databaseId}/query`;
  const headers = buildHeaders();

  const allPages: NotionPageMeta[] = [];
  let hasMore = true;
  let nextCursor: string | null = null;

  while (hasMore) {
    const body: Record<string, unknown> = { page_size: 100 };
    if (notion.dateProperty) {
      body.sorts = [{ property: notion.dateProperty, direction: 'descending' }];
    }
    if (nextCursor) body.start_cursor = nextCursor;

    const res = await fetch(url, {
      method:  'POST',
      headers,
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Notion DB query failed: ${res.status} ${text}`);
    }

    const data = await res.json() as {
      results:    Array<Record<string, unknown>>;
      has_more:   boolean;
      next_cursor: string | null;
    };

    for (const page of data.results) {
      const meta = extractPageMeta(page);
      if (meta) allPages.push(meta);
    }

    hasMore = data.has_more;
    nextCursor = data.next_cursor;
  }

  return allPages;
}

// ─── ページ本文取得 ───────────────────────────────────────────────────────────

/**
 * ページ ID からブロック一覧を取得してプレーンテキストに変換する。
 * 空ページは text: '' を返す。
 */
export async function fetchPageContent(pageId: string): Promise<NotionPageContent> {
  const url = `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`;
  const headers = buildHeaders();

  const res = await fetch(url, { method: 'GET', headers });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion blocks fetch failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { results: NotionBlock[] };
  const lines: string[] = [];

  for (const block of data.results) {
    if (!SUPPORTED_BLOCK_TYPES.has(block.type)) continue;

    const blockContent = block[block.type] as { rich_text?: NotionRichText[] } | undefined;
    if (!blockContent?.rich_text) continue;

    const text = blockContent.rich_text
      .map((rt) => rt.plain_text ?? '')
      .join('');

    if (text.trim()) lines.push(text);
  }

  const text = lines.join('\n');
  const contentHash   = createHash('sha256').update(text).digest('hex');
  const contentLength = text.length;

  return { text, contentHash, contentLength };
}

// ─── メタ情報抽出（内部） ─────────────────────────────────────────────────────

function extractPageMeta(page: Record<string, unknown>): NotionPageMeta | null {
  const pageId         = page.id as string | undefined;
  const lastEditedRaw  = page.last_edited_time as string | undefined;
  const properties     = page.properties as Record<string, Record<string, unknown>> | undefined;

  if (!pageId || !lastEditedRaw || !properties) return null;

  const { notion } = getConfig();

  let title:      string       = '（タイトルなし）';
  let notionDate: string | null = null;

  // 1. NOTION_DATE_PROPERTY と一致するプロパティを優先探索
  // 2. 見つからなければ date 型プロパティを自動探索
  // 3. それでも見つからなければ notionDate = null のまま処理継続

  const entries = Object.entries(properties);

  for (const [, prop] of entries) {
    if (prop.type === 'title') {
      const parts = (prop.title as NotionRichText[] | undefined) ?? [];
      const raw   = parts.map((t) => t.plain_text ?? '').join('').trim();
      if (raw) title = raw;
    }
  }

  if (notion.dateProperty) {
    const target = properties[notion.dateProperty];
    if (target?.type === 'date') {
      const date = target.date as { start?: string } | null;
      if (date?.start) notionDate = date.start;
    }
  }

  if (notionDate === null) {
    for (const [, prop] of entries) {
      if (prop.type === 'date') {
        const date = prop.date as { start?: string } | null;
        if (date?.start) {
          notionDate = date.start;
          break;
        }
      }
    }
  }

  return {
    pageId,
    title,
    notionDate,
    lastEditedTime: new Date(lastEditedRaw),
  };
}
