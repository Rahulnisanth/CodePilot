import * as vscode from 'vscode';

const KEY_GITHUB_TOKEN = 'acm.githubToken';
const KEY_GEMINI_API_KEY = 'acm.geminiApiKey';

/**
 * Abstraction over vscode.SecretStorage for ACM secrets.
 */
export class SecretsManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async getGithubToken(): Promise<string | undefined> {
    return this.context.secrets.get(KEY_GITHUB_TOKEN);
  }

  async storeGithubToken(token: string): Promise<void> {
    await this.context.secrets.store(KEY_GITHUB_TOKEN, token);
  }

  async deleteGithubToken(): Promise<void> {
    await this.context.secrets.delete(KEY_GITHUB_TOKEN);
  }

  async getGeminiApiKey(): Promise<string | undefined> {
    return this.context.secrets.get(KEY_GEMINI_API_KEY);
  }

  async storeGeminiApiKey(key: string): Promise<void> {
    await this.context.secrets.store(KEY_GEMINI_API_KEY, key);
  }

  async deleteGeminiApiKey(): Promise<void> {
    await this.context.secrets.delete(KEY_GEMINI_API_KEY);
  }

  async clearAll(): Promise<void> {
    await this.deleteGithubToken();
    await this.deleteGeminiApiKey();
  }
}
