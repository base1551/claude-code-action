/**
 * セキュリティユーティリティ
 * トークンマスキング、レート制限、監査ログなどの機能を提供
 */

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface AuditLogEntry {
  timestamp: string;
  action: string;
  details: Record<string, any>;
  success: boolean;
  error?: string;
}

/**
 * センシティブな値をマスクする
 */
export function maskSensitiveValue(value: string, visibleChars: number = 4): string {
  if (!value || value.length <= visibleChars * 2) {
    return '*'.repeat(8);
  }

  const start = value.slice(0, visibleChars);
  const end = value.slice(-visibleChars);
  const middle = '*'.repeat(Math.max(8, value.length - visibleChars * 2));

  return `${start}${middle}${end}`;
}

/**
 * レート制限チェッカー
 */
export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * リクエストが制限内かチェック
   */
  isAllowed(identifier: string): boolean {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    if (!this.requests.has(identifier)) {
      this.requests.set(identifier, []);
    }

    const userRequests = this.requests.get(identifier)!;

    // 古いリクエストを削除
    const validRequests = userRequests.filter(timestamp => timestamp > windowStart);
    this.requests.set(identifier, validRequests);

    // 制限内かチェック
    if (validRequests.length >= this.config.maxRequests) {
      return false;
    }

    // 新しいリクエストを記録
    validRequests.push(now);
    return true;
  }

  /**
   * 残りの制限数を取得
   */
  getRemainingRequests(identifier: string): number {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    if (!this.requests.has(identifier)) {
      return this.config.maxRequests;
    }

    const userRequests = this.requests.get(identifier)!;
    const validRequests = userRequests.filter(timestamp => timestamp > windowStart);

    return Math.max(0, this.config.maxRequests - validRequests.length);
  }
}

/**
 * 監査ログ管理
 */
export class AuditLogger {
  private logs: AuditLogEntry[] = [];
  private maxLogs: number;

  constructor(maxLogs: number = 1000) {
    this.maxLogs = maxLogs;
  }

  /**
   * 監査ログエントリを追加
   */
  log(action: string, details: Record<string, any>, success: boolean, error?: string): void {
    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      action,
      details: this.sanitizeDetails(details),
      success,
      error,
    };

    this.logs.push(entry);

    // ログサイズ制限
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // コンソールログ出力
    const logLevel = success ? 'info' : 'error';
    const maskedDetails = Object.fromEntries(
      Object.entries(details).map(([key, value]) => [
        key,
        this.isSensitiveField(key) ? maskSensitiveValue(String(value)) : value
      ])
    );

    console[logLevel](`[AUDIT] ${action}:`, {
      success,
      details: maskedDetails,
      error,
    });
  }

  /**
   * 監査ログを取得
   */
  getLogs(limit?: number): AuditLogEntry[] {
    return limit ? this.logs.slice(-limit) : [...this.logs];
  }

  /**
   * 詳細情報をサニタイズ
   */
  private sanitizeDetails(details: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(details)) {
      if (this.isSensitiveField(key)) {
        sanitized[key] = maskSensitiveValue(String(value));
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * センシティブなフィールドかチェック
   */
  private isSensitiveField(fieldName: string): boolean {
    const sensitiveFields = [
      'token', 'password', 'secret', 'key', 'auth',
      'access_token', 'refresh_token', 'api_key',
      'claude_access_token', 'claude_refresh_token',
      'github_token', 'anthropic_api_key'
    ];

    const lowerField = fieldName.toLowerCase();
    return sensitiveFields.some(sensitive => lowerField.includes(sensitive));
  }
}

/**
 * 入力値バリデーション
 */
export class InputValidator {
  /**
   * トークン形式の検証
   */
  static validateToken(token: string, type: 'access' | 'refresh'): boolean {
    if (!token || typeof token !== 'string') {
      return false;
    }

    // 基本的な長さチェック
    if (token.length < 10 || token.length > 2048) {
      return false;
    }

    // 危険な文字の検出
    const dangerousChars = /[<>\"'&\x00-\x1f\x7f-\x9f]/;
    if (dangerousChars.test(token)) {
      return false;
    }

    return true;
  }

  /**
   * 日時形式の検証
   */
  static validateDateString(dateString: string): boolean {
    if (!dateString || typeof dateString !== 'string') {
      return false;
    }

    const date = new Date(dateString);
    return !isNaN(date.getTime());
  }

  /**
   * GitHub リポジトリ名の検証
   */
  static validateRepositoryName(repo: string): boolean {
    if (!repo || typeof repo !== 'string') {
      return false;
    }

    // owner/repo 形式のチェック
    const parts = repo.split('/');
    if (parts.length !== 2) {
      return false;
    }

        const [owner, repoName] = parts;

    if (!owner || !repoName) {
      return false;
    }

    // GitHub の命名規則に従った基本チェック
    const validNameRegex = /^[a-zA-Z0-9._-]+$/;
    return validNameRegex.test(owner) && validNameRegex.test(repoName);
  }
}

/**
 * エラーハンドリングユーティリティ
 */
export class SecurityError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, any>;

  constructor(message: string, code: string, details?: Record<string, any>) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
    this.details = details;
  }
}

/**
 * セキュアなエラーメッセージ生成（センシティブ情報を除去）
 */
export function createSecureErrorMessage(error: Error): string {
  const message = error.message || 'Unknown error';

  // センシティブ情報のパターンを除去
  const sensitivePatterns = [
    /token[:\s]*[a-zA-Z0-9+/=]{10,}/gi,
    /key[:\s]*[a-zA-Z0-9+/=]{10,}/gi,
    /password[:\s]*\S+/gi,
    /secret[:\s]*\S+/gi,
  ];

  let sanitizedMessage = message;
  sensitivePatterns.forEach(pattern => {
    sanitizedMessage = sanitizedMessage.replace(pattern, '[REDACTED]');
  });

  return sanitizedMessage;
}

/**
 * セキュリティ設定のデフォルト値
 */
export const DEFAULT_SECURITY_CONFIG = {
  rateLimiter: {
    maxRequests: 10,
    windowMs: 60 * 1000, // 1分
  },
  audit: {
    maxLogs: 1000,
  },
} as const;
