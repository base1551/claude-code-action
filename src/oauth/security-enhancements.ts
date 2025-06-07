/**
 * OAuth セキュリティ強化ユーティリティ
 */

import { maskSensitiveValue, AuditLogger, InputValidator } from './security-utils';

export interface SecureTokenResult {
  success: boolean;
  masked_tokens: {
    access_token: string;
    refresh_token: string;
    expires_at: string;
  };
  error?: string;
}

/**
 * セキュアなOAuth処理のラッパークラス
 */
export class SecureOAuthHandler {
  private auditLogger: AuditLogger;

  constructor() {
    this.auditLogger = new AuditLogger();
  }

  /**
   * トークンを安全にマスクして返す
   */
  maskTokensForLogging(tokens: {
    access_token: string;
    refresh_token: string;
    expires_at: string;
  }): SecureTokenResult {
    try {
      // 入力検証
      if (!InputValidator.validateToken(tokens.access_token, 'access')) {
        throw new Error('Invalid access token format');
      }
      if (!InputValidator.validateToken(tokens.refresh_token, 'refresh')) {
        throw new Error('Invalid refresh token format');
      }
      if (!InputValidator.validateDateString(tokens.expires_at)) {
        throw new Error('Invalid expiration date format');
      }

      const maskedTokens = {
        access_token: maskSensitiveValue(tokens.access_token),
        refresh_token: maskSensitiveValue(tokens.refresh_token),
        expires_at: tokens.expires_at, // 日時は公開しても問題ない
      };

      this.auditLogger.log('token_masking', {
        operation: 'mask_oauth_tokens',
        timestamp: new Date().toISOString(),
      }, true);

      return {
        success: true,
        masked_tokens: maskedTokens,
      };
    } catch (error) {
      this.auditLogger.log('token_masking', {
        operation: 'mask_oauth_tokens',
        error: error instanceof Error ? error.message : 'Unknown error',
      }, false, error instanceof Error ? error.message : 'Unknown error');

      return {
        success: false,
        masked_tokens: {
          access_token: '***INVALID***',
          refresh_token: '***INVALID***',
          expires_at: '***INVALID***',
        },
        error: error instanceof Error ? error.message : 'Token masking failed',
      };
    }
  }

  /**
   * セキュアなログ出力
   */
  logSecureMessage(message: string, tokens?: {
    access_token: string;
    refresh_token: string;
    expires_at: string;
  }): void {
    if (tokens) {
      const maskedResult = this.maskTokensForLogging(tokens);
      console.log(`${message} - Tokens: ${JSON.stringify(maskedResult.masked_tokens)}`);
    } else {
      console.log(message);
    }
  }

  /**
   * 監査ログを取得
   */
  getAuditLogs(limit?: number) {
    return this.auditLogger.getLogs(limit);
  }
}

/**
 * GitHub Actions のセキュアな出力設定
 */
export class SecureActionOutput {
  /**
   * セキュアな環境変数設定（ログに記録されない）
   */
  static setSecureOutput(name: string, value: string): void {
    // GitHub Actions の機密出力を使用
    console.log(`::add-mask::${value}`);
    console.log(`::set-output name=${name}::${value}`);
  }

  /**
   * マスクされた成功メッセージ
   */
  static logSuccess(operation: string, hasTokens: boolean = false): void {
    if (hasTokens) {
      console.log(`✅ ${operation} - トークンは安全に更新されました（GitHub Secretsに保存済み）`);
    } else {
      console.log(`✅ ${operation} - 処理が完了しました`);
    }
  }

  /**
   * セキュアなエラーログ
   */
  static logError(operation: string, error: unknown): void {
    const safeError = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ ${operation} - エラー: ${safeError}`);
  }
}
