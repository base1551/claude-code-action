# Claude OAuth 自動リフレッシュ設定ガイド (日本語)

> ⚠️ **セキュリティ警告**: この機能はClaudeのOAuthトークンを扱います。設定前に以下のセキュリティ要件を必ず確認してください。

## 🔒 セキュリティ要件とベストプラクティス

### 必須セキュリティ設定

1. **リポジトリのプライベート設定**
   - OAuth機能を使用するリポジトリは必ずプライベートに設定
   - パブリックリポジトリでは絶対に使用しない

2. **GitHub Secrets の保護**
   - `CLAUDE_ACCESS_TOKEN`, `CLAUDE_REFRESH_TOKEN` は機密情報
   - 管理者権限を持つユーザーのみがアクセス可能に設定

3. **ワークフロー実行権限の制限**
   - Actions の実行権限を必要最小限に制限
   - 外部コントリビューターからのPRでは自動実行を無効化

4. **監査ログの確認**
   - 定期的にActions実行ログを確認
   - 異常なアクティビティがないかモニタリング

### 🚨 セキュリティリスク

以下のリスクを理解してから使用してください：

- **トークン漏洩**: 設定ミスによりClaudeアクセストークンが漏洩する可能性
- **アカウント乗っ取り**: トークンが悪用される場合、Claudeアカウントに不正アクセス
- **GitHub Actions 悪用**: ワークフローが改ざんされる可能性

### ✅ 推奨セキュリティ設定

```yaml
# .github/workflows/claude-oauth-refresh.yml
permissions:
  contents: read      # 最小権限
  # 注意: secrets権限は存在しません
  # secretsの更新はGITHUB_TOKENを使用してREST APIで実行

# 実行条件を制限
if: |
  github.event_name == 'schedule' ||
  (github.event_name == 'workflow_dispatch' && 
   contains(fromJSON('["owner", "admin"]'), github.actor))
```

## 📋 セットアップ手順

### Step 1: Claude OAuth トークンの取得

1. Claude.ai にログイン
2. 開発者ツールでトークンを取得：
   ```javascript
   // ブラウザの開発者コンソールで実行
   localStorage.getItem('claude_session_token')
   ```

### Step 2: GitHub Secrets の設定

リポジトリの Settings > Secrets and variables > Actions で以下を設定：

```bash
# 必須の機密情報
CLAUDE_ACCESS_TOKEN=your_access_token_here
CLAUDE_REFRESH_TOKEN=your_refresh_token_here
CLAUDE_EXPIRES_AT=2024-01-01T00:00:00Z

# オプション設定
CLAUDE_OAUTH_ENABLED=true
```

### Step 3: ワークフローファイルの追加

`.github/workflows/claude-oauth-refresh.yml` を作成：

```yaml
name: "Claude OAuth Token Scheduled Refresh"

on:
  schedule:
    - cron: '0 9 * * *'  # 毎日午前9時UTC
  workflow_dispatch:     # 手動実行も可能

# セキュリティ：必要最小限の権限
permissions:
  contents: read
  # secretsの更新はGITHUB_TOKENのREST API使用

jobs:
  scheduled-refresh:
    runs-on: ubuntu-latest
    if: secrets.CLAUDE_REFRESH_TOKEN != ''

    steps:
      - name: Security Check
        run: |
          echo "🔒 セキュリティチェック実行中..."
          echo "実行者: ${{ github.actor }}"
          
      - name: OAuth Token Refresh
        uses: Akira-Papa/claude-code-action-Akira-Papa@main
        with:
          direct_prompt: "__SCHEDULED_OAUTH_REFRESH__"
          use_oauth: "true"
          claude_access_token: ${{ secrets.CLAUDE_ACCESS_TOKEN }}
          claude_refresh_token: ${{ secrets.CLAUDE_REFRESH_TOKEN }}
          claude_expires_at: ${{ secrets.CLAUDE_EXPIRES_AT }}
```

## 🔧 カスタマイズオプション

### 実行スケジュールの変更

```yaml
on:
  schedule:
    # 毎時実行
    - cron: '0 * * * *'
    
    # 毎週月曜日
    - cron: '0 9 * * 1'
    
    # 毎月1日
    - cron: '0 9 1 * *'
```

### 条件付き実行

```yaml
# 特定のブランチでのみ実行
if: github.ref == 'refs/heads/main' && secrets.CLAUDE_REFRESH_TOKEN != ''

# 特定のユーザーのみ手動実行可能
if: |
  github.event_name == 'schedule' || 
  (github.event_name == 'workflow_dispatch' && github.actor == 'your-username')
```

## 🧪 テスト手順

### 1. 安全なテスト環境の構築

```bash
# テスト用プライベートリポジトリを作成
gh repo create test-claude-oauth --private

# ワークフローをコピー
cp .github/workflows/claude-oauth-refresh.yml test-repo/
```

### 2. 段階的テスト

1. **手動実行テスト**
   - Actions タブから手動でワークフローを実行
   - ログでエラーがないことを確認

2. **短間隔スケジュールテスト**
   ```yaml
   schedule:
     - cron: '*/5 * * * *'  # 5分間隔で一時的にテスト
   ```

3. **本番環境デプロイ**
   - テスト完了後に本来のスケジュールに戻す

## 🔍 トラブルシューティング

### よくあるセキュリティエラー

1. **トークンが無効**
   ```
   ❌ Token refresh failed: 401 Unauthorized
   ```
   - Claude.ai で新しいトークンを取得し直す

2. **権限エラー**
   ```
   ❌ Secrets の更新に失敗
   ```
   - ワークフローの `permissions` 設定を確認

3. **実行権限エラー**
   ```
   ❌ Workflow run failed: insufficient permissions
   ```
   - リポジトリの Actions 設定を確認

### デバッグ手順

1. **Actions ログの確認**
   - GitHub Actions の実行ログを詳細に確認
   - エラーメッセージから原因を特定

2. **Secrets の確認**
   ```bash
   # Secrets が設定されているか確認（値は表示されない）
   gh secret list
   ```

3. **手動テスト**
   ```bash
   # ローカルでトークンの有効性を確認
   curl -H "Authorization: Bearer $CLAUDE_ACCESS_TOKEN" \
        https://claude.ai/api/auth/current_user
   ```

## ⚠️ 免責事項

- この機能は実験的なものです
- Anthropic社の利用規約に従って使用してください
- セキュリティリスクを十分に理解した上で利用してください
- 本番環境での使用は自己責任でお願いします

## 📞 サポート

問題が発生した場合：

1. まず[トラブルシューティング](#🔍-トラブルシューティング)を確認
2. GitHub Issues でサポートを求める
3. セキュリティに関する問題は非公開で報告

---

**最終更新**: 2024年12月
**セキュリティレビュー**: 必要に応じて定期更新
