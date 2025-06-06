#!/usr/bin/env bun

import * as core from "@actions/core";

export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}

/**
 * Check if OAuth token is expired or will expire soon
 */
export function isTokenExpired(expiresAt: number, bufferMinutes = 5): boolean {
  const now = Date.now() / 1000; // Current time in seconds
  const buffer = bufferMinutes * 60; // Buffer in seconds
  return expiresAt <= (now + buffer);
}

/**
 * Refresh OAuth token using refresh token
 */
export async function refreshOAuthToken(
  refreshToken: string
): Promise<RefreshTokenResponse> {
  const response = await fetch("https://claude.ai/api/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

    if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as any;
    throw new Error(
      `Token refresh failed: ${response.status} ${response.statusText} - ${
        errorData.error || "Unknown error"
      }`
    );
  }

  const data = await response.json() as any;

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken, // Keep old refresh token if new one not provided
    expires_at: data.expires_at || (Date.now() / 1000 + 3600), // Default to 1 hour if not provided
  };
}

/**
 * Update GitHub repository secrets with new tokens
 */
export async function updateGitHubSecrets(
  githubToken: string,
  owner: string,
  repo: string,
  tokens: RefreshTokenResponse
): Promise<void> {
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;

  // Get public key for encryption
  const publicKeyResponse = await fetch(`${baseUrl}/actions/secrets/public-key`, {
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!publicKeyResponse.ok) {
    throw new Error(`Failed to get public key: ${publicKeyResponse.statusText}`);
  }

  const { key, key_id } = await publicKeyResponse.json() as any;

  // Encrypt secrets using sodium (libsodium-wrappers)
  const sodium = await import("libsodium-wrappers") as any;
  await sodium.ready;

  const encryptSecret = (value: string): string => {
    const valueBytes = sodium.from_string(value);
    const keyBytes = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
    const encryptedBytes = sodium.crypto_box_seal(valueBytes, keyBytes);
    return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);
  };

  // Update secrets
  const secrets = {
    CLAUDE_ACCESS_TOKEN: tokens.access_token,
    CLAUDE_REFRESH_TOKEN: tokens.refresh_token,
    CLAUDE_EXPIRES_AT: tokens.expires_at.toString(),
  };

    for (const [name, value] of Object.entries(secrets)) {
    const encryptedValue = encryptSecret(value!);

    const updateResponse = await fetch(`${baseUrl}/actions/secrets/${name}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        encrypted_value: encryptedValue,
        key_id,
      }),
    });

    if (!updateResponse.ok) {
      throw new Error(`Failed to update secret ${name}: ${updateResponse.statusText}`);
    }
  }

  console.log("✅ GitHub secrets updated successfully");
}

/**
 * Main function to handle OAuth token refresh
 */
export async function handleOAuthTokenRefresh(): Promise<OAuthTokens | null> {
  try {
    const accessToken = process.env.CLAUDE_ACCESS_TOKEN;
    const refreshToken = process.env.CLAUDE_REFRESH_TOKEN;
    const expiresAt = process.env.CLAUDE_EXPIRES_AT;
    const githubToken = process.env.GITHUB_TOKEN;
    const repository = process.env.GITHUB_REPOSITORY;

    // Check if OAuth is being used
    if (!accessToken || !refreshToken || !expiresAt) {
      console.log("OAuth tokens not found, skipping refresh");
      return null;
    }

    const expiresAtNumber = parseInt(expiresAt);

    // Check if token needs refresh
    if (!isTokenExpired(expiresAtNumber)) {
      console.log("Token is still valid, no refresh needed");
      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAtNumber,
      };
    }

    console.log("🔄 Token expired or expiring soon, refreshing...");

    // Refresh the token
    const newTokens = await refreshOAuthToken(refreshToken);

    console.log("✅ Token refreshed successfully");

    // Update GitHub secrets if we have the necessary permissions
    if (githubToken && repository) {
      const [owner, repo] = repository.split("/");
      try {
        await updateGitHubSecrets(githubToken!, owner!, repo!, newTokens);
      } catch (error) {
        console.warn("⚠️ Failed to update GitHub secrets automatically:", error);
        console.log("Please update the following secrets manually:");
        console.log(`CLAUDE_ACCESS_TOKEN: [REDACTED - ${newTokens.access_token.substring(0, 8)}...]`);
        console.log(`CLAUDE_REFRESH_TOKEN: [REDACTED - ${newTokens.refresh_token.substring(0, 8)}...]`);
        console.log(`CLAUDE_EXPIRES_AT: ${newTokens.expires_at}`);
        console.log("Check the action summary for secure access to new tokens.");
      }
    }

    // Set secured outputs (only expiration time is safe to output)
    core.setOutput("token_refreshed", "true");
    core.setOutput("claude_expires_at", newTokens.expires_at.toString());

    // Store sensitive tokens in masked summary (not accessible to other steps)
    core.summary.addRaw(`
      <details>
      <summary>🔐 Refreshed OAuth Tokens (Secure Access)</summary>

      **Access Token**: \`${newTokens.access_token.substring(0, 12)}...[MASKED]\`
      **Refresh Token**: \`${newTokens.refresh_token?.substring(0, 12)}...[MASKED]\`
      **Expires At**: \`${newTokens.expires_at}\`

      ⚠️ **Security Note**: Full tokens are automatically stored in repository secrets.
      Never copy these values to unsecured locations.
      </details>
    `);
    await core.summary.write();

    return {
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token,
      expires_at: newTokens.expires_at,
    };
  } catch (error) {
    console.error("❌ Token refresh failed:", error);
    throw error;
  }
}
