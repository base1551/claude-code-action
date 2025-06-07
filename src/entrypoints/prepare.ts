#!/usr/bin/env bun

/**
 * Prepare the Claude action by checking trigger conditions, verifying human actor,
 * and creating the initial tracking comment
 */

import * as core from "@actions/core";
import { setupGitHubToken } from "../github/token";
import { checkTriggerAction } from "../github/validation/trigger";
import { checkHumanActor } from "../github/validation/actor";
import { checkWritePermissions } from "../github/validation/permissions";
import { createInitialComment } from "../github/operations/comments/create-initial";
import { setupBranch } from "../github/operations/branch";
import { updateTrackingComment } from "../github/operations/comments/update-with-branch";
import { prepareMcpConfig } from "../mcp/install-mcp-server";
import { createPrompt } from "../create-prompt";
import { createOctokit } from "../github/api/client";
import { fetchGitHubData } from "../github/data/fetcher";
import { parseGitHubContext } from "../github/context";
import { OAuthTokenRefresher, getTokensFromEnvironment } from "../oauth/token-refresh";
import { AuditLogger, DEFAULT_SECURITY_CONFIG } from "../oauth/security-utils";

/**
 * OAuth トークンのリフレッシュが必要かチェックし、必要であれば実行
 */
async function performOAuthRefreshIfNeeded(githubToken: string, auditLogger: AuditLogger, forceRefresh: boolean = false): Promise<void> {
  try {
    // デバッグ: 環境変数の存在確認
    console.log('🔍 OAuth設定チェック:');
    console.log(`  CLAUDE_ACCESS_TOKEN: ${process.env.CLAUDE_ACCESS_TOKEN ? '設定済み' : '未設定'}`);
    console.log(`  CLAUDE_REFRESH_TOKEN: ${process.env.CLAUDE_REFRESH_TOKEN ? '設定済み' : '未設定'}`);
    console.log(`  CLAUDE_EXPIRES_AT: ${process.env.CLAUDE_EXPIRES_AT ? '設定済み' : '未設定'}`);

    const currentTokens = getTokensFromEnvironment();

    if (!currentTokens) {
      console.log('ℹ️ OAuth トークンが設定されていません。API Key認証を使用します。');
      return;
    }

    console.log('✅ OAuth トークンが検出されました');

    const repository = process.env.GITHUB_REPOSITORY;
    if (!repository) {
      console.warn('⚠️ GITHUB_REPOSITORY が設定されていません');
      return;
    }

    const [owner, repo] = repository.split('/');
    const refresher = new OAuthTokenRefresher(githubToken, owner, repo);

    if (forceRefresh) {
      auditLogger.log('scheduled_oauth_refresh', {
        repository: repository,
        expires_at: currentTokens.expires_at,
      }, true);
    } else {
      auditLogger.log('oauth_refresh_check', {
        repository: repository,
        expires_at: currentTokens.expires_at,
      }, true);
    }

    const result = await refresher.performAutoRefresh(currentTokens, forceRefresh);

    if (!result.success) {
      auditLogger.log('oauth_refresh_failed', {
        repository: repository,
        error: result.error,
      }, false, result.error);
      if (forceRefresh) {
        console.error('❌ スケジュールされたOAuth トークンリフレッシュに失敗しました');
        throw new Error(`Scheduled OAuth refresh failed: ${result.error}`);
      } else {
        console.warn('⚠️ OAuth トークンリフレッシュに失敗しましたが、既存のトークンで継続します');
      }
      return;
    }

    if (result.refreshed) {
      auditLogger.log('oauth_refresh_success', {
        repository: repository,
        new_expires_at: result.tokens?.expires_at,
      }, true);
      if (forceRefresh) {
        console.log('✅ スケジュールされたOAuth トークンリフレッシュが完了しました');
      } else {
        console.log('✅ OAuth トークンが自動的にリフレッシュされました');
      }

      // 新しいトークンを環境変数に設定（このプロセス内で使用するため）
      if (result.tokens) {
        process.env.CLAUDE_ACCESS_TOKEN = result.tokens.access_token;
        process.env.CLAUDE_REFRESH_TOKEN = result.tokens.refresh_token;
        process.env.CLAUDE_EXPIRES_AT = result.tokens.expires_at;
      }
    } else {
      console.log('✅ OAuth トークンはまだ有効です');
    }
  } catch (error) {
    auditLogger.log('oauth_refresh_error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    }, false, error instanceof Error ? error.message : undefined);
    if (forceRefresh) {
      console.error('❌ スケジュールされたOAuth トークンリフレッシュでエラーが発生:', error);
      throw error;
    } else {
      console.warn('⚠️ OAuth トークンチェック中にエラーが発生:', error);
    }
  }
}

async function run() {
  try {
    // Step 1: Setup GitHub token
    const githubToken = await setupGitHubToken();
    const octokit = createOctokit(githubToken);

    // Step 1.5: OAuth Token Auto-Refresh (if OAuth is being used)
    const auditLogger = new AuditLogger(DEFAULT_SECURITY_CONFIG.audit.maxLogs);
    await performOAuthRefreshIfNeeded(githubToken, auditLogger);

    // Step 2: Parse GitHub context (once for all operations)
    const context = parseGitHubContext();

    // Step 3: Check write permissions
    const hasWritePermissions = await checkWritePermissions(
      octokit.rest,
      context,
    );
    if (!hasWritePermissions) {
      throw new Error(
        "Actor does not have write permissions to the repository",
      );
    }

    // Step 4: Check for scheduled OAuth refresh trigger
    const directPrompt = process.env.DIRECT_PROMPT;
    const isScheduledOAuthRefresh = directPrompt === "__SCHEDULED_OAUTH_REFRESH__";

    if (isScheduledOAuthRefresh) {
      console.log("🔄 スケジュールされたOAuthリフレッシュを実行中...");
      await performOAuthRefreshIfNeeded(githubToken, auditLogger, true);
      console.log("✅ スケジュールされたOAuthリフレッシュが完了しました");

      // スケジュール実行の場合は contains_trigger を false に設定して終了
      core.setOutput("contains_trigger", "false");
      core.setOutput("GITHUB_TOKEN", githubToken || "");
      return;
    }

    // Step 5: Check trigger conditions
    const containsTrigger = await checkTriggerAction(context);

    if (!containsTrigger) {
      console.log("No trigger found, skipping remaining steps");
      return;
    }

    // Step 6: Check if actor is human
    await checkHumanActor(octokit.rest, context);

    // Step 7: Create initial tracking comment
    const commentId = await createInitialComment(octokit.rest, context);

    // Step 8: Fetch GitHub data (once for both branch setup and prompt creation)
    const githubData = await fetchGitHubData({
      octokits: octokit,
      repository: `${context.repository.owner}/${context.repository.repo}`,
      prNumber: context.entityNumber.toString(),
      isPR: context.isPR,
    });

    // Step 9: Setup branch
    const branchInfo = await setupBranch(octokit, githubData, context);

    // Step 10: Update initial comment with branch link (only for issues that created a new branch)
    if (branchInfo.claudeBranch) {
      await updateTrackingComment(
        octokit,
        context,
        commentId,
        branchInfo.claudeBranch,
      );
    }

    // Step 11: Create prompt file
    await createPrompt(
      commentId,
      branchInfo.defaultBranch,
      branchInfo.claudeBranch,
      githubData,
      context,
    );

    // Step 12: Get MCP configuration
    const mcpConfig = await prepareMcpConfig(
      githubToken,
      context.repository.owner,
      context.repository.repo,
      branchInfo.currentBranch,
    );
    core.setOutput("mcp_config", mcpConfig);
  } catch (error) {
    core.setFailed(`Prepare step failed with error: ${error}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  run();
}
