import { requireAuth } from '@/lib/auth';
import { getCustomerTopics, type SortColumn, type SortOrder } from '@/lib/queries';

type LimitValue = 30 | 100 | 'all';

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function str(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v : '';
}

function parseLimit(raw: string | string[] | undefined): LimitValue {
  if (raw === '100') return 100;
  if (raw === 'all') return 'all';
  return 30;
}

const VALID_SORT_COLUMNS: readonly SortColumn[] = ['title', 'notionDate', 'topic', 'processedAt'];

function parseSortColumn(raw: string | string[] | undefined): SortColumn {
  const v = str(raw);
  return (VALID_SORT_COLUMNS as readonly string[]).includes(v) ? v as SortColumn : 'processedAt';
}

function parseSortOrder(raw: string | string[] | undefined): SortOrder {
  return str(raw) === 'asc' ? 'asc' : 'desc';
}

function buildTabHref(limit: LimitValue, sort: SortColumn, order: SortOrder): string {
  const parts: string[] = [];
  if (limit !== 30) parts.push(`limit=${limit}`);
  if (sort !== 'processedAt' || order !== 'desc') {
    parts.push(`sort=${sort}`);
    parts.push(`order=${order}`);
  }
  return parts.length ? `/admin/customers?${parts.join('&')}` : '/admin/customers';
}

function buildSortHref(limit: LimitValue, sortKey: SortColumn, nextOrder: SortOrder): string {
  const parts: string[] = [];
  if (limit !== 30) parts.push(`limit=${limit}`);
  parts.push(`sort=${sortKey}`);
  parts.push(`order=${nextOrder}`);
  return `/admin/customers?${parts.join('&')}`;
}

