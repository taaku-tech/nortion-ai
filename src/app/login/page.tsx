import { loginAction } from './actions';

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const hasError = params.error === '1';

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-lg border border-gray-200 p-8 w-full max-w-md space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-gray-900">Notion営業議事録AI</h1>
          <p className="text-sm text-gray-600">
            営業議事録をAIで整理し、商談・訪問知識として活用するための管理画面です。
          </p>
        </div>

        <div className="bg-gray-50 rounded-md p-4 text-sm text-gray-600 space-y-1 leading-relaxed">
          <p>Notionに蓄積された営業議事録をAIで解析し、</p>
          <p>「デジタル化」「値上げ」「増産」「自動化」「困りごと」などの重要トピックを抽出します。</p>
          <p className="pt-1">ログイン後は、訪問状況ダッシュボードや抽出結果の検索画面を確認できます。</p>
        </div>

        {hasError && (
          <p className="text-sm text-red-600">パスワードが正しくありません。</p>
        )}

        <form action={loginAction} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1" htmlFor="password">
              パスワード
            </label>
            <input
              id="password"
              type="password"
              name="password"
              required
              autoFocus
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <button
            type="submit"
            className="w-full px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            ログイン
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center">
          営業担当・マネージャー向けの画面です。パスワードを入力してください。
        </p>
      </div>
    </main>
  );
}
