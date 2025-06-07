#!/usr/bin/env bun

/**
 * スケジュールされたOAuthトークンの強制リフレッシュ
 * 期限切れチェックを無視して、指定した時間に無条件でトークンを更新
 */

import { executeScheduledRefresh } from "../oauth/token-refresh";

if (import.meta.main) {
  executeScheduledRefresh();
}
