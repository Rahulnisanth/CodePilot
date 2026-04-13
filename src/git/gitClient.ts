import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  timestamp: string;
}

/**
 * Async Git command wrappers.
 * Replaces v1's synchronous execSync calls (v1 bug #7).
 */
export class GitClient {
  /**
   * Check if a path is inside a git work tree.
   */
  async isGitRepo(cwd: string): Promise<boolean> {
    try {
      await execAsync('git rev-parse --is-inside-work-tree', { cwd });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the remote URL for a repository (origin).
   */
  async getRemoteUrl(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync('git remote get-url origin', { cwd });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Get the root directory of the git repo.
   */
  async getRepoRoot(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync('git rev-parse --show-toplevel', {
        cwd,
      });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Get the repo name from its remote URL or folder name.
   */
  async getRepoName(cwd: string): Promise<string> {
    const remoteUrl = await this.getRemoteUrl(cwd);
    if (remoteUrl) {
      const match = remoteUrl.match(/\/([^/]+?)(\.git)?$/);
      if (match) return match[1];
    }
    return cwd.split('/').pop() ?? 'unknown';
  }

  /**
   * Get the unstaged diff stat.
   */
  async getDiffStat(cwd: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git diff --stat', { cwd });
      return stdout.trim();
    } catch {
      return '';
    }
  }

  /**
   * Get the staged diff stat.
   */
  async getStagedDiffStat(cwd: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git diff --cached --stat', { cwd });
      return stdout.trim();
    } catch {
      return '';
    }
  }

  /**
   * Get recent commits since a date. Returns structured CommitInfo[].
   */
  async getRecentCommits(cwd: string, since: string): Promise<CommitInfo[]> {
    try {
      const { stdout } = await execAsync(
        `git log --oneline --since="${since}" --pretty=format:"%H|%s|%an|%ad" --date=iso`,
        { cwd },
      );
      if (!stdout.trim()) return [];

      return stdout
        .trim()
        .split('\n')
        .map((line) => {
          const [hash, message, author, timestamp] = line.split('|');
          return {
            hash: hash?.trim(),
            message: message?.trim(),
            author: author?.trim(),
            timestamp: timestamp?.trim(),
          };
        })
        .filter((c) => c.hash && c.message);
    } catch {
      return [];
    }
  }

  /**
   * Get the git status in porcelain format.
   */
  async getStatus(cwd: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd });
      return stdout.trim();
    } catch {
      return '';
    }
  }

  /**
   * Get number of changed lines (added + removed) from status.
   */
  async getChangedLineCount(cwd: string): Promise<number> {
    try {
      const { stdout } = await execAsync(
        'git diff --numstat && git diff --cached --numstat',
        { cwd },
      );
      let total = 0;
      stdout
        .trim()
        .split('\n')
        .forEach((line) => {
          const parts = line.split('\t');
          const added = parseInt(parts[0], 10);
          const removed = parseInt(parts[1], 10);
          if (!isNaN(added)) total += added;
          if (!isNaN(removed)) total += removed;
        });
      return total;
    } catch {
      return 0;
    }
  }

  /**
   * Run git add + commit + push for the project repo (async version of v1).
   */
  async commitAndPush(
    cwd: string,
    files: string[],
    message: string,
  ): Promise<void> {
    const fileArgs = files.map((f) => `"${f}"`).join(' ');
    await execAsync(`git add ${fileArgs}`, { cwd });
    await execAsync(`git commit -m "${message}"`, { cwd });
    await execAsync('git push', { cwd });
  }

  /**
   * Get the timestamp of the last commit.
   */
  async getLastCommitTime(cwd: string): Promise<Date | null> {
    try {
      const { stdout } = await execAsync(
        'git log -1 --pretty=format:"%ad" --date=iso',
        { cwd },
      );
      const ts = stdout.trim();
      return ts ? new Date(ts) : null;
    } catch {
      return null;
    }
  }
}
