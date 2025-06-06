#!/usr/bin/env bun

/**
 * Security utilities for OAuth token handling
 */

/**
 * Mask sensitive token for logging
 */
export function maskToken(token: string, visibleChars = 8): string {
  if (!token || token.length <= visibleChars) {
    return "[REDACTED]";
  }
  return `${token.substring(0, visibleChars)}...[MASKED]`;
}

/**
 * Validate token format
 */
export function validateTokenFormat(token: string, tokenType: "access" | "refresh"): boolean {
  if (!token || typeof token !== "string") {
    return false;
  }

  switch (tokenType) {
    case "access":
      return token.startsWith("sk-ant-") && token.length > 20;
    case "refresh":
      return token.startsWith("refresh_") && token.length > 20;
    default:
      return false;
  }
}

/**
 * Sanitize error messages to prevent token leakage
 */
export function sanitizeErrorMessage(error: any): string {
  if (!error) return "Unknown error";

  let message = error.message || error.toString();

  // Remove potential tokens from error messages
  message = message.replace(/sk-ant-[a-zA-Z0-9_-]+/g, "[ACCESS_TOKEN_REDACTED]");
  message = message.replace(/refresh_[a-zA-Z0-9_-]+/g, "[REFRESH_TOKEN_REDACTED]");

  return message;
}

/**
 * Check if we're running in a secure environment
 */
export function isSecureEnvironment(): boolean {
  // Check if we're in GitHub Actions
  if (!process.env.GITHUB_ACTIONS) {
    return false;
  }

  // Check if secrets are properly masked
  if (!process.env.GITHUB_TOKEN) {
    return false;
  }

  return true;
}

/**
 * Rate limiting for token refresh to prevent abuse
 */
export class TokenRefreshRateLimit {
  private static lastRefresh: number = 0;
  private static readonly MIN_INTERVAL = 60000; // 1 minute minimum

  static canRefresh(): boolean {
    const now = Date.now();
    if (now - this.lastRefresh < this.MIN_INTERVAL) {
      return false;
    }
    this.lastRefresh = now;
    return true;
  }

  static getRemainingCooldown(): number {
    const now = Date.now();
    const remaining = this.MIN_INTERVAL - (now - this.lastRefresh);
    return Math.max(0, remaining);
  }
}

/**
 * Secure logging that masks sensitive data
 */
export class SecureLogger {
  static info(message: string, ...args: any[]): void {
    const sanitizedArgs = args.map(arg =>
      typeof arg === "string" ? this.maskSensitiveData(arg) : arg
    );
    console.log(message, ...sanitizedArgs);
  }

  static warn(message: string, ...args: any[]): void {
    const sanitizedArgs = args.map(arg =>
      typeof arg === "string" ? this.maskSensitiveData(arg) : arg
    );
    console.warn(message, ...sanitizedArgs);
  }

  static error(message: string, error?: any): void {
    const sanitizedError = error ? sanitizeErrorMessage(error) : "";
    console.error(message, sanitizedError);
  }

  private static maskSensitiveData(data: string): string {
    return data
      .replace(/sk-ant-[a-zA-Z0-9_-]+/g, "[ACCESS_TOKEN_REDACTED]")
      .replace(/refresh_[a-zA-Z0-9_-]+/g, "[REFRESH_TOKEN_REDACTED]")
      .replace(/"access_token":\s*"[^"]+"/g, '"access_token": "[REDACTED]"')
      .replace(/"refresh_token":\s*"[^"]+"/g, '"refresh_token": "[REDACTED]"');
  }
}

/**
 * Validate GitHub repository permissions
 */
export async function validateGitHubPermissions(
  githubToken: string,
  owner: string,
  repo: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/permissions`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (!response.ok) {
      return false;
    }

    const permissions = await response.json() as any;
    return permissions.enabled === true;
  } catch {
    return false;
  }
}

/**
 * Audit log entry for token operations
 */
export function createAuditLog(
  operation: "refresh" | "update_secrets" | "validation_failure",
  details: {
    repository?: string;
    success: boolean;
    error?: string;
    timestamp?: number;
  }
): void {
  const auditEntry = {
    operation,
    timestamp: details.timestamp || Date.now(),
    repository: details.repository || process.env.GITHUB_REPOSITORY,
    success: details.success,
    error: details.error ? sanitizeErrorMessage(details.error) : undefined,
    actor: process.env.GITHUB_ACTOR,
    run_id: process.env.GITHUB_RUN_ID,
  };

  // Log to GitHub Actions summary for audit trail
  console.log(`[AUDIT] ${JSON.stringify(auditEntry)}`);
}
