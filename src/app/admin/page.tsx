import { requireAuth } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import {
  getPageStats,
  getTopicCounts,
  getMonthlyTrend,
  getWeeklyMeetingCounts,
  getCompanyMeetingCounts,
  type WeeklyRow,
  type CompanyRow,
} from '@/lib/queries';

const TOPICS = ['デジタル化', '値上げ', '増産', '自動化', '困りごと'] as const;

export default async function AdminPage() {
  const tTotal = Date.now();
  console.log('[admin] start');

  const tAuth = Date.now();
  await requireAuth();
  console.log(`[admin] auth: ${Date.now() - tAuth}ms`);

  const { notion } = getConfig();

  const tQueries = Date.now();
  const stats           = await timedPerf('getPageStats',            getPageStats);
  const weeklyMeetings  = await timedPerf('getWeeklyMeetingCounts',  getWeeklyMeetingCounts);
  const companyMeetings = await timedPerf('getCompanyMeetingCounts', getCompanyMeetingCounts);
  const topicCounts     = await timedPerf('getTopicCounts',          getTopicCounts);
  const monthlyTrend    = await timedPerf('getMonthlyTrend',         getMonthlyTrend);
  console.log(`[admin] queries: ${Date.now() - tQueries}ms`);

  // 時系列推移: データをピボットしてテーブル表示用に変換
  const months   = [...new Set(monthlyTrend.map(r => r.month))].sort().reverse();
  const trendMap = new Map<string, Map<string, number>>();
  for (const row of monthlyTrend) {
    if (!trendMap.has(row.month)) trendMap.set(row.month, new Map());
    trendMap.get(row.month)!.set(row.topic, row.count);
  }

  const lastProcessed   = stats.lastProcessedAt
    ? new Date(stats.lastProcessedAt).toLocaleString('ja-JP')
    : '—';
  const totalApplicable = topicCounts.reduce((sum, r) => sum + r.count, 0);

  console.log(`[admin] total: ${Date.now() - tTotal}ms`);
  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* ヘッダー */}
        <div className="flex flex-wrap justify-between items-center gap-2">
          <h1 className="text-xl font-bold text-gray-900">管理画面</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <a href="/admin/customers" className="text-blue-600 hover:underline">顧客別Topic</a>
            <a href="/admin/ops" className="text-blue-600 hover:underline">運用管理</a>
            <a href="/search" className="text-blue-600 hover:underline">検索画面 →</a>
            <a href="/logout" className="text-gray-500 hover:underline">ログアウト</a>
          </div>
        </div>

        {/* 画面説明 */}
        <section className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-gray-700 space-y-2">
          <p>
            このダッシュボードでは、Notion に登録された営業議事録をもとに、訪問件数、会社別の議事録件数、AI が重要と判断した topic の件数、月別の傾向を確認できます。
          </p>
          <p>
            なお、この画面では議事録本文そのものは表示していません。
            議事録の本文を確認したい場合は、Notion 側のデータベース画面を開いて確認してください。
          </p>
          {notion.databaseViewUrl && (
            <p>
              Notion 議事録データベース：
              <a
                href={notion.databaseViewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline ml-1"
              >
                Notion DBを開く
              </a>
            </p>
          )}
        </section>

        {/* 1. 全体サマリー */}
        <section>
          <h2 className="text-lg font-semibold text-gray-700 mb-3">全体サマリー</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="訪問件数 ※議事録有"        value={stats.doneWithDate}  color="text-blue-600" />
            <StatCard label="会社数"                    value={stats.companyCount}  color="text-indigo-600" />
            <StatCard label="topic 抽出個数"               value={totalApplicable}  color="text-green-600" />
            <StatCard label="最終処理日"                value={lastProcessed}       small />
          </div>
        </section>

        {/* 2. 週別訪問件数 */}
        <section>
          <h2 className="text-lg font-semibold text-gray-700 mb-3">
            週別訪問件数 ※議事録有のもの
          </h2>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <WeeklyBarChart data={weeklyMeetings} />
          </div>
        </section>

        {/* 3. 会社別議事録件数（横スクロールカード） */}
        <section>
          <h2 className="text-lg font-semibold text-gray-700 mb-2">会社別議事録件数</h2>
          <p className="text-xs text-gray-400 mb-3">
            ※ Notion の「会社名」プロパティを使用。cron 同期後に反映されます。
          </p>
          {companyMeetings.length === 0 ? (
            <p className="text-sm text-gray-400">データなし</p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {companyMeetings.map((row, i) => (
                <div key={i} className="flex-none w-32 bg-white rounded-lg border border-gray-200 p-3">
                  <p className="text-xs text-gray-500 mb-1 leading-snug line-clamp-2" title={row.companyName}>
                    {row.companyName || '—'}
                  </p>
                  <p className="text-2xl font-bold text-blue-600">{row.count}</p>
                  {row.latestNotionDate && (
                    <p className="text-xs text-gray-400 mt-1">{row.latestNotionDate}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 4. topic 別件数 */}
        <section>
          <h2 className="text-lg font-semibold text-gray-700 mb-3">
            topic 別件数（applicable=true）
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {TOPICS.map(t => {
              const found = topicCounts.find(r => r.topic === t);
              return <TopicCard key={t} topic={t} count={found?.count ?? 0} />;
            })}
          </div>
        </section>

        {/* 5. 時系列推移 */}
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

      </div>
    </main>
  );
}

// ─── クエリタイマー ────────────────────────────────────────────────────────────

async function timedPerf<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    console.log(`[admin] ${label}: ${Date.now() - start}ms`);
    return result;
  } catch (err) {
    console.log(`[admin] ${label} FAILED: ${Date.now() - start}ms | ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

// ─── ローカルコンポーネント ────────────────────────────────────────────────────

function WeeklyBarChart({ data }: { data: WeeklyRow[] }) {
  if (data.length === 0) {
    return <p className="text-center text-gray-400 py-6 text-sm">データなし</p>;
  }
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="space-y-2">
      {data.map(row => (
        <div key={row.weekStart} className="flex items-center gap-3 text-sm">
          <span className="text-gray-500 font-mono w-28 shrink-0 text-right">
            {row.weekStart.replace(/-/g, '/')}週
          </span>
          <div className="flex-1 bg-gray-100 rounded h-5 overflow-hidden">
            <div
              className="bg-blue-400 h-full rounded"
              style={{ width: `${(row.count / max) * 100}%` }}
            />
          </div>
          <span className="text-gray-700 font-mono w-4 text-right">{row.count}</span>
        </div>
      ))}
    </div>
  );
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

function TopicCard({ topic, count }: { topic: string; count: number }) {
  const href = `/search?topic=${encodeURIComponent(topic)}&applicable=1`;

  return (
    <a
      href={href}
      className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400"
    >
      <p className="text-xs text-gray-500 mb-1">{topic}</p>
      <p className="text-2xl font-bold text-blue-600">{count}</p>
    </a>
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
