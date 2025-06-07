/**
 * Cloudflare回避用のHTTPユーティリティ
 */

export interface CloudflareBypassOptions {
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

/**
 * Cloudflareブロック回避のためのHTTPリクエスト
 */
export async function bypassCloudflareRequest(
  url: string,
  options: RequestInit,
  bypassOptions: CloudflareBypassOptions = {}
): Promise<Response> {
  const {
    maxRetries = 3,
    retryDelay = 2000,
    timeout = 30000,
  } = bypassOptions;

  // 現実的なブラウザヘッダーを追加
  const enhancedHeaders = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,ja;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    ...options.headers,
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🌐 リクエスト実行中 (試行 ${attempt}/${maxRetries}): ${url}`);

      // タイムアウト付きでリクエスト実行
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        ...options,
        headers: enhancedHeaders,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Cloudflareブロックの検出
      if (response.status === 403) {
        const text = await response.text();
        if (text.includes('Just a moment') || text.includes('cloudflare')) {
          console.warn(`🚫 Cloudflareブロック検出 (試行 ${attempt}/${maxRetries})`);

          if (attempt < maxRetries) {
            const delay = retryDelay * attempt; // 指数バックオフ
            console.log(`⏳ ${delay}ms 待機してリトライします...`);
            await sleep(delay);
            continue;
          }

          throw new CloudflareBlockError('Cloudflareによってブロックされました');
        }
      }

      // レート制限の検出
      if (response.status === 429) {
        console.warn(`⚠️ レート制限検出 (試行 ${attempt}/${maxRetries})`);

        if (attempt < maxRetries) {
          const delay = retryDelay * attempt * 2; // レート制限はより長く待機
          console.log(`⏳ ${delay}ms 待機してリトライします...`);
          await sleep(delay);
          continue;
        }
      }

      return response;

    } catch (error) {
      console.error(`❌ リクエストエラー (試行 ${attempt}/${maxRetries}):`, error);

      if (attempt < maxRetries && !(error instanceof CloudflareBlockError)) {
        const delay = retryDelay * attempt;
        console.log(`⏳ ${delay}ms 待機してリトライします...`);
        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  throw new Error(`最大試行回数 (${maxRetries}) に達しました`);
}

/**
 * 指定時間待機
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Cloudflareブロックエラー
 */
export class CloudflareBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudflareBlockError';
  }
}

/**
 * Claude API専用のリクエスト関数
 */
export async function claudeApiRequest(
  endpoint: string,
  data: any,
  options: CloudflareBypassOptions = {}
): Promise<any> {
  const url = `https://claude.ai${endpoint}`;

  const response = await bypassCloudflareRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  }, {
    maxRetries: 5,
    retryDelay: 3000,
    timeout: 60000,
    ...options,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API Error: ${response.status} - ${errorText.substring(0, 200)}`);
  }

  return response.json();
}
