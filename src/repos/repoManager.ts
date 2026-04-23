import * as vscode from 'vscode';
import * as path from 'path';
import { GitClient } from '../git/gitClient';

export interface RepoMetadata {
  repoName: string;
  repoPath: string;
  remoteUrl: string | null;
  lastSyncedAt: string | null;
}

/**
 * Multi-repository manager.
 */
export class RepoManager {
  private repos = new Map<string, RepoMetadata>();
  private readonly gitClient: GitClient;

  constructor() {
    this.gitClient = new GitClient();
  }

  /**
   * Scan all VS Code workspace folders + additional configured paths.
   * Returns detected git repositories.
   */
  async detectRepos(): Promise<RepoMetadata[]> {
    const paths: string[] = [];

    // All open workspace folders (fixes v1 bug #2)
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    workspaceFolders.forEach((f) => paths.push(f.uri.fsPath));

    // User-configured additional repo paths
    const config = vscode.workspace.getConfiguration('codeBrainPro');
    const additionalPaths = config.get<string[]>('additionalRepoPaths', []);
    additionalPaths.forEach((p) => paths.push(p));

    const results: RepoMetadata[] = [];

    for (const repoPath of paths) {
      const isGit = await this.gitClient.isGitRepo(repoPath);
      if (!isGit) continue;

      const remoteUrl = await this.gitClient.getRemoteUrl(repoPath);
      const repoName = await this.gitClient.getRepoName(repoPath);

      const existing = this.repos.get(repoPath);
      const metadata: RepoMetadata = {
        repoName,
        repoPath,
        remoteUrl,
        lastSyncedAt: existing?.lastSyncedAt ?? null,
      };

      this.repos.set(repoPath, metadata);
      results.push(metadata);
    }

    return results;
  }

  /**
   * Get all currently tracked repos.
   */
  getAll(): RepoMetadata[] {
    return Array.from(this.repos.values());
  }

  /**
   * Get a repo by its path.
   */
  getByPath(repoPath: string): RepoMetadata | undefined {
    return this.repos.get(repoPath);
  }

  /**
   * Update the lastSyncedAt for a repo.
   */
  updateLastSynced(repoPath: string, timestamp: string): void {
    const existing = this.repos.get(repoPath);
    if (existing) {
      this.repos.set(repoPath, { ...existing, lastSyncedAt: timestamp });
    }
  }

  /**
   * Infer the repo root and name for a given file path.
   */
  getRepoForFile(filePath: string): RepoMetadata | undefined {
    let best: RepoMetadata | undefined;
    let bestLen = 0;
    this.repos.forEach((meta) => {
      if (
        filePath.startsWith(meta.repoPath) &&
        meta.repoPath.length > bestLen
      ) {
        best = meta;
        bestLen = meta.repoPath.length;
      }
    });
    return best;
  }

  /**
   * Returns the relative path of a file within its repo.
   */
  getRelativePath(filePath: string, repoPath: string): string {
    return path.relative(repoPath, filePath);
  }
}
