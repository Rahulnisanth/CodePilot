import * as vscode from 'vscode';
import { SecretsManager } from '../utils/secrets';

/**
 * Manages GitHub & Gemini credential storage for CodeBrainPro.
 * All secrets are stored in vscode.SecretStorage — never in plaintext settings.
 */
export class CredentialsManager {
  private readonly secrets: SecretsManager;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.secrets = new SecretsManager(context);
  }

  /**
   * Returns stored GitHub credentials or prompts the user.
   */
  async ensureGitHubAuth(): Promise<{
    username: string;
    token: string;
  } | null> {
    const config = vscode.workspace.getConfiguration('codeBrainPro');
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
      vscode.window.showErrorMessage(
        'CodeBrainPro: GitHub username is required.',
      );
      return null;
    }

    const token = await vscode.window.showInputBox({
      prompt:
        'Enter your GitHub Personal Access Token (Classic) with all repo scopes enabled',
      placeHolder: 'ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      password: true,
      ignoreFocusOut: true,
    });

    if (!token) {
      vscode.window.showErrorMessage(
        'CodeBrainPro: GitHub Personal Access Token (Classic) is required.',
      );
      return null;
    }

    return { username, token };
  }

  /**
   * Returns the stored Gemini API key.
   * Does NOT prompt — call ensureGeminiKey() for first-run or setGeminiKey() for
   * explicit reconfiguration.
   */
  async getGeminiKey(): Promise<string | null> {
    return (await this.secrets.getGeminiApiKey()) ?? null;
  }

  /**
   * Checks for a stored Gemini key and prompts the user if one is not set.
   * Shows a quick-pick with a "Get a key" shortcut before the input box.
   * Returns the key string, or null if the user cancels.
   */
  async ensureGeminiKey(): Promise<string | null> {
    const existing = (await this.secrets.getGeminiApiKey()) ?? null;
    if (existing) return existing;

    return this.promptForGeminiKey(false);
  }

  /**
   * Explicitly prompts the user to enter/replace their Gemini API key.
   * Called by the `codeBrainProsetGeminiKey` command.
   */
  async setGeminiKey(): Promise<string | null> {
    return this.promptForGeminiKey(true);
  }

  /**
   * Prompts the user to enter/replace their Gemini API key.
   * Called by the `codeBrainProsetGeminiKey` command.
   */
  private async promptForGeminiKey(isUpdate: boolean): Promise<string | null> {
    // Step 1 — inform & offer shortcut to get a key
    const action = await vscode.window.showInformationMessage(
      isUpdate
        ? 'CodeBrainPro: Update your Google Gemini API key. Get one free at aistudio.google.com'
        : 'CodeBrainPro needs a Gemini API key to power AI classification and report narratives. Get one free at aistudio.google.com',
      { modal: false },
      'Enter Key',
      'Get a Key',
      'Skip (use keyword fallback)',
    );

    if (action === 'Get a Key') {
      vscode.env.openExternal(
        vscode.Uri.parse('https://aistudio.google.com/apikey'),
      );
      // Ask again after they've had a chance to grab the key
      const retry = await vscode.window.showInformationMessage(
        'Once you have your key, click Enter Key to continue.',
        { modal: false },
        'Enter Key',
        'Cancel',
      );
      if (retry !== 'Enter Key') return null;
    } else if (action === 'Skip (use keyword fallback)' || !action) {
      if (!isUpdate) {
        vscode.window.showInformationMessage(
          'CodeBrainPro: Running without AI — commit classification will use keyword matching.',
        );
      }
      return null;
    }

    // Step 2 — input box for the key
    const key = await vscode.window.showInputBox({
      title: 'Google Gemini API Key',
      prompt: 'Paste your Gemini API key (starts with "AIza...")',
      placeHolder: 'AIzaSy...',
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => {
        if (!v.trim()) return 'API key cannot be empty';
        if (!v.startsWith('AIza'))
          return 'Gemini API keys usually start with "AIza"';
        return null;
      },
    });

    if (!key) return null;

    await this.secrets.storeGeminiApiKey(key.trim());
    vscode.window.showInformationMessage(
      'CodeBrainPro: Gemini API key saved. AI features are now active.',
    );
    return key.trim();
  }

  /**
   * Clears all stored credentials (GitHub PAT (Classic) + Gemini key).
   */
  async clearCredentials(): Promise<void> {
    await this.secrets.clearAll();
    const config = vscode.workspace.getConfiguration('codeBrainPro');
    await config.update(
      'githubUsername',
      '',
      vscode.ConfigurationTarget.Global,
    );
    vscode.window.showInformationMessage(
      '🗑️ CodeBrainPro: All credentials cleared. You will be prompted again on next use.',
    );
  }
}
