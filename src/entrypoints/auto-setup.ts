#!/usr/bin/env bun

/**
 * Auto-setup entrypoint for new repositories
 * This can be used as a standalone action or workflow to setup Claude Code
 */

import { setupGitHubToken } from "../github/token";
import { parseGitHubContext } from "../github/context";
import { autoSetupClaudeCode } from "../setup/auto-setup";

async function run() {
  try {
    console.log("🚀 Starting Claude Code auto-setup...");

    // Setup GitHub token
    const githubToken = await setupGitHubToken();

    // Parse GitHub context
    const context = parseGitHubContext();

    // Get configuration from environment
    const useOAuth = process.env.USE_OAUTH === "true";
    const customInstructions = process.env.CUSTOM_INSTRUCTIONS;
    const allowedTools = process.env.ALLOWED_TOOLS;
    const model = process.env.MODEL;

    // Run auto-setup
    const result = await autoSetupClaudeCode({
      githubToken,
      owner: context.repository.owner,
      repo: context.repository.repo,
      useOAuth,
      customInstructions,
      allowedTools,
      model,
    });

    if (result.success) {
      console.log("✅ Auto-setup completed successfully!");
      console.log(result.message);
    } else {
      console.error("❌ Auto-setup failed:");
      console.error(result.message);
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Auto-setup failed with error:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}
