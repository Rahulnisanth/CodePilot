import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { CredentialsManager } from '../auth/credentials';
import { toDateString, toYearMonth } from '../utils/dateUtils';
import { readJson, getLogsDir } from '../utils/storage';
import { ActivityEvent } from '../types';

const GLOBAL_REPO_NAME = 'code-brain-pro-logs';

/** GitHub Contents API hard limit for a single file PUT (bytes). */
const GITHUB_API_MAX_BYTES = 1_000_000; // ~1 MB

/** Warn in the console when a log file exceeds this threshold before reading. */
const LOG_FILE_WARN_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * GitHub Sync Engine — pushes structured activity logs and reports to a
 * centralized 'code-brain-pro-logs' GitHub repository.
 * Auto-initializes the repo if it doesn't exist (auto_init: true).
 */
export class GitHubSync {
  private onSyncStart: (() => void) | null = null;
  private onSyncEnd: (() => void) | null = null;
  private syncIntervalHandle: NodeJS.Timeout | null = null;

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
    // Clear existing interval if it exists to prevent duplicates
    if (this.syncIntervalHandle) {
      clearInterval(this.syncIntervalHandle);
    }

    const config = vscode.workspace.getConfiguration('codeBrainPro');
    if (!config.get<boolean>('syncEnabled', false)) return;

    const intervalHours = config.get<number>('syncFrequencyHours', 24);
    const intervalMs = intervalHours * 60 * 60 * 1000;

    this.syncIntervalHandle = setInterval(() => this.syncNow(), intervalMs);

    this.context.subscriptions.push({
      dispose: () => {
        if (this.syncIntervalHandle) {
          clearInterval(this.syncIntervalHandle);
        }
      },
    });
  }

  /**
   * Manually trigger a sync. Called by `codeBrainProsyncNow` command.
   */
  async syncNow(): Promise<void> {
    const config = vscode.workspace.getConfiguration('codeBrainPro');
    if (!config.get<boolean>('syncEnabled', true)) {
      vscode.window.showInformationMessage(
        'CodeBrainPro: GitHub sync is disabled. Enable `codeBrainPro.syncEnabled` to sync.',
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

      vscode.window.showInformationMessage('CodeBrainPro: Synced to GitHub.');
    } catch (error) {
      console.error(error);
      vscode.window.showErrorMessage(
        `CodeBrainPro Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      this.onSyncEnd?.();
    }
  }

  /**
   * Creates the code-brain-pro-logs GitHub repo if it doesn't exist.
   */
  private async ensureGlobalRepoExists(
    username: string,
    token: string,
  ): Promise<void> {
    const headers = this.getHeaders(token);
    const apiUrl = `https://api.github.com/repos/${username}/${GLOBAL_REPO_NAME}`;

    try {
      await axios.get(apiUrl, { headers });
    } catch (err: any) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        await axios.post(
          'https://api.github.com/user/repos',
          {
            name: GLOBAL_REPO_NAME,
            description: 'CodeBrainPro — Developer Activity Logger',
            private: false,
            auto_init: true,
          },
          { headers },
        );
        vscode.window.showInformationMessage(
          `CodeBrainPro: Created global repository '${GLOBAL_REPO_NAME}'.`,
        );
      } else {
        throw err;
      }
    }
  }

  /**
   * Push today's activity log as JSON to the global repo.
   * New structure: logs/YYYY/MM/DD.json
   *
   * Guards:
   *  - Skips files that exceed LOG_FILE_WARN_BYTES on disk (stale/corrupt).
   *  - Trims the events array so the final payload stays within
   *    GITHUB_API_MAX_BYTES (GitHub Contents API hard limit ~1 MB).
   */
  private async pushDailyLog(username: string, token: string): Promise<void> {
    const today = new Date();
    const dateStr = toDateString(today);
    const yearMonth = toYearMonth(today);
    const day = String(today.getDate()).padStart(2, '0');

    // GitHub API requires forward slashes regardless of OS
    const filePath = `logs/${yearMonth}/${day}.json`;

    // Guard 1: Check raw file size before reading
    const logsDir = getLogsDir();
    const logFilePath = path.join(logsDir, `${dateStr}.json`);

    if (!fs.existsSync(logFilePath)) {
      return; // Nothing to sync
    }

    const { size } = fs.statSync(logFilePath);
    if (size > LOG_FILE_WARN_BYTES) {
      console.warn(`[CodeBrainPro] Log file large: ${size} bytes`);
    }

    // Read real activity events from ~/.codeBrainPro/logs/YYYY-MM-DD.json
    const allEvents = readJson<ActivityEvent[]>(logFilePath, []);

    if (allEvents.length === 0) {
      vscode.window.showInformationMessage(
        'CodeBrainPro Sync: No activity logged today yet — nothing to push.',
      );
      return;
    }

    // Guard 2: Trim events to fit within GitHub API payload limit
    const events = this.fitEventsToLimit(allEvents, dateStr);
    const truncated = events.length < allEvents.length;

    const content = JSON.stringify(
      {
        date: dateStr,
        syncedAt: new Date().toISOString(),
        eventCount: allEvents.length,
        syncedEventCount: events.length,
        truncated,
        events,
      },
      null,
      2,
    );

    const encodedContent = Buffer.from(content, 'utf-8').toString('base64');
    const headers = this.getHeaders(token);
    const apiUrl = `https://api.github.com/repos/${username}/${GLOBAL_REPO_NAME}/contents/${filePath}`;

    try {
      let sha: string | undefined;
      try {
        const existing = await axios.get(apiUrl, { headers });
        sha = existing.data.sha;
      } catch {
        /* File is new */
      }

      await axios.put(
        apiUrl,
        {
          message: `CodeBrainPro: Activity log for ${dateStr}`,
          content: encodedContent,
          ...(sha ? { sha } : {}),
        },
        { headers },
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Returns the most-recent subset of `events` whose JSON payload fits within
   * GITHUB_API_MAX_BYTES. Always includes at least one event.
   */
  private fitEventsToLimit(
    events: ActivityEvent[],
    dateStr: string,
  ): ActivityEvent[] {
    const WRAPPER_OVERHEAD_BYTES = 1024;
    const budget = GITHUB_API_MAX_BYTES - WRAPPER_OVERHEAD_BYTES;

    const reversed = [...events].reverse();
    const selected: ActivityEvent[] = [];
    let running = 2;

    for (const event of reversed) {
      const chunk = JSON.stringify(event);
      const chunkBytes = Buffer.byteLength(chunk, 'utf-8') + 2;
      if (running + chunkBytes > budget && selected.length > 0) break;
      selected.unshift(event);
      running += chunkBytes;
    }
    return selected;
  }

  private getHeaders(token: string): Record<string, string> {
    return {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
    };
  }
}
