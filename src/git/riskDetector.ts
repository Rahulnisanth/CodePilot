import * as vscode from 'vscode';
import { GitClient } from './gitClient';
import { RepoManager } from '../repos/repoManager';
import { RiskEvent } from '../types';
import { toISO } from '../utils/dateUtils';
import { appendToJsonArray, getAcmDir } from '../utils/storage';
import * as path from 'path';

/**
 * Monitors repos for uncommitted change risk every 10 minutes.
 * Shows VS Code warning notifications when risk thresholds are exceeded.
 */
export class RiskDetector {
  private readonly POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
  private riskCounts: Map<string, number> = new Map(); // repoPath -> risk count
  private onRiskUpdate: ((count: number) => void) | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly gitClient: GitClient,
    private readonly repoManager: RepoManager,
  ) {}

  /**
   * Start the risk polling interval.
   */
  start(onRiskUpdate?: (totalRisks: number) => void): void {
    if (onRiskUpdate) this.onRiskUpdate = onRiskUpdate;

    const handle = setInterval(() => {
      this.checkRisks();
    }, this.POLL_INTERVAL_MS);

    // Fix v1 bug #3
    this.context.subscriptions.push({
      dispose: () => clearInterval(handle),
    });
  }

  /**
   * Get the total number of current active risks.
   */
  getTotalRiskCount(): number {
    let total = 0;
    this.riskCounts.forEach((v) => (total += v));
    return total;
  }

  private async checkRisks(): Promise<void> {
    const config = vscode.workspace.getConfiguration('acm');
    const riskThresholdLines = config.get<number>('riskThresholdLines', 50);
    const riskThresholdMinutes = config.get<number>('riskThresholdMinutes', 60);

    const repos = this.repoManager.getAll();
    let totalRisks = 0;

    for (const repo of repos) {
      try {
        const status = await this.gitClient.getStatus(repo.repoPath);
        const linesChanged = await this.gitClient.getChangedLineCount(
          repo.repoPath,
        );
        const lastCommitTime = await this.gitClient.getLastCommitTime(
          repo.repoPath,
        );
        const hasDeletedFiles = status
          .split('\n')
          .some((l) => l.startsWith('D ') || l.startsWith(' D'));

        const minutesSinceLastCommit = lastCommitTime
          ? Math.floor((Date.now() - lastCommitTime.getTime()) / 60000)
          : 9999;

        const isAtRisk =
          linesChanged >= riskThresholdLines &&
          minutesSinceLastCommit >= riskThresholdMinutes;

        if (isAtRisk || hasDeletedFiles) {
          totalRisks++;
          this.riskCounts.set(repo.repoPath, 1);

          const riskEvent: RiskEvent = {
            timestamp: toISO(),
            repoName: repo.repoName,
            repoPath: repo.repoPath,
            linesChanged,
            minutesSinceLastCommit,
            hasDeletedFiles,
          };

          // Log the risk event
          const risksFile = path.join(getAcmDir(), 'risks.json');
          appendToJsonArray<RiskEvent>(risksFile, riskEvent);

          // Show VS Code warning
          const msg = `⚠️ ACM Risk: ${repo.repoName} has ${linesChanged} uncommitted lines for ${minutesSinceLastCommit}m`;
          vscode.window
            .showWarningMessage(msg, 'Open Source Control')
            .then((choice) => {
              if (choice === 'Open Source Control') {
                vscode.commands.executeCommand('workbench.view.scm');
              }
            });
        } else {
          this.riskCounts.set(repo.repoPath, 0);
        }
      } catch {
        // Ignore per-repo errors
      }
    }

    this.onRiskUpdate?.(totalRisks);
  }
}
