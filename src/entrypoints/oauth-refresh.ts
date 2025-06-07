#!/usr/bin/env bun

/**
 * OAuth トークンの自動リフレッシュを実行するエントリーポイント
 * GitHub Actions の scheduled workflow から呼び出される
 */

import { executeAutoRefresh } from '../oauth/token-refresh';

async function main() {
  console.log('🔄 Claude OAuth Token 自動リフレッシュを開始...');

  try {
    await executeAutoRefresh();
    console.log('✅ OAuth Token 自動リフレッシュが完了しました');
  } catch (error) {
    console.error('❌ OAuth Token 自動リフレッシュに失敗:', error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
