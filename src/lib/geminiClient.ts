/**
 * geminiClient.ts
 *
 * Gemini SDK を完全にカプセル化するモジュール。
 * SDK のバージョンアップ・プロバイダー変更の影響をここに閉じ込める。
 * 外部には ExtractionResult 型と extractTopics 関数のみを公開する。
 */

import {
  GoogleGenerativeAI,
  GoogleGenerativeAIFetchError,
  SchemaType,
  TaskType,
  type Schema,
  type EmbedContentRequest,
} from '@google/generative-ai';
import { getConfig } from './config';

// ─── トピック定義 ─────────────────────────────────────────────────────────────

export const TOPICS = [
  'デジタル化',
  '値上げ',
  '増産',
  '自動化',
  '困りごと',
] as const;

export type Topic = (typeof TOPICS)[number];

// ─── 戻り値の型 ───────────────────────────────────────────────────────────────

export interface TopicResult {
  /** 議事録に該当トピックの記述が実際に存在するか */
  applicable: boolean;
  /** 議事録から抜き出した原文テキスト（applicable=false は空文字） */
  source_excerpt: string;
  /** 営業向け要約（applicable=false は空文字） */
  summary: string;
}

export type ExtractionResult = Record<Topic, TopicResult>;

// ─── Gemini responseSchema ────────────────────────────────────────────────────

const TOPIC_OBJECT_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    applicable: {
      type: SchemaType.BOOLEAN,
      description: '議事録にこのトピックの記述が実際に存在する場合は true。記述がない・背景情報のみの場合は false。',
    },
    source_excerpt: {
      type: SchemaType.STRING,
      description: '議事録本文から該当箇所をそのまま引用したテキスト。applicable=false の場合は空文字。',
    },
    summary: {
      type: SchemaType.STRING,
      description: '営業担当者がネクストアクションを判断できる 2〜3 文。applicable=false の場合は空文字。',
    },
  },
  required: ['applicable', 'source_excerpt', 'summary'],
};

const RESPONSE_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: Object.fromEntries(TOPICS.map((t) => [t, TOPIC_OBJECT_SCHEMA])),
  required: [...TOPICS],
};

// ─── クライアントのシングルトン ───────────────────────────────────────────────

let _client: ReturnType<GoogleGenerativeAI['getGenerativeModel']> | null = null;

function getClient() {
  if (_client) return _client;

  const { gemini } = getConfig();
  const genAI = new GoogleGenerativeAI(gemini.apiKey);

  _client = genAI.getGenerativeModel({
    model: gemini.model,
    generationConfig: {
      temperature:      0.1,
      responseMimeType: 'application/json',
      responseSchema:   RESPONSE_SCHEMA,
    },
  });

  return _client;
}

// ─── リトライ設定 ─────────────────────────────────────────────────────────────

const RETRY_BASE_MS  = 1_000;
const RETRY_MAX_WAIT = 16_000; // 上限16秒

/** 指定ミリ秒スリープ */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** リトライすべき一時的エラーかどうかを判定 */
function isTransient(err: unknown): boolean {
  if (err instanceof GoogleGenerativeAIFetchError) {
    // 429: レート制限、500/502/503/504: サーバー側の一時障害
    const s = err.status ?? 0;
    return s === 429 || s >= 500;
  }
  // ネットワーク障害（fetch が reject した場合）
  if (err instanceof TypeError && (err as TypeError).message.includes('fetch')) return true;
  return false;
}

/** エラーを ErrorType 文字列に変換 */
function toErrorType(err: unknown, attempt: number): string {
  if (err instanceof GoogleGenerativeAIFetchError) {
    if (err.status === 429)          return 'GEMINI_RATE_LIMIT';
    if ((err.status ?? 0) >= 500)    return 'GEMINI_API';
    return 'GEMINI_API';
  }
  if (err instanceof SyntaxError)   return 'GEMINI_PARSE';
  if (err instanceof Error && err.name === 'AbortError') return 'GEMINI_TIMEOUT';
  return 'UNKNOWN';
}

// ─── プロンプト生成 ───────────────────────────────────────────────────────────

