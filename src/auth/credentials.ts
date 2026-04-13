import * as vscode from 'vscode';
import { SecretsManager } from '../utils/secrets';

/**
 * Manages GitHub & Gemini credential storage for ACM.
 * All secrets are stored in vscode.SecretStorage — never in plaintext settings.
 */
export class CredentialsManager {
  private readonly secrets: SecretsManager;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.secrets = new SecretsManager(context);
  }

  // ─── GitHub Auth ──────────────────────────────────────────────────────────

  /**
   * Returns stored GitHub credentials or prompts the user.
   */
  async ensureGitHubAuth(): Promise<{
    username: string;
    token: string;
  } | null> {
    const config = vscode.workspace.getConfiguration('acm');
    let username = config.get<string>('githubUsername', '');
    let token = await this.secrets.getGithubToken();

    if (!username || !token) {
      const credentials = await this.promptForGitHubCredentials();
      if (!credentials) return null;
      username = credentials.username;
      token = credentials.token;

      await config.update(
        'githubUsername',
        username,
        vscode.ConfigurationTarget.Global,
      );
      await this.secrets.storeGithubToken(token);
    }

    return { username, token };
  }

  private async promptForGitHubCredentials(): Promise<{
    username: string;
    token: string;
  } | null> {
    const username = await vscode.window.showInputBox({
      prompt: 'Enter your GitHub username',
      placeHolder: 'github-username',
      ignoreFocusOut: true,
    });

    if (!username) {
      vscode.window.showErrorMessage('ACM: GitHub username is required.');
      return null;
    }

    const token = await vscode.window.showInputBox({
      prompt: 'Enter your GitHub Personal Access Token (PAT)',
      placeHolder: 'github_pat_XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      password: true,
      ignoreFocusOut: true,
    });

    if (!token) {
      vscode.window.showErrorMessage('ACM: GitHub PAT is required.');
      return null;
    }

    return { username, token };
  }

  // ─── Gemini Auth ──────────────────────────────────────────────────────────

  /**
   * Returns the stored Gemini API key or prompts the user.
   */
  async ensureGeminiKey(): Promise<string | null> {
    let key = await this.secrets.getGeminiApiKey();

    if (!key) {
      key = await vscode.window.showInputBox({
        prompt: 'Enter your Google Gemini API Key (for AI features)',
        placeHolder: 'AIza...',
        password: true,
        ignoreFocusOut: true,
      });

      if (!key) {
        vscode.window.showWarningMessage(
          'ACM: No Gemini API key — AI features will use keyword fallback.',
        );
        return null;
      }

      await this.secrets.storeGeminiApiKey(key);
    }

    return key;
  }

  /**
   * Clears all stored credentials (GitHub PAT + Gemini key).
   */
  async clearCredentials(): Promise<void> {
    await this.secrets.clearAll();
    const config = vscode.workspace.getConfiguration('acm');
    await config.update(
      'githubUsername',
      '',
      vscode.ConfigurationTarget.Global,
    );
    vscode.window.showInformationMessage(
      '🗑️ ACM: All credentials cleared. You will be prompted again on next use.',
    );
  }
}
