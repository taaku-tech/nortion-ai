/**
 * Notion DB プロパティ診断スクリプト
 * 実行: npm run notion:diagnose
 *
 * 対象 DB の properties 一覧（名前・型）を取得して表示する。
 * sort / タイトル / 日付プロパティの設定値を決める前に実行する。
 */

import 'dotenv/config';

const NOTION_TOKEN       = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const NOTION_API_VERSION = process.env.NOTION_API_VERSION ?? '2022-06-28';

if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error('ERROR: NOTION_TOKEN と NOTION_DATABASE_ID を .env.local に設定してください');
  process.exit(1);
}

interface NotionPropertyConfig {
  type: string;
  [key: string]: unknown;
}

interface NotionDatabase {
  id:         string;
  title:      Array<{ plain_text: string }>;
  properties: Record<string, NotionPropertyConfig>;
}

async function main() {
  const url = `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}`;

  const res = await fetch(url, {
    headers: {
      Authorization:    `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_API_VERSION,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Notion API error ${res.status}: ${body}`);
    process.exit(1);
  }

  const db = await res.json() as NotionDatabase;

  const dbTitle = db.title?.map((t) => t.plain_text).join('') ?? '（タイトルなし）';
  console.log(`\n=== Notion DB: ${dbTitle} (${db.id}) ===\n`);

  const props = Object.entries(db.properties).sort(([a], [b]) => a.localeCompare(b));

  // タイプ別に色分けラベルを付ける
  const TYPE_NOTES: Record<string, string> = {
    title:            '← タイトル (TITLE_PROPERTY)',
    date:             '← 日付候補 (NOTION_DATE_PROPERTY)',
    rich_text:        '← テキスト',
    select:           '',
    multi_select:     '',
    people:           '',
    relation:         '',
    rollup:           '',
    formula:          '',
    number:           '',
    checkbox:         '',
    url:              '',
    email:            '',
    phone_number:     '',
    created_time:     '',
    last_edited_time: '',
    files:            '',
  };

  console.log('プロパティ名'.padEnd(30) + 'タイプ'.padEnd(20) + '備考');
  console.log('─'.repeat(70));

  for (const [name, prop] of props) {
    const note = TYPE_NOTES[prop.type] ?? '';
    console.log(name.padEnd(30) + prop.type.padEnd(20) + note);
  }

  // サマリー
  const titleProps = props.filter(([, p]) => p.type === 'title').map(([n]) => n);
  const dateProps  = props.filter(([, p]) => p.type === 'date' ).map(([n]) => n);

  console.log('\n=== 推奨設定 ===\n');

  if (titleProps.length > 0) {
    console.log(`タイトルプロパティ: "${titleProps[0]}"  (自動検出されます)`);
  } else {
    console.log('タイトルプロパティ: 見つかりません');
  }

  if (dateProps.length === 0) {
    console.log('日付プロパティ   : 存在しません → NOTION_DATE_PROPERTY は不要（sort なし）');
  } else if (dateProps.length === 1) {
    console.log(`日付プロパティ   : "${dateProps[0]}" → .env.local に追加:`);
    console.log(`                   NOTION_DATE_PROPERTY=${dateProps[0]}`);
  } else {
    console.log(`日付プロパティ   : 複数候補 → いずれかを .env.local に設定:`);
    for (const n of dateProps) {
      console.log(`                   NOTION_DATE_PROPERTY=${n}`);
    }
  }

  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
