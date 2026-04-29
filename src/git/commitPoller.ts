import * as vscode from 'vscode';
import { GitClient } from './gitClient';
import { RepoManager } from '../repos/repoManager';
import { CommitInfo, CommitRecord } from '../types';
import { writeJson, readJson, getCodeBrainProDir } from '../utils/storage';
import * as path from 'path';

type CommitListener = (commit: CommitRecord) => void;

/**
 * Watches all tracked repos for new commits via .git file system events.
 * Triggers a poll only when the user actually commits.
 */
export class CommitPoller {
  private lastSeenCommits = new Map<string, Set<string>>();
  private listeners: CommitListener[] = [];
  private readonly seenCommitsFile: string;
  private pollTimeout: NodeJS.Timeout | null = null;
  private isPolling = false;
  private pollRequested = false;
  private repoWatchers = new Map<string, vscode.FileSystemWatcher[]>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly gitClient: GitClient,
    private readonly repoManager: RepoManager,
  ) {
    this.seenCommitsFile = path.join(getCodeBrainProDir(), 'seen-commits.json');
    const stored = readJson<Record<string, string[]>>(this.seenCommitsFile, {});
    Object.entries(stored).forEach(([repo, hashes]) => {
      this.lastSeenCommits.set(repo, new Set(hashes));
    });
  }

  start(): void {
    this.context.subscriptions.push({
      dispose: () => this.disposeWatchers(),
    });

    // Set up watchers immediately so commits are caught from the start
    this.setupWatchers();
  }

  private disposeWatchers(): void {
    for (const watchers of this.repoWatchers.values()) {
      watchers.forEach((w) => w.dispose());
    }
    this.repoWatchers.clear();
  }

  private setupWatchers(): void {
    const repos = this.repoManager.getAll();
    for (const repo of repos) {
      if (this.repoWatchers.has(repo.repoPath)) {
        continue;
      }

      try {
        const watchers: vscode.FileSystemWatcher[] = [];

        // vscode.Uri.file() is required here — passing a raw string path is
        // not a valid URI and causes the watcher to silently never fire.
        const repoUri = vscode.Uri.file(repo.repoPath);

        const headWatcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(repoUri, '.git/logs/HEAD'),
        );
        headWatcher.onDidChange(() => this.triggerPoll());
        headWatcher.onDidCreate(() => this.triggerPoll());
        watchers.push(headWatcher);

        const refsWatcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(repoUri, '.git/refs/heads/**'),
        );
        refsWatcher.onDidChange(() => this.triggerPoll());
        refsWatcher.onDidCreate(() => this.triggerPoll());
        watchers.push(refsWatcher);

        this.repoWatchers.set(repo.repoPath, watchers);
        watchers.forEach((w) => this.context.subscriptions.push(w));
      } catch {
        // Ignore errors for a specific repo
      }
    }
  }

  private triggerPoll(): void {
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
    }
    // Small debounce so rapid git operations don't cause multiple polls
    this.pollTimeout = setTimeout(() => {
      void this.executePoll();
    }, 2000);
  }

  private async executePoll(): Promise<void> {
    if (this.isPolling) {
      this.pollRequested = true;
      return;
    }
    this.isPolling = true;
    this.pollRequested = false;

    try {
      // Pick up any newly added repos before polling
      this.setupWatchers();
      await this.poll();
    } finally {
      this.isPolling = false;
      if (this.pollRequested) {
        this.triggerPoll();
      }
    }
  }

  onNewCommit(listener: CommitListener): void {
    this.listeners.push(listener);
  }

  /**
   * Poll all repos for new commits.
   * Also called externally after a GitHub sync.
   */
  async poll(): Promise<void> {
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
          const { linesAdded, linesRemoved } =
            await this.gitClient.getCommitLineChanges(
              repo.repoPath,
              commit.hash,
            );
          const record: CommitRecord = {
            hash: commit.hash,
            message: commit.message,
            author: commit.author,
            timestamp: commit.timestamp,
            repoName: repo.repoName,
            repoPath: repo.repoPath,
            filesChanged: [],
            diffStat,
            linesAdded,
            linesRemoved,
          };
          this.listeners.forEach((l) => l(record));
        }

        this.lastSeenCommits.set(repo.repoPath, seen);
      } catch {
        // Silently ignore per-repo errors
      }
    }

    const toStore: Record<string, string[]> = {};
    this.lastSeenCommits.forEach((set, repoPath) => {
      toStore[repoPath] = Array.from(set);
    });
    writeJson(this.seenCommitsFile, toStore);
  }
}
