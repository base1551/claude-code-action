#!/usr/bin/env bun

import * as fs from "fs/promises";
import * as path from "path";

export interface AutoSetupOptions {
  githubToken: string;
  owner: string;
  repo: string;
  useOAuth?: boolean;
  customInstructions?: string;
  allowedTools?: string;
  model?: string;
}

/**
 * Default claude.yml template for OAuth authentication
 */
export const CLAUDE_YML_OAUTH_TEMPLATE = `name: Claude Code

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]
  pull_request_review:
    types: [submitted]

jobs:
  claude:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review' && contains(github.event.review.body, '@claude')) ||
      (github.event_name == 'issues' && (contains(github.event.issue.body, '@claude') || contains(github.event.issue.title, '@claude')))
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
      id-token: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Run Claude Code
        id: claude
        uses: Akira-Papa/claude-code-action@beta
        with:
          # OAuth authentication for Claude Max subscribers
          use_oauth: "true"
          claude_access_token: \${{ secrets.CLAUDE_ACCESS_TOKEN }}
          claude_refresh_token: \${{ secrets.CLAUDE_REFRESH_TOKEN }}
          claude_expires_at: \${{ secrets.CLAUDE_EXPIRES_AT }}

          # Optional configurations
          timeout_minutes: "60"
          {{CUSTOM_INSTRUCTIONS}}{{ALLOWED_TOOLS}}{{MODEL}}
`;

/**
 * Default claude.yml template for API key authentication
 */
export const CLAUDE_YML_API_TEMPLATE = `name: Claude Code

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]
  pull_request_review:
    types: [submitted]

jobs:
  claude:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review' && contains(github.event.review.body, '@claude')) ||
      (github.event_name == 'issues' && (contains(github.event.issue.body, '@claude') || contains(github.event.issue.title, '@claude')))
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
      id-token: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Run Claude Code
        id: claude
        uses: Akira-Papa/claude-code-action@beta
        with:
          # API key authentication
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}

          # Optional configurations
          timeout_minutes: "60"
          {{CUSTOM_INSTRUCTIONS}}{{ALLOWED_TOOLS}}{{MODEL}}
`;

/**
 * Check if repository already has Claude configuration
 */
export async function hasClaudeConfiguration(
  githubToken: string,
  owner: string,
  repo: string
): Promise<boolean> {
  try {
    const workflowPaths = [
      ".github/workflows/claude.yml",
      ".github/workflows/claude.yaml",
      ".github/workflows/claude-code.yml",
      ".github/workflows/claude-code.yaml"
    ];

    for (const workflowPath of workflowPaths) {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${workflowPath}`,
        {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github+json",
          },
        }
      );

      if (response.ok) {
        console.log(`Found existing Claude configuration: ${workflowPath}`);
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error("Error checking for existing Claude configuration:", error);
    return false;
  }
}

/**
 * Generate claude.yml content based on options
 */
export function generateClaudeYml(options: AutoSetupOptions): string {
  const template = options.useOAuth ? CLAUDE_YML_OAUTH_TEMPLATE : CLAUDE_YML_API_TEMPLATE;

  let content = template;

  // Replace custom instructions
  if (options.customInstructions) {
    const instructionsYaml = `custom_instructions: |
            ${options.customInstructions.split('\n').join('\n            ')}
          `;
    content = content.replace("{{CUSTOM_INSTRUCTIONS}}", instructionsYaml);
  } else {
    content = content.replace("{{CUSTOM_INSTRUCTIONS}}", "");
  }

  // Replace allowed tools
  if (options.allowedTools) {
    const toolsYaml = `allowed_tools: "${options.allowedTools}"
          `;
    content = content.replace("{{ALLOWED_TOOLS}}", toolsYaml);
  } else {
    content = content.replace("{{ALLOWED_TOOLS}}", "");
  }

  // Replace model
  if (options.model) {
    const modelYaml = `model: "${options.model}"
          `;
    content = content.replace("{{MODEL}}", modelYaml);
  } else {
    content = content.replace("{{MODEL}}", "");
  }

  return content;
}

/**
 * Create claude.yml in repository
 */
export async function createClaudeWorkflow(
  githubToken: string,
  owner: string,
  repo: string,
  content: string
): Promise<void> {
  const workflowPath = ".github/workflows/claude.yml";

  // First, check if .github/workflows directory exists
  try {
    const dirResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/.github/workflows`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (!dirResponse.ok && dirResponse.status === 404) {
      // Create .github/workflows directory structure
      await createDirectory(githubToken, owner, repo, ".github/workflows");
    }
  } catch (error) {
    console.log("Creating .github/workflows directory...");
    await createDirectory(githubToken, owner, repo, ".github/workflows");
  }

  // Create the workflow file
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${workflowPath}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "feat: Add Claude Code GitHub Action workflow",
        content: Buffer.from(content).toString("base64"),
        committer: {
          name: "Claude Auto Setup",
          email: "claude-auto-setup@users.noreply.github.com",
        },
      }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json() as any;
    throw new Error(
      `Failed to create workflow file: ${response.status} ${response.statusText} - ${
        errorData.message || "Unknown error"
      }`
    );
  }

  console.log(`✅ Created Claude workflow: ${workflowPath}`);
}

