import { requireAuth } from '@/lib/auth';
import { searchExtractions, type SearchResult } from '@/lib/queries';

const TOPICS = ['デジタル化', '値上げ', '増産', '自動化', '困りごと'] as const;

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function str(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v : '';
}

export default async function SearchPage({ searchParams }: Props) {
  await requireAuth();

  const params = await searchParams;

  const keyword      = str(params.q);
  const topic        = str(params.topic);
  const applicableOn = str(params.applicable) === '1';

  const hasSearch = !!(keyword || topic || applicableOn);

  let results: SearchResult[] = [];
  if (hasSearch) {
    results = await searchExtractions({
      keyword:       keyword  || undefined,
      topic:         topic    || undefined,
      applicableOnly: applicableOn,
    });
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* ヘッダー */}
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">検索画面</h1>
          <div className="flex items-center gap-4">
            <a href="/admin" className="text-sm text-blue-600 hover:underline">
              ← 管理画面
            </a>
            <a href="/logout" className="text-sm text-gray-500 hover:underline">
              ログアウト
            </a>
          </div>
        </div>

        {/* 検索フォーム */}
        <section className="bg-white rounded-lg border border-gray-200 p-4">
          <form method="GET" className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-48">
              <label className="block text-xs text-gray-500 mb-1">キーワード</label>
              <input
                type="text"
                name="q"
                defaultValue={keyword}
                placeholder="タイトル・本文・要約を横断検索..."
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">topic</label>
              <select
                name="topic"
                defaultValue={topic}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="">すべて</option>
                {TOPICS.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="checkbox"
                id="applicable"
                name="applicable"
                value="1"
                defaultChecked={applicableOn}
                className="w-4 h-4"
              />
              <label htmlFor="applicable" className="text-sm text-gray-700">
                AIが重要と判断した内容のみ
              </label>
            </div>

            <button
              type="submit"
              className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
            >
              検索
            </button>
          </form>
        </section>

        {/* 検索前メッセージ */}
        {!hasSearch && (
          <p className="text-sm text-gray-500">
            キーワード・topic・フィルタを指定して「検索」ボタンを押してください。
          </p>
        )}

        {/* 検索結果 */}
        {hasSearch && (
          <section>
            <p className="text-sm text-gray-500 mb-2">{results.length} 件</p>
            <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <Th>タイトル</Th>
                    <Th>日付</Th>
                    <Th>topic</Th>
                    <Th>source_excerpt</Th>
                    <Th>summary</Th>
                    <Th>処理日時</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {results.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                        検索結果なし
                      </td>
                    </tr>
                  )}
                  {results.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <Td className="max-w-xs truncate">{row.title ?? '—'}</Td>
                      <Td className="whitespace-nowrap">{row.notionDate ?? '—'}</Td>
                      <Td>
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          {row.topic}
                        </span>
                      </Td>
                      <Td className="max-w-xs text-xs italic text-gray-500 whitespace-pre-wrap">
                        {row.sourceExcerpt}
                      </Td>
                      <Td className="max-w-sm whitespace-pre-wrap">{row.summary}</Td>
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
        )}

      </div>
    </main>
  );
}

// ─── ローカルコンポーネント ────────────────────────────────────────────────────

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