export default async function CustomersPage({ searchParams }: Props) {
  await requireAuth();

  const params = await searchParams;
  const limit  = parseLimit(params.limit);
  const sort   = parseSortColumn(params.sort);
  const order  = parseSortOrder(params.order);
  const rows   = await getCustomerTopics(limit, sort, order);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* ヘッダー */}
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">顧客別 Topic 一覧</h1>
          <div className="flex items-center gap-4">
            <a href="/admin"      className="text-sm text-blue-600 hover:underline">ダッシュボード</a>
            <a href="/search"     className="text-sm text-blue-600 hover:underline">検索</a>
            <a href="/admin/ops"  className="text-sm text-blue-600 hover:underline">運用管理</a>
            <a href="/logout"     className="text-sm text-gray-500 hover:underline">ログアウト</a>
          </div>
        </div>

        {/* 件数タブ */}
        <div className="flex items-center gap-2">
          <TabLink href={buildTabHref(30,    sort, order)} active={limit === 30}    label="最新30件" />
          <TabLink href={buildTabHref(100,   sort, order)} active={limit === 100}   label="最新100件" />
          <TabLink href={buildTabHref('all', sort, order)} active={limit === 'all'} label="全件" />
          {limit === 'all' && (
            <span className="text-xs text-orange-600 ml-2">
              全件表示は時間がかかる場合があります
            </span>
          )}
        </div>

        {/* 件数表示 */}
        <p className="text-sm text-gray-500">{rows.length} 件</p>

        {/* テーブル (PC: md以上) */}
        <div className="hidden md:block overflow-x-auto bg-white rounded-lg border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <SortTh label="タイトル"  sortKey="title"       sort={sort} order={order} limit={limit} buildHref={buildSortHref} />
                <SortTh label="日付"      sortKey="notionDate"  sort={sort} order={order} limit={limit} buildHref={buildSortHref} />
                <SortTh label="topic"     sortKey="topic"       sort={sort} order={order} limit={limit} buildHref={buildSortHref} />
                <Th>summary</Th>
                <Th>source_excerpt</Th>
                <SortTh label="処理日時"  sortKey="processedAt" sort={sort} order={order} limit={limit} buildHref={buildSortHref} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    データなし
                  </td>
                </tr>
              )}
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <Td className="max-w-xs truncate">{row.title ?? '—'}</Td>
                  <Td className="whitespace-nowrap">{row.notionDate ?? '—'}</Td>
                  <Td>
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                      {row.topic}
                    </span>
                  </Td>
                  <Td className="max-w-sm whitespace-pre-wrap">{row.summary}</Td>
                  <Td className="max-w-sm text-xs italic text-gray-500 whitespace-pre-wrap">
                    {row.sourceExcerpt}
                  </Td>
                  <Td className="whitespace-nowrap text-gray-500">
                    {row.processedAt
                      ? (row.processedAt instanceof Date
                          ? row.processedAt.toLocaleDateString('ja-JP')
                          : String(row.processedAt))
                      : '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* スマホ用ソート (md未満) */}
        <div className="md:hidden flex flex-wrap gap-2 text-xs">
          <span className="text-gray-500 self-center">並び替え:</span>
          {([
            { key: 'processedAt', label: '処理日' },
            { key: 'notionDate',  label: '日付' },
            { key: 'title',       label: 'タイトル' },
            { key: 'topic',       label: 'topic' },
          ] as { key: SortColumn; label: string }[]).map(({ key, label }) => {
            const isActive = sort === key;
            const next: SortOrder = isActive && order === 'desc' ? 'asc' : 'desc';
            return (
              <a key={key} href={buildSortHref(limit, key, next)}
                className={`px-2 py-1 rounded border ${isActive
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300'}`}>
                {label}{isActive ? (order === 'asc' ? ' ↑' : ' ↓') : ''}
              </a>
            );
          })}
        </div>

        {/* スマホ用カード (md未満) */}
        <div className="md:hidden space-y-3">
          {rows.length === 0 && (
            <p className="text-center text-gray-400 py-8">データなし</p>
          )}
          {rows.map((row, i) => {
            const notionUrl = `https://www.notion.so/${row.pageId.replace(/-/g, '')}`;
            return (
              <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-gray-900 break-words">{row.title ?? '—'}</span>
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 whitespace-nowrap shrink-0">
                    {row.topic}
                  </span>
                </div>
                {(row.companyName || row.locationName) && (
                  <p className="text-xs text-gray-500">
                    {[row.companyName, row.locationName].filter(Boolean).join(' / ')}
                  </p>
                )}
                <p className="text-xs text-gray-400">{row.notionDate ?? '—'}</p>
                {row.summary && (
                  <p className="text-sm text-gray-700 whitespace-pre-wrap break-words line-clamp-4">{row.summary}</p>
                )}
                {row.sourceExcerpt && (
                  <p className="text-xs italic text-gray-500 whitespace-pre-wrap break-words line-clamp-3">{row.sourceExcerpt}</p>
                )}
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">
                    処理日: {row.processedAt
                      ? (row.processedAt instanceof Date
                          ? row.processedAt.toLocaleDateString('ja-JP')
                          : String(row.processedAt))
                      : '—'}
                  </p>
                  <a href={notionUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-blue-600 underline">
                    Notion本文を見る
                  </a>
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </main>
  );
}

// ─── ローカルコンポーネント ────────────────────────────────────────────────────

function TabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <a
      href={href}
      className={`px-3 py-1.5 text-sm rounded border ${
        active
          ? 'bg-blue-600 text-white border-blue-600'
          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
      }`}
    >
      {label}
    </a>
  );
}

function SortTh({
  label, sortKey, sort, order, limit, buildHref,
}: {
  label:     string;
  sortKey:   SortColumn;
  sort:      SortColumn;
  order:     SortOrder;
  limit:     LimitValue;
  buildHref: (limit: LimitValue, sortKey: SortColumn, nextOrder: SortOrder) => string;
}) {
  const isActive  = sort === sortKey;
  const nextOrder: SortOrder = isActive && order === 'desc' ? 'asc' : 'desc';
  const href      = buildHref(limit, sortKey, nextOrder);
  const indicator = isActive ? (order === 'asc' ? ' ↑' : ' ↓') : '';
  return (
    <th className="px-4 py-2 text-left font-medium text-gray-600">
      <a href={href} className={`hover:text-blue-600 ${isActive ? 'text-blue-700' : ''}`}>
        {label}{indicator}
      </a>
    </th>
  );
}

function Th({
  children, className = '',
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={`px-4 py-2 text-left font-medium text-gray-600 ${className}`}>
      {children}
    </th>
  );
}

function Td({
  children, className = '',
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-4 py-2 text-gray-700 ${className}`}>
      {children}
    </td>
  );
}
