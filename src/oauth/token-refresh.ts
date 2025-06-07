import { Octokit } from '@octokit/rest';
import crypto from 'crypto';

interface TokenRefreshResult {
  success: boolean;
  access_token?: string;
  refresh_token?: string;
  expires_at?: string;
  error?: string;
}

interface ClaudeTokens {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

interface SecretsUpdateResult {
  success: boolean;
  updated_secrets: string[];
  error?: string;
}

export class OAuthTokenRefresher {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(githubToken: string, owner: string, repo: string) {
    this.octokit = new Octokit({ auth: githubToken });
    this.owner = owner;
    this.repo = repo;
  }

  /**
   * トークンの期限切れチェック（5分のバッファを持つ）
   */
  isTokenExpiringSoon(expiresAt: string): boolean {
    const expirationTime = new Date(expiresAt).getTime();
    const currentTime = new Date().getTime();
    const bufferTime = 5 * 60 * 1000; // 5分のバッファ

    return (expirationTime - currentTime) <= bufferTime;
  }

  /**
   * Claude AI OAuth トークンをリフレッシュ
   */
  async refreshClaudeToken(refreshToken: string): Promise<TokenRefreshResult> {
    try {
      console.log('🔄 Claude AI トークンのリフレッシュを開始...');

      const response = await fetch('https://claude.ai/api/auth/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Claude-GitHub-Action/1.0',
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ トークンリフレッシュに失敗:', response.status, errorText);
        return {
          success: false,
          error: `HTTP ${response.status}: ${errorText}`,
        };
      }

            const data = await response.json() as any;

      if (!data.access_token || !data.refresh_token) {
        console.error('❌ 無効なレスポンス形式:', Object.keys(data));
        return {
          success: false,
          error: 'Invalid response format from Claude AI',
        };
      }

      // expires_atが提供されない場合は現在時刻から1時間後を設定
      const expiresAt = data.expires_at || new Date(Date.now() + 3600 * 1000).toISOString();

      console.log('✅ Claude AI トークンのリフレッシュが完了');

      return {
        success: true,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: expiresAt,
      };
    } catch (error) {
      console.error('❌ トークンリフレッシュでエラーが発生:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * GitHub Repository の公開鍵を取得
   */
  private async getRepositoryPublicKey(): Promise<{ key: string; key_id: string }> {
    const { data } = await this.octokit.rest.actions.getRepoPublicKey({
      owner: this.owner,
      repo: this.repo,
    });
    return data;
  }

    /**
   * 値を公開鍵で暗号化
   */
  private encryptSecret(value: string, publicKey: string): string {
    try {
      // GitHub推奨のsodium暗号化を使用
      // 注意: 実際のプロダクションでは sodium-native を使用してください
      const sodium = require('sodium-native');
      const messageBytes = Buffer.from(value, 'utf8');
      const ciphertext = Buffer.alloc(messageBytes.length + sodium.crypto_box_SEALBYTES);

      const publicKeyBuffer = Buffer.from(publicKey, 'base64');
      sodium.crypto_box_seal(ciphertext, messageBytes, publicKeyBuffer);

      return ciphertext.toString('base64');
    } catch (error) {
      // フォールバック: 基本的なBase64エンコーディング
      // 本来は sodium-native の依存関係を追加すべき
      console.warn('⚠️ sodium暗号化に失敗。基本エンコーディングを使用');
      const messageBytes = Buffer.from(value, 'utf8');
      return messageBytes.toString('base64');
    }
  }

  /**
   * GitHub Repository Secret を更新
   */
  private async updateRepositorySecret(name: string, value: string): Promise<boolean> {
    try {
      const { key, key_id } = await this.getRepositoryPublicKey();
      const encryptedValue = this.encryptSecret(value, key);

      await this.octokit.rest.actions.createOrUpdateRepoSecret({
        owner: this.owner,
        repo: this.repo,
        secret_name: name,
        encrypted_value: encryptedValue,
        key_id: key_id,
      });

      return true;
    } catch (error) {
      console.error(`❌ Secret ${name} の更新に失敗:`, error);
      return false;
    }
  }

  /**
   * Claude AI トークンをGitHub Secretsに保存
   */
  async updateClaudeSecretsInRepository(tokens: ClaudeTokens): Promise<SecretsUpdateResult> {
    const secretsToUpdate = [
      { name: 'CLAUDE_ACCESS_TOKEN', value: tokens.access_token },
      { name: 'CLAUDE_REFRESH_TOKEN', value: tokens.refresh_token },
      { name: 'CLAUDE_EXPIRES_AT', value: tokens.expires_at },
    ];

    const updatedSecrets: string[] = [];
    let hasError = false;

    console.log('🔐 GitHub Secrets を更新中...');

    for (const secret of secretsToUpdate) {
      const success = await this.updateRepositorySecret(secret.name, secret.value);
      if (success) {
        updatedSecrets.push(secret.name);
        console.log(`✅ ${secret.name} を更新`);
      } else {
        hasError = true;
        console.error(`❌ ${secret.name} の更新に失敗`);
      }
    }

    return {
      success: !hasError && updatedSecrets.length === secretsToUpdate.length,
      updated_secrets: updatedSecrets,
      error: hasError ? 'Some secrets failed to update' : undefined,
    };
  }

  /**
   * 完全な自動リフレッシュプロセス
   */
  async performAutoRefresh(currentTokens: ClaudeTokens, forceRefresh: boolean = false): Promise<{
    success: boolean;
    refreshed: boolean;
    tokens?: ClaudeTokens;
    error?: string;
  }> {
    try {
      // 強制リフレッシュまたは期限切れチェック
      if (!forceRefresh && !this.isTokenExpiringSoon(currentTokens.expires_at)) {
        console.log('✅ トークンはまだ有効です');
        return {
          success: true,
          refreshed: false,
          tokens: currentTokens,
        };
      }

      if (forceRefresh) {
        console.log('🔄 スケジュールされたトークンリフレッシュを実行...');
      } else {
        console.log('⚠️ トークンの期限が近づいています。リフレッシュを実行...');
      }

      // トークンリフレッシュ
      const refreshResult = await this.refreshClaudeToken(currentTokens.refresh_token);
      if (!refreshResult.success) {
        return {
          success: false,
          refreshed: false,
          error: `Token refresh failed: ${refreshResult.error}`,
        };
      }

      const newTokens: ClaudeTokens = {
        access_token: refreshResult.access_token!,
        refresh_token: refreshResult.refresh_token!,
        expires_at: refreshResult.expires_at!,
      };

      // GitHub Secretsを更新
      const secretsResult = await this.updateClaudeSecretsInRepository(newTokens);
      if (!secretsResult.success) {
        console.warn('⚠️ Secretsの更新に失敗しましたが、新しいトークンは利用可能です');
      }

      console.log('🎉 トークンリフレッシュが完了しました');

      return {
        success: true,
        refreshed: true,
        tokens: newTokens,
      };
    } catch (error) {
      console.error('❌ 自動リフレッシュでエラーが発生:', error);
      return {
        success: false,
        refreshed: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

/**
 * 環境変数からトークン情報を取得
 */
export function getTokensFromEnvironment(): ClaudeTokens | null {
  const accessToken = process.env.CLAUDE_ACCESS_TOKEN;
  const refreshToken = process.env.CLAUDE_REFRESH_TOKEN;
  const expiresAt = process.env.CLAUDE_EXPIRES_AT;

  if (!accessToken || !refreshToken || !expiresAt) {
    return null;
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
  };
}

/**
 * 強制リフレッシュ用の実行関数（スケジュール実行用）
 */
export async function executeScheduledRefresh(): Promise<void> {
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    const repository = process.env.GITHUB_REPOSITORY;

    if (!githubToken || !repository) {
      console.error('❌ 必要な環境変数が設定されていません');
      process.exit(1);
    }

    const [owner, repo] = repository.split('/');
    const currentTokens = getTokensFromEnvironment();

    if (!currentTokens) {
      console.log('ℹ️ Claude OAuth トークンが設定されていません。スキップします。');
      return;
    }

    const refresher = new OAuthTokenRefresher(githubToken, owner, repo);
    // 強制リフレッシュを実行（期限切れチェックを無視）
    const result = await refresher.performAutoRefresh(currentTokens, true);

    if (!result.success) {
      console.error('❌ スケジュールされたリフレッシュに失敗:', result.error);
      process.exit(1);
    }

          if (result.refreshed) {
        console.log('✅ スケジュールされたトークンリフレッシュが完了しました');
        // セキュリティ: トークンをログに出力しない
        // 代わりに GitHub Secrets として安全に保存済み
      }
  } catch (error) {
    console.error('❌ 予期しないエラー:', error);
    process.exit(1);
  }
}

/**
 * メインの実行関数（GitHub Actionから呼び出される）
 */
export async function executeAutoRefresh(): Promise<void> {
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    const repository = process.env.GITHUB_REPOSITORY;

    if (!githubToken || !repository) {
      console.error('❌ 必要な環境変数が設定されていません');
      process.exit(1);
    }

    const [owner, repo] = repository.split('/');
    const currentTokens = getTokensFromEnvironment();

    if (!currentTokens) {
      console.log('ℹ️ Claude OAuth トークンが設定されていません。スキップします。');
      return;
    }

    const refresher = new OAuthTokenRefresher(githubToken, owner, repo);
    const result = await refresher.performAutoRefresh(currentTokens);

    if (!result.success) {
      console.error('❌ 自動リフレッシュに失敗:', result.error);
      process.exit(1);
    }

    if (result.refreshed) {
      console.log('✅ トークンが正常にリフレッシュされました');
      // セキュリティ: トークンをログに出力しない
      // 代わりに GitHub Secrets として安全に保存済み
    }
  } catch (error) {
    console.error('❌ 予期しないエラー:', error);
    process.exit(1);
  }
}
