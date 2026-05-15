/**
 * 抽出結果品質確認スクリプト
 * 実行: npm run db:extract-check
 */

import 'dotenv/config';
import postgres from 'postgres';

// Pooler (port 6543) を優先。Direct接続はWSL2からIPv6非対応の場合がある
const DATABASE_URL = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL が未設定です');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });

interface Row {
  title:          string;
  topic:          string;
  source_excerpt: string;
  summary:        string;
}

async function main() {
  const rows = await sql<Row[]>`
    SELECT
      p.title,
      e.topic,
      e.source_excerpt,
      e.summary
    FROM notion_ai.extractions e
    JOIN notion_ai.pages p ON p.page_id = e.page_id
    ORDER BY p.processed_at DESC, p.title, e.topic
    LIMIT 50
  `;

  if (rows.length === 0) {
    console.log('extractions テーブルにデータがありません');
    await sql.end();
    return;
  }

  // topic別の件数集計
  const topicCount: Record<string, number> = {};
  for (const r of rows) {
    topicCount[r.topic] = (topicCount[r.topic] ?? 0) + 1;
  }

  console.log('=== topic 別件数 ===');
  for (const [topic, count] of Object.entries(topicCount).sort()) {
    console.log(`  ${topic.padEnd(12)}: ${count} 件`);
  }

  console.log(`\n=== 抽出結果一覧 (${rows.length} 件) ===\n`);

  for (const r of rows) {
    console.log('─'.repeat(72));
    console.log(`📄 ${r.title}`);
    console.log(`🏷  topic   : ${r.topic}`);
    console.log(`📝 excerpt : ${r.source_excerpt.slice(0, 200)}${r.source_excerpt.length > 200 ? '…' : ''}`);
    console.log(`💬 summary : ${r.summary.slice(0, 200)}${r.summary.length > 200 ? '…' : ''}`);
    console.log();
  }

  console.log('─'.repeat(72));
  console.log(`合計 ${rows.length} 件`);

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