/**
 * Create directory structure in repository
 */
async function createDirectory(
  githubToken: string,
  owner: string,
  repo: string,
  dirPath: string
): Promise<void> {
  // Create a .gitkeep file to ensure directory exists
  const keepFilePath = `${dirPath}/.gitkeep`;

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${keepFilePath}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `feat: Create ${dirPath} directory`,
        content: Buffer.from("").toString("base64"),
        committer: {
          name: "Claude Auto Setup",
          email: "claude-auto-setup@users.noreply.github.com",
        },
      }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json() as any;
    throw new Error(
      `Failed to create directory: ${response.status} ${response.statusText} - ${
        errorData.message || "Unknown error"
      }`
    );
  }
}

/**
 * Check if repository secrets are configured
 */
export async function checkSecretsConfiguration(
  githubToken: string,
  owner: string,
  repo: string,
  useOAuth: boolean
): Promise<{ configured: boolean; missingSecrets: string[] }> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/secrets`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to check secrets: ${response.statusText}`);
    }

    const data = await response.json() as any;
    const existingSecrets = data.secrets?.map((s: any) => s.name) || [];

    const requiredSecrets = useOAuth
      ? ["CLAUDE_ACCESS_TOKEN", "CLAUDE_REFRESH_TOKEN", "CLAUDE_EXPIRES_AT"]
      : ["ANTHROPIC_API_KEY"];

    const missingSecrets = requiredSecrets.filter(
      secret => !existingSecrets.includes(secret)
    );

    return {
      configured: missingSecrets.length === 0,
      missingSecrets,
    };
  } catch (error) {
    console.error("Error checking secrets configuration:", error);
    return {
      configured: false,
      missingSecrets: useOAuth
        ? ["CLAUDE_ACCESS_TOKEN", "CLAUDE_REFRESH_TOKEN", "CLAUDE_EXPIRES_AT"]
        : ["ANTHROPIC_API_KEY"],
    };
  }
}

/**
 * Main auto-setup function
 */
export async function autoSetupClaudeCode(
  options: AutoSetupOptions
): Promise<{ success: boolean; message: string }> {
  try {
    const { githubToken, owner, repo, useOAuth = true } = options;

    // Check if Claude is already configured
    const hasExistingConfig = await hasClaudeConfiguration(githubToken, owner, repo);

    if (hasExistingConfig) {
      return {
        success: true,
        message: "Claude Code is already configured in this repository.",
      };
    }

    // Generate and create workflow file
    const workflowContent = generateClaudeYml(options);
    await createClaudeWorkflow(githubToken, owner, repo, workflowContent);

    // Check secrets configuration
    const secretsCheck = await checkSecretsConfiguration(githubToken, owner, repo, useOAuth);

    let message = "✅ Claude Code workflow has been created successfully!";

    if (!secretsCheck.configured) {
      message += `\n\n⚠️  Please configure the following repository secrets:\n`;
      secretsCheck.missingSecrets.forEach(secret => {
        message += `   - ${secret}\n`;
      });

      if (useOAuth) {
        message += `\nFor OAuth setup:\n`;
        message += `1. Find your credentials in ~/.claude/.credentials.json\n`;
        message += `2. Add them as repository secrets in Settings > Secrets and variables > Actions\n`;
      } else {
        message += `\nFor API key setup:\n`;
        message += `1. Get your Anthropic API key from https://console.anthropic.com/\n`;
        message += `2. Add it as ANTHROPIC_API_KEY in Settings > Secrets and variables > Actions\n`;
      }
    }

    return {
      success: true,
      message,
    };
  } catch (error) {
    console.error("Auto-setup failed:", error);
    return {
      success: false,
      message: `Auto-setup failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
