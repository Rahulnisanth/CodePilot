import { GoogleGenerativeAI } from '@google/generative-ai';
import { CommitRecord, WorkType, WorkUnit } from '../types';
import { generateUUID } from '../utils/uuid';
import { buildGrouperPrompt } from './promptTemplates';

interface GroupResult {
  name: string;
  type: WorkType;
  commitHashes: string[];
}

/**
 * Smart Commit Grouper — clusters commits into logical WorkUnits.
 * Uses Gemini for naming; falls back to simple time-window grouping.
 */
export class CommitGrouper {
  private readonly WINDOW_MS = 4 * 60 * 60 * 1000; // 4-hour window

  constructor(private readonly geminiApiKey: string | null) {}

  /**
   * Groups commits into WorkUnits.
   */
  async group(commits: CommitRecord[]): Promise<WorkUnit[]> {
    if (commits.length === 0) return [];

    let groups: GroupResult[];

    if (this.geminiApiKey) {
      groups = await this.groupWithGemini(commits);
    } else {
      groups = this.groupByTimeWindow(commits);
    }

    return groups.map((g) => {
      const matchedCommits = commits.filter((c) =>
        g.commitHashes.includes(c.hash),
      );
      const timestamps = matchedCommits
        .map((c) => new Date(c.timestamp).getTime())
        .sort();

      return {
        id: generateUUID(),
        name: g.name,
        type: g.type,
        commits: g.commitHashes,
        repos: [...new Set(matchedCommits.map((c) => c.repoName))],
        startTime:
          timestamps.length > 0 ? new Date(timestamps[0]).toISOString() : '',
        endTime:
          timestamps.length > 0
            ? new Date(timestamps[timestamps.length - 1]).toISOString()
            : '',
        totalLinesChanged: matchedCommits.reduce(
          (sum, c) => sum + c.linesAdded + c.linesRemoved,
          0,
        ),
      };
    });
  }

  private async groupWithGemini(
    commits: CommitRecord[],
  ): Promise<GroupResult[]> {
    try {
      const genAI = new GoogleGenerativeAI(this.geminiApiKey!);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

      const prompt = buildGrouperPrompt(
        commits.map((c) => ({
          hash: c.hash,
          message: c.message,
          timestamp: c.timestamp,
          diffStat: c.diffStat,
        })),
      );

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();

      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array in response');

      const parsed = JSON.parse(jsonMatch[0]) as GroupResult[];
      return parsed.filter(
        (g) =>
          g.name && Array.isArray(g.commitHashes) && g.commitHashes.length > 0,
      );
    } catch {
      return this.groupByTimeWindow(commits);
    }
  }

  /**
   * Fallback: group commits by 4-hour time windows.
   */
  private groupByTimeWindow(commits: CommitRecord[]): GroupResult[] {
    if (commits.length === 0) return [];

    const sorted = [...commits].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const groups: GroupResult[] = [];
    let currentGroup: CommitRecord[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1].timestamp).getTime();
      const curr = new Date(sorted[i].timestamp).getTime();

      if (curr - prev <= this.WINDOW_MS) {
        currentGroup.push(sorted[i]);
      } else {
        groups.push(this.createGroup(currentGroup));
        currentGroup = [sorted[i]];
      }
    }
    groups.push(this.createGroup(currentGroup));

    return groups;
  }

  private createGroup(commits: CommitRecord[]): GroupResult {
    // Use the most common type among commits as the group type
    const typeCounts: Record<string, number> = {};
    commits.forEach((c) => {
      const t = c.classification?.type ?? 'unknown';
      typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    });

    const dominantType = (Object.entries(typeCounts).sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0] ?? 'unknown') as WorkType;

    // Generate a simple name from commit messages
    const name =
      commits.length === 1
        ? commits[0].message.slice(0, 60)
        : `${commits[0].message.slice(0, 40)} (+${commits.length - 1} more)`;

    return {
      name,
      type: dominantType,
      commitHashes: commits.map((c) => c.hash),
    };
  }

  updateApiKey(key: string | null): void {
    (this as unknown as { geminiApiKey: string | null }).geminiApiKey = key;
  }
}
