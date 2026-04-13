import * as vscode from 'vscode';
import axios from 'axios';
import { CredentialsManager } from '../auth/credentials';
import { toDateString, toYearMonth } from '../utils/dateUtils';

const GLOBAL_REPO_NAME = 'Activity-Logger';

/**
 * GitHub Sync Engine — pushes structured activity logs and reports to a
 * centralized 'Activity-Logger' GitHub repository.
 * Auto-initializes the repo if it doesn't exist (auto_init: true).
 */
export class GitHubSync {
  private onSyncStart: (() => void) | null = null;
  private onSyncEnd: (() => void) | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly credentialsManager: CredentialsManager,
  ) {}

  /**
   * Set callbacks for sync start/end (for status bar spinner).
   */
  setSyncCallbacks(onStart: () => void, onEnd: () => void): void {
    this.onSyncStart = onStart;
    this.onSyncEnd = onEnd;
  }

  /**
   * Start the auto-sync interval (if enabled in settings).
   */
  startAutoSync(): void {
    const config = vscode.workspace.getConfiguration('acm');
    if (!config.get<boolean>('syncEnabled', false)) return;

    const intervalHours = config.get<number>('syncFrequencyHours', 24);
    const intervalMs = intervalHours * 60 * 60 * 1000;

    const handle = setInterval(() => this.syncNow(), intervalMs);

    this.context.subscriptions.push({
      dispose: () => clearInterval(handle),
    });
  }

  /**
   * Manually trigger a sync. Called by `acm.syncNow` command.
   */
  async syncNow(): Promise<void> {
    const config = vscode.workspace.getConfiguration('acm');
    if (!config.get<boolean>('syncEnabled', true)) {
      vscode.window.showInformationMessage(
        'ACM: GitHub sync is disabled. Enable `acm.syncEnabled` to sync.',
      );
      return;
    }

    this.onSyncStart?.();

    try {
      const credentials = await this.credentialsManager.ensureGitHubAuth();
      if (!credentials) {
        this.onSyncEnd?.();
        return;
      }

      const { username, token } = credentials;
      await this.ensureGlobalRepoExists(username, token);
      await this.pushDailyLog(username, token);

      vscode.window.showInformationMessage(
        '✅ ACM: Synced to GitHub Activity-Logger.',
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `❌ ACM Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      this.onSyncEnd?.();
    }
  }

  /**
   * Creates the Activity-Logger GitHub repo if it doesn't exist.
   * Fix v1 bug #12: auto_init: true.
   */
  private async ensureGlobalRepoExists(
    username: string,
    token: string,
  ): Promise<void> {
    const headers = this.getHeaders(token);
    const apiUrl = `https://api.github.com/repos/${username}/${GLOBAL_REPO_NAME}`;

    try {
      await axios.get(apiUrl, { headers });
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        await axios.post(
          'https://api.github.com/user/repos',
          {
            name: GLOBAL_REPO_NAME,
            description: 'ACM — Developer Activity Logger',
            private: false,
            auto_init: true,
          },
          { headers },
        );
        vscode.window.showInformationMessage(
          `✅ ACM: Created global repository '${GLOBAL_REPO_NAME}'.`,
        );
      } else {
        throw err;
      }
    }
  }

  /**
   * Push today's activity log as JSON to the global repo.
   * New structure: logs/YYYY/MM/DD.json
   */
  private async pushDailyLog(username: string, token: string): Promise<void> {
    const today = new Date();
    const dateStr = toDateString(today);
    const yearMonth = toYearMonth(today);
    const day = String(today.getDate()).padStart(2, '0');

    const filePath = `logs/${yearMonth}/${day}.json`;

    // Placeholder log content — in production this would read from ~/.acm/logs/
    const content = JSON.stringify(
      { date: dateStr, syncedAt: new Date().toISOString() },
      null,
      2,
    );
    const encodedContent = Buffer.from(content).toString('base64');

    const headers = this.getHeaders(token);
    const apiUrl = `https://api.github.com/repos/${username}/${GLOBAL_REPO_NAME}/contents/${filePath}`;

    try {
      // Get existing SHA if file exists
      let sha: string | undefined;
      try {
        const existing = await axios.get(apiUrl, { headers });
        sha = existing.data.sha;
      } catch {
        // File doesn't exist yet
      }

      await axios.put(
        apiUrl,
        {
          message: `ACM: Activity log for ${dateStr}`,
          content: encodedContent,
          ...(sha ? { sha } : {}),
        },
        { headers },
      );
    } catch (error) {
      console.error('ACM sync push error:', error);
      throw error;
    }
  }

  private getHeaders(token: string): Record<string, string> {
    return {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
    };
  }
}
