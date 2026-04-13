import * as path from 'path';
import { ActivityEvent } from '../types';
import {
  getLogsDir,
  appendToJsonArray,
  pruneOldLogs,
  ensureAcmDirs,
} from '../utils/storage';
import { toDateString } from '../utils/dateUtils';
import * as vscode from 'vscode';

/**
 * Writes ActivityEvents to rolling JSON log files in ~/.acm/logs/YYYY-MM-DD.json.
 */
export class LogWriter {
  constructor() {
    ensureAcmDirs();
  }

  /**
   * Appends a single ActivityEvent to today's log file.
   */
  writeEvent(event: ActivityEvent): void {
    const logsDir = getLogsDir();
    const fileName = `${toDateString(new Date())}.json`;
    const filePath = path.join(logsDir, fileName);
    appendToJsonArray<ActivityEvent>(filePath, event);
  }

  /**
   * Prune old log files based on the configured retention period.
   */
  pruneOldLogs(): void {
    const config = vscode.workspace.getConfiguration('acm');
    const retentionDays = config.get<number>('logRetentionDays', 90);
    pruneOldLogs(retentionDays);
  }

  /**
   * Returns the path of today's log file.
   */
  getTodayLogPath(): string {
    return path.join(getLogsDir(), `${toDateString()}.json`);
  }
}