function buildPrompt(title: string, content: string): string {
  return `あなたは営業議事録の分析アシスタントです。
以下の議事録から、指定された各トピックに関連する記述を抽出してください。

## 議事録タイトル
${title}

## 議事録本文
${content}

## トピック定義

| トピック | 対象となる内容 |
|----------|----------------|
| デジタル化 | IoT・データ収集・リモート監視・クラウド連携・PLC通信・設定管理のデジタル化に関する顧客の要望・関心・現状 |
| 値上げ | 価格改定・価格交渉・コスト上昇への言及・値上げ承認プロセス・価格受け入れ状況 |
| 増産 | 生産量増加・ライン増設・新設備導入・稼働率向上・キャパシティ拡大に関する顧客の計画や要望 |
| 自動化 | 手作業の機械化・省人化・センサーやロボットによる工程自動化に関する顧客ニーズや課題 |
| 困りごと | 設備トラブル・業務上の課題・不満・要望・障害になっている事象（顧客が直面している問題） |

## applicable の判定ルール
- 議事録にそのトピックの記述が実際に存在する場合のみ true にする
- 以下の場合は false にする:
  - 記述が一切ない
  - 他社や過去の背景情報・参考情報に過ぎず、顧客自身のニーズ・課題ではない
  - applicable: false の場合、source_excerpt と summary は必ず空文字 "" にする

## トピック優先ルール（重複割り当て禁止）
- 1 つの記述が複数トピックに該当する場合は、最も直接的なトピックのみに割り当てる
- 例: 「値上げ承認ルートが複雑で時間がかかる」→ 値上げ（困りごとには含めない）
- 例: 「過去に自動化を手がけていた会社の紹介」→ 顧客自身のニーズでなければ自動化: false

## source_excerpt のルール
- 議事録本文から該当箇所をそのまま引用する（要約・言い換え・複数箇所の合成は禁止）
- 複数箇所ある場合は改行（\\n）で連結する

## summary のルール
- 営業担当者がネクストアクションを判断できる 2〜3 文で記述する
- 顧客の温度感・商談可能性・障壁・推奨アクションを含める
- 「〜でした」という事実説明だけにしない

JSON のみ出力し、前置き・説明文は含めないでください。`;
}

// ─── メインエクスポート ────────────────────────────────────────────────────────

/**
 * 議事録からトピック別抽出を行う。
 * 429・タイムアウト・5xx は指数バックオフでリトライする。
 *
 * @param title   議事録タイトル
 * @param content 議事録本文テキスト
 * @returns       トピック別抽出結果
 * @throws        maxRetries 回を超えた場合に最後のエラーを再スロー
 */
export async function extractTopics(
  title: string,
  content: string,
): Promise<ExtractionResult> {
  const { processing: { maxRetries } } = getConfig();
  const prompt = buildPrompt(title, content);
  const client = getClient();

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await client.generateContent(prompt);
      const raw    = result.response.text();

      // responseSchema 指定時は SDK 側でバリデーション済みだが念のため確認
      const parsed = JSON.parse(raw) as ExtractionResult;
      return parsed;

    } catch (err) {
      lastError = err;

      const shouldRetry = attempt < maxRetries && isTransient(err);
      if (!shouldRetry) break;

      // 指数バックオフ（1s → 2s → 4s ... 上限16s）
      const wait = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_WAIT);
      // 429 の場合は Retry-After ヘッダーがあれば優先
      const retryAfterMs = err instanceof GoogleGenerativeAIFetchError
        ? parseRetryAfter(err)
        : null;

      await sleep(retryAfterMs ?? wait);
    }
  }

  throw lastError;
}

/**
 * エラーオブジェクトから ErrorType 文字列を取得する。
 * cron route.ts でのエラー分類に使用する。
 */
export { toErrorType };

// ─── Embedding クライアント ───────────────────────────────────────────────────

const EMBED_MODEL = 'embedding-001';

let _embedClient: ReturnType<GoogleGenerativeAI['getGenerativeModel']> | null = null;

function getEmbedClient() {
  if (_embedClient) return _embedClient;
  const { gemini } = getConfig();
  const genAI = new GoogleGenerativeAI(gemini.apiKey);
  _embedClient = genAI.getGenerativeModel({ model: EMBED_MODEL });
  return _embedClient;
}

/**
 * テキストを 768 次元の embedding ベクトルに変換する。
 * 429・5xx・ネットワークエラーは指数バックオフでリトライする。
 *
 * @param text 埋め込み対象テキスト（空文字列は呼び出し元で弾くこと）
 * @returns 768 次元の number 配列
 * @throws maxRetries 回を超えた場合に最後のエラーを再スロー
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getEmbedClient();
  const request: EmbedContentRequest = {
    content: { parts: [{ text }], role: 'user' },
    taskType: TaskType.RETRIEVAL_DOCUMENT,
  };

  let lastError: unknown;

  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const result = await client.embedContent(request);
      return result.embedding.values;
    } catch (err) {
      lastError = err;
      const shouldRetry = attempt < 3 && isTransient(err);
      if (!shouldRetry) break;
      const wait = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_WAIT);
      const retryAfterMs = err instanceof GoogleGenerativeAIFetchError ? parseRetryAfter(err) : null;
      await sleep(retryAfterMs ?? wait);
    }
  }

  throw lastError;
}

// ─── 内部ユーティリティ ───────────────────────────────────────────────────────

/** GoogleGenerativeAIFetchError の Retry-After ヘッダーをミリ秒で返す */
function parseRetryAfter(err: GoogleGenerativeAIFetchError): number | null {
  // SDK v0.24 では headers プロパティは未公開のため、メッセージから推測
  // 将来のバージョンで headers.get('Retry-After') が使えるようになれば差し替える
  const match = err.message.match(/retry[- ]after[:\s]+(\d+)/i);
  if (!match) return null;
  return parseInt(match[1], 10) * 1000;
}
