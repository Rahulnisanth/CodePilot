import {
  ActivityEvent,
  CommitRecord,
  WorkSession,
  WorkUnit,
  RiskEvent,
} from '../types';
import {
  formatDuration,
  formatDate,
  toDateString,
  startOfDay,
  startOfWeek,
} from '../utils/dateUtils';
import { getLogsDir, getAcmDir, readJson } from '../utils/storage';
import * as path from 'path';
import * as fs from 'fs';

export interface ReportData {
  period: string;
  startDate: Date;
  endDate: Date;
  totalActiveMinutes: number;
  byDay: Record<string, number>; // date string -> minutes
  workUnits: WorkUnit[];
  commits: CommitRecord[];
  topFiles: Array<{ filePath: string; editCount: number }>;
  repos: Record<string, { minutes: number; commits: number }>;
  linesAdded: number;
  linesRemoved: number;
  risks: RiskEvent[];
  narrative?: string;
}

/**
 * Base report builder — assembles ReportData from stored logs.
 */
export class ReportBuilder {
  /**
   * Load activity events for a given date range.
   */
  loadEvents(startDate: Date, endDate: Date): ActivityEvent[] {
    const logsDir = getLogsDir();
    if (!fs.existsSync(logsDir)) return [];

    const events: ActivityEvent[] = [];
    const current = new Date(startDate);

    while (current <= endDate) {
      const dateStr = toDateString(current);
      const filePath = path.join(logsDir, `${dateStr}.json`);
      const dayEvents = readJson<ActivityEvent[]>(filePath, []);
      events.push(...dayEvents);
      current.setDate(current.getDate() + 1);
    }

    return events.filter((e) => {
      const t = new Date(e.timestamp);
      return t >= startDate && t <= endDate;
    });
  }

  /**
   * Load risk events for a date range.
   */
  loadRisks(startDate: Date, endDate: Date): RiskEvent[] {
    const risksFile = path.join(getAcmDir(), 'risks.json');
    const all = readJson<RiskEvent[]>(risksFile, []);
    return all.filter((r) => {
      const t = new Date(r.timestamp);
      return t >= startDate && t <= endDate;
    });
  }

  /**
   * Build the full ReportData object from raw events and commits.
   */
  buildReportData(
    period: string,
    startDate: Date,
    endDate: Date,
    commits: CommitRecord[],
    workUnits: WorkUnit[],
    narrative?: string,
  ): ReportData {
    const events = this.loadEvents(startDate, endDate);
    const risks = this.loadRisks(startDate, endDate);

    // Aggregate active minutes per day
    const byDay: Record<string, number> = {};
    let totalActiveMinutes = 0;
    let linesAdded = 0;
    let linesRemoved = 0;

    const fileEditCounts: Record<string, number> = {};
    const repoStats: Record<string, { minutes: number; commits: number }> = {};

    events
      .filter((e) => e.type === 'edit')
      .forEach((e) => {
        const day = toDateString(new Date(e.timestamp));
        byDay[day] = (byDay[day] ?? 0) + 1; // count events as proxy for minutes
        linesAdded += e.linesAdded;
        linesRemoved += e.linesRemoved;

        fileEditCounts[e.filePath] = (fileEditCounts[e.filePath] ?? 0) + 1;

        if (!repoStats[e.repoName]) {
          repoStats[e.repoName] = { minutes: 0, commits: 0 };
        }
        repoStats[e.repoName].minutes += 1;
      });

    // Rough minute estimation: every ~4 edit events = 1 minute
    Object.keys(byDay).forEach((day) => {
      const minutes = Math.max(1, Math.floor(byDay[day] / 4));
      byDay[day] = minutes;
      totalActiveMinutes += minutes;
    });

    // Per-repo commit counts
    commits.forEach((c) => {
      if (!repoStats[c.repoName]) {
        repoStats[c.repoName] = { minutes: 0, commits: 0 };
      }
      repoStats[c.repoName].commits += 1;
    });

    // Top 10 most edited files
    const topFiles = Object.entries(fileEditCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([filePath, editCount]) => ({ filePath, editCount }));

    return {
      period,
      startDate,
      endDate,
      totalActiveMinutes,
      byDay,
      workUnits,
      commits,
      topFiles,
      repos: repoStats,
      linesAdded,
      linesRemoved,
      risks,
      narrative,
    };
  }
}
