# 🔄 Claude Code Action - 新機能ガイド

## 新機能概要

Claude Code ActionにOAuth認証の自動リフレッシュ機能と新規リポジトリの自動セットアップ機能を追加しました。

### 🔄 OAuth自動リフレッシュ機能

**問題**: Claude Max のOAuth認証トークンが頻繁に期限切れになり、手動で更新する必要がある

**解決**: トークンの有効期限を自動チェックし、期限切れ前に自動でリフレッシュ

#### 機能詳細
- ✅ **自動期限チェック**: 実行前に毎回トークンの有効期限をチェック
- ✅ **自動リフレッシュ**: 期限切れ5分前に自動でトークンを更新
- ✅ **シークレット自動更新**: 新しいトークンを自動でGitHubシークレットに保存
- ✅ **エラーハンドリング**: リフレッシュ失敗時の適切なエラー表示

#### 設定方法
```yaml
- uses: Akira-Papa/claude-code-action@beta
  with:
    use_oauth: "true"
    claude_access_token: ${{ secrets.CLAUDE_ACCESS_TOKEN }}
    claude_refresh_token: ${{ secrets.CLAUDE_REFRESH_TOKEN }}
    claude_expires_at: ${{ secrets.CLAUDE_EXPIRES_AT }}
```

### 🚀 自動セットアップ機能

**問題**: 新規リポジトリでclaude.ymlを毎回手動作成するのが面倒

**解決**: 新規リポジトリで自動的にClaude Code設定を作成

#### 機能詳細
- ✅ **自動ワークフロー生成**: claude.ymlを自動作成
- ✅ **OAuth/API両対応**: 認証方式に応じたテンプレート選択
- ✅ **カスタマイズ対応**: カスタム指示やツール設定
- ✅ **重複チェック**: 既存設定がある場合はスキップ
- ✅ **セットアップ完了通知**: 自動でIssueを作成して設定状況を報告

#### 設定方法
```yaml
- uses: Akira-Papa/claude-code-action@beta
  with:
    auto_setup_claude: "true"
    use_oauth: "true"  # または "false" for API key
    custom_instructions: |
      あなたはこのプロジェクトの開発サポートアシスタントです。
    allowed_tools: "mcp__github__add_pull_request_review_comment"
    model: "claude-3-5-sonnet-20241022"
```

## 使用例

### 新規リポジトリ用自動セットアップワークフロー

`.github/workflows/auto-setup-claude.yml`:

```yaml
name: Auto Setup Claude Code

on:
  create:
  push:
    branches: [ main, master ]

jobs:
  auto-setup:
    runs-on: ubuntu-latest
    if: github.event_name == 'create' || github.event_name == 'push'
    permissions:
      contents: write
      actions: write
      id-token: write
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Check if Claude Code already exists
        id: check-claude
        run: |
          if [ -f .github/workflows/claude.yml ]; then
            echo "claude_exists=true" >> $GITHUB_OUTPUT
          else
            echo "claude_exists=false" >> $GITHUB_OUTPUT
          fi

      - name: Auto Setup Claude Code
        if: steps.check-claude.outputs.claude_exists == 'false'
        uses: Akira-Papa/claude-code-action@beta
        with:
          auto_setup_claude: "true"
          use_oauth: "true"
          claude_access_token: ${{ secrets.CLAUDE_ACCESS_TOKEN }}
          claude_refresh_token: ${{ secrets.CLAUDE_REFRESH_TOKEN }}
          claude_expires_at: ${{ secrets.CLAUDE_EXPIRES_AT }}
```

### 既存リポジトリでのOAuth自動リフレッシュ

既存の`.github/workflows/claude.yml`をそのまま使用。トークンリフレッシュは自動実行されます。

## トラブルシューティング

### OAuth認証エラー
```
❌ Token refresh failed: 401 Unauthorized
```
**解決方法**: 
1. Claude Maxサブスクリプションが有効か確認
2. `~/.claude/.credentials.json`から最新の認証情報を取得
3. GitHubシークレットを更新

### 自動セットアップエラー
```
❌ Auto-setup failed: Failed to create workflow file: 403 Forbidden
```
**解決方法**:
1. GitHub Actionsに`contents: write`権限があるか確認
2. リポジトリ管理者権限があるか確認

### シークレット更新エラー
```
⚠️ Failed to update GitHub secrets automatically
```
**対応**: ログに表示される新しいトークン値を手動でシークレットに設定

## セキュリティ

### トークン保護
- ✅ 暗号化されたGitHubシークレットに保存
- ✅ 必要最小限の権限のみ使用
- ✅ ログに機密情報は出力されない

### 権限管理
- ✅ リポジトリ管理者のみが自動セットアップ実行可能
- ✅ 書き込み権限が明示的に必要
- ✅ 不正アクセス時の自動無効化

## 今後の予定

- [ ] 複数リポジトリ一括セットアップ
- [ ] トークン有効期限の可視化ダッシュボード
- [ ] セットアップテンプレートのカスタマイズ機能
- [ ] 自動テスト実行機能

## サポート

問題や質問がある場合は、GitHubのIssueで報告してください。

---

**この機能により、Claude Code ActionのOAuth認証がより使いやすくなり、新規プロジェクトでの導入も簡単になります！** 
