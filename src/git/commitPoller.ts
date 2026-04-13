import * as vscode from 'vscode';
import { GitClient, CommitInfo } from './gitClient';
import { RepoManager } from '../repos/repoManager';
import { CommitRecord } from '../types';
import { toISO } from '../utils/dateUtils';
import { writeJson, readJson, getAcmDir } from '../utils/storage';
import * as path from 'path';

type CommitListener = (commit: CommitRecord) => void;

/**
 * Polls all tracked repos every 5 minutes for new commits.
 * Stores handle in context.subscriptions (fix v1 bug #3).
 */
export class CommitPoller {
  private readonly POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private lastSeenCommits: Map<string, Set<string>> = new Map();
  private listeners: CommitListener[] = [];
  private readonly seenCommitsFile: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly gitClient: GitClient,
    private readonly repoManager: RepoManager,
  ) {
    this.seenCommitsFile = path.join(getAcmDir(), 'seen-commits.json');
    // Load previously seen commits to persist across restarts
    const stored = readJson<Record<string, string[]>>(this.seenCommitsFile, {});
    Object.entries(stored).forEach(([repo, hashes]) => {
      this.lastSeenCommits.set(repo, new Set(hashes));
    });
  }

  /**
   * Start polling and register the interval as a disposable.
   */
  start(): void {
    const handle = setInterval(() => {
      this.poll();
    }, this.POLL_INTERVAL_MS);

    // Fix v1 bug #3: register interval for cleanup
    this.context.subscriptions.push({
      dispose: () => clearInterval(handle),
    });

    // Run immediately on start
    this.poll();
  }

  /**
   * Add a listener for new commit events.
   */
  onNewCommit(listener: CommitListener): void {
    this.listeners.push(listener);
  }

  private async poll(): Promise<void> {
    const repos = this.repoManager.getAll();
    const since = '7 days ago';

    for (const repo of repos) {
      try {
        const commits: CommitInfo[] = await this.gitClient.getRecentCommits(
          repo.repoPath,
          since,
        );

        const seen = this.lastSeenCommits.get(repo.repoPath) ?? new Set();
        const newCommits = commits.filter((c) => !seen.has(c.hash));

        for (const commit of newCommits) {
          seen.add(commit.hash);
          const diffStat = await this.gitClient.getDiffStat(repo.repoPath);
          const record: CommitRecord = {
            hash: commit.hash,
            message: commit.message,
            author: commit.author,
            timestamp: commit.timestamp,
            repoName: repo.repoName,
            repoPath: repo.repoPath,
            filesChanged: [],
            diffStat,
            linesAdded: 0,
            linesRemoved: 0,
          };
          this.listeners.forEach((l) => l(record));
        }

        this.lastSeenCommits.set(repo.repoPath, seen);
      } catch {
        // Silently ignore per-repo errors
      }
    }

    // Persist seen commits
    const toStore: Record<string, string[]> = {};
    this.lastSeenCommits.forEach((set, repoPath) => {
      toStore[repoPath] = Array.from(set);
    });
    writeJson(this.seenCommitsFile, toStore);
  }
}
