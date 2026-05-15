import { requireAuth } from '@/lib/auth';
import {
  getPageStats,
  getRecentErrorPages,
  getRetryWarnings,
  getRemainingWork,
} from '@/lib/queries';

export default async function OpsPage() {
  await requireAuth();

  const [stats, errorPages, retryWarnings, remaining] = await Promise.all([
    getPageStats(),
    getRecentErrorPages(),
    getRetryWarnings(),
    getRemainingWork(),
  ]);

  const lastProcessed = formatDateTime(stats.lastProcessedAt);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto space-y-8">

        {/* ヘッダー */}
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">運用監視</h1>
          <div className="flex items-center gap-4">
            <a href="/admin"  className="text-sm text-blue-600 hover:underline">ダッシュボード</a>
            <a href="/search" className="text-sm text-blue-600 hover:underline">検索</a>
            <a href="/logout" className="text-sm text-gray-500 hover:underline">ログアウト</a>
          </div>
        </div>

        {/* 1. Extraction Health Summary */}
        <section>
          <h2 className="text-lg font-semibold text-gray-700 mb-3">Extraction Health Summary</h2>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <StatCard label="total"      value={stats.total}      />
            <StatCard label="done"       value={stats.done}       color="text-green-600" />
            <StatCard label="pending"    value={stats.pending}    color="text-yellow-600" />
            <StatCard label="processing" value={stats.processing} color="text-blue-600" />
            <StatCard label="error"      value={stats.error}      color="text-red-600" />
            <StatCard label="最終処理"   value={lastProcessed}    small />
          </div>
        </section>

        {/* 2. Recent Error Pages */}
        <section>
          <h2 className="text-lg font-semibold text-gray-700 mb-3">
            Recent Error Pages（最新 10 件）
          </h2>
          <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <Th>タイトル</Th>
                  <Th>日付</Th>
                  <Th>retry</Th>
                  <Th>error_type</Th>
                  <Th>error_msg</Th>
                  <Th>processed_at</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {errorPages.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-gray-400">エラーなし</td>
                  </tr>
                ) : errorPages.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <Td className="max-w-xs truncate">{row.title ?? '—'}</Td>
                    <Td className="whitespace-nowrap">{row.notionDate ?? '—'}</Td>
                    <Td className="text-center font-mono text-red-600">{row.retryCount}</Td>
                    <Td className="whitespace-nowrap font-mono text-xs">{row.errorType ?? '—'}</Td>
                    <Td className="max-w-sm text-xs text-gray-600 whitespace-pre-wrap">{row.errorMsg ?? '—'}</Td>
                    <Td className="whitespace-nowrap text-gray-500">
                      {formatDateTime(row.processedAt)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 3. Retry Warnings */}
        <section>
          <h2 className="text-lg font-semibold text-gray-700 mb-3">
            Retry Warnings（retry_count 上位 10 件）
          </h2>
          <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <Th>タイトル</Th>
                  <Th>status</Th>
                  <Th>retry_count</Th>
                  <Th>processed_at</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {retryWarnings.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-gray-400">リトライなし</td>
                  </tr>
                ) : retryWarnings.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <Td className="max-w-xs truncate">{row.title ?? '—'}</Td>
                    <Td>
                      <StatusBadge status={row.status} />
                    </Td>
                    <Td className="text-center font-mono font-bold text-orange-600">{row.retryCount}</Td>
                    <Td className="whitespace-nowrap text-gray-500">
                      {formatDateTime(row.processedAt)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 4. Remaining Work */}
        <section>
          <h2 className="text-lg font-semibold text-gray-700 mb-3">Remaining Work</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="pending"           value={remaining.pending}          color="text-yellow-600" />
            <StatCard label="error"             value={remaining.error}            color="text-red-600" />
            <StatCard label="processing"        value={remaining.processing}       color="text-blue-600" />
            <StatCard label="zombie 候補"        value={remaining.zombieCandidates} color="text-purple-600" />
          </div>
        </section>

      </div>
    </main>
  );
}

// ─── ローカルコンポーネント ────────────────────────────────────────────────────

function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  if (value instanceof Date) return value.toLocaleString('ja-JP');
  return value;
}

function StatCard({
  label, value, color = 'text-gray-900', small = false,
}: {
  label: string;
  value: string | number;
  color?: string;
  small?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`font-bold ${color} ${small ? 'text-sm' : 'text-2xl'}`}>{value}</p>
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  pending:    'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
  done:       'bg-green-100 text-green-800',
  error:      'bg-red-100 text-red-800',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-800';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
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
