import { requireAuth } from '@/lib/auth';
import {
  getPageStats,
  getTopicCounts,
  getCustomerTopics,
  getMonthlyTrend,
  getCompetitorFrequency,
} from '@/lib/queries';

const TOPICS = ['デジタル化', '値上げ', '増産', '自動化', '困りごと'] as const;

export default async function AdminPage() {
  await requireAuth();

  const [stats, topicCounts, customerTopics, monthlyTrend, competitorFreq] = await Promise.all([
    getPageStats(),
    getTopicCounts(),
    getCustomerTopics(),
    getMonthlyTrend(),
    getCompetitorFrequency(),
  ]);

  // 時系列推移: データをピボットしてテーブル表示用に変換
  const months   = [...new Set(monthlyTrend.map(r => r.month))].sort().reverse();
  const trendMap = new Map<string, Map<string, number>>();
  for (const row of monthlyTrend) {
    if (!trendMap.has(row.month)) trendMap.set(row.month, new Map());
    trendMap.get(row.month)!.set(row.topic, row.count);
  }

  const lastProcessed = stats.lastProcessedAt
    ? new Date(stats.lastProcessedAt).toLocaleString('ja-JP')
    : '—';

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* ヘッダー */}
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">管理画面</h1>
          <div className="flex items-center gap-4">
            <a href="/search" className="text-sm text-blue-600 hover:underline">
              検索画面 →
            </a>
            <a href="/logout" className="text-sm text-gray-500 hover:underline">
              ログアウト
            </a>
          </div>
        </div>

        {/* 全体サマリー */}
        <section>
          <h2 className="text-lg font-semibold text-gray-700 mb-3">全体サマリー</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard label="総ページ数"  value={stats.total}      />
            <StatCard label="done"        value={stats.done}       color="text-green-600" />
            <StatCard label="pending"     value={stats.pending}    color="text-yellow-600" />
            <StatCard label="error"       value={stats.error}      color="text-red-600" />
            <StatCard label="最終処理"    value={lastProcessed}    small />
          </div>
        </section>

        {/* topic 別件数 */}
        <section>
          <h2 className="text-lg font-semibold text-gray-700 mb-3">
            topic 別件数（applicable=true）
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {TOPICS.map(t => {
              const found = topicCounts.find(r => r.topic === t);
              return <TopicCard key={t} topic={t} count={found?.count ?? 0} />;
            })}
          </div>
        </section>

        {/* 顧客別 topic 一覧 */}
        <section>
          <h2 className="text-lg font-semibold text-gray-700 mb-3">
            顧客別 topic 一覧
          </h2>
          <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <Th>タイトル</Th>
                  <Th>topic</Th>
                  <Th>summary</Th>
                  <Th>source_excerpt</Th>
                  <Th>処理日時</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {customerTopics.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                      データなし
                    </td>
                  </tr>
                )}
                {customerTopics.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <Td className="max-w-xs truncate">{row.title ?? '—'}</Td>
                    <Td>
                      <TopicBadge topic={row.topic} />
                    </Td>
                    <Td className="max-w-sm whitespace-pre-wrap">{row.summary}</Td>
                    <Td className="max-w-sm text-xs italic text-gray-500 whitespace-pre-wrap">
                      {row.sourceExcerpt}
                    </Td>
                    <Td className="whitespace-nowrap text-gray-500">
                      {row.processedAt
                        ? new Date(row.processedAt).toLocaleDateString('ja-JP')
                        : '—'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 時系列推移 */}
        <section>
          <h2 className="text-lg font-semibold text-gray-700 mb-3">
            時系列推移（月別 × topic 別）
          </h2>
          <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <Th>月</Th>
                  {TOPICS.map(t => <Th key={t}>{t}</Th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {months.length === 0 && (
                  <tr>
                    <td colSpan={TOPICS.length + 1} className="px-4 py-8 text-center text-gray-400">
                      データなし
                    </td>
                  </tr>
                )}
                {months.map(month => (
                  <tr key={month} className="hover:bg-gray-50">
                    <Td className="font-mono">{month}</Td>
                    {TOPICS.map(t => (
                      <Td key={t} className="text-center">
                        {trendMap.get(month)?.get(t) ?? 0}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 競合出現頻度 */}
        <section>
          <h2 className="text-lg font-semibold text-gray-700 mb-3">競合出現頻度</h2>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden max-w-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <Th>キーワード</Th>
                  <Th className="text-right">出現ページ数</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {competitorFreq.map(row => (
                  <tr key={row.keyword} className="hover:bg-gray-50">
                    <Td>{row.keyword}</Td>
                    <Td className="text-right font-mono">{row.count}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </main>
  );
}

// ─── ローカルコンポーネント ────────────────────────────────────────────────────

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

function TopicCard({ topic, count }: { topic: string; count: number }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{topic}</p>
      <p className="text-2xl font-bold text-blue-600">{count}</p>
    </div>
  );
}

function TopicBadge({ topic }: { topic: string }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
      {topic}
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
