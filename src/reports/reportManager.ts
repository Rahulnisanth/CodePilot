import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ReportData, ReportBuilder } from './reportBuilder';
import { CommitRecord, WorkUnit } from '../types';
import { AiReporter } from '../ai/reporter';
import { CommitGrouper } from '../ai/grouper';
import { toMarkdown } from './exporters/markdownExporter';
import { toJson } from './exporters/jsonExporter';
import { writeJson, getReportsDir, ensureAcmDirs } from '../utils/storage';
import {
  toDateString,
  startOfDay,
  startOfWeek,
  getWeekNumber,
} from '../utils/dateUtils';

export type ReportType = 'daily' | 'weekly' | 'monthly' | 'appraisal';
export type ExportFormat = 'markdown' | 'json';

/**
 * Orchestrates report generation for all report types.
 */
export class ReportManager {
  private readonly builder: ReportBuilder;

  constructor(
    private readonly aiReporter: AiReporter,
    private readonly commitsStore: CommitRecord[],
    private readonly workUnitsStore: WorkUnit[],
  ) {
    this.builder = new ReportBuilder();
  }

  /**
   * Generate a daily report (last 24 hours).
   */
  async generateDaily(format: ExportFormat = 'markdown'): Promise<void> {
    const end = new Date();
    const start = startOfDay(end);
    const period = `Daily Summary — ${toDateString(end)}`;
    await this.generateAndSave('daily', period, start, end, format);
  }

  /**
   * Generate a weekly report (last 7 days).
   */
  async generateWeekly(format: ExportFormat = 'markdown'): Promise<void> {
    const end = new Date();
    const start = startOfWeek(end);
    const year = end.getFullYear();
    const week = getWeekNumber(end);
    const period = `Weekly Work-Log — Week ${week}, ${year}`;
    await this.generateAndSave('weekly', period, start, end, format);
  }

  /**
   * Generate a monthly report (last 30 days).
   */
  async generateMonthly(format: ExportFormat = 'markdown'): Promise<void> {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 30);
    const period = `Monthly Summary — ${end.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
    await this.generateAndSave('monthly', period, start, end, format);
  }

  /**
   * Generate an appraisal report with a custom date range.
   */
  async generateAppraisal(): Promise<void> {
    const startInput = await vscode.window.showInputBox({
      prompt: 'Enter start date (YYYY-MM-DD)',
      placeHolder: '2026-01-01',
      ignoreFocusOut: true,
    });

    const endInput = await vscode.window.showInputBox({
      prompt: 'Enter end date (YYYY-MM-DD)',
      placeHolder: '2026-03-31',
      ignoreFocusOut: true,
    });

    if (!startInput || !endInput) {
      vscode.window.showErrorMessage('ACM: Start and end dates are required.');
      return;
    }

    const start = new Date(startInput);
    const end = new Date(endInput);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      vscode.window.showErrorMessage(
        'ACM: Invalid date format. Use YYYY-MM-DD.',
      );
      return;
    }

    const period = `Appraisal Report — ${startInput} to ${endInput}`;
    await this.generateAndSave('appraisal', period, start, end, 'markdown');
  }

  private async generateAndSave(
    type: ReportType,
    period: string,
    start: Date,
    end: Date,
    format: ExportFormat,
  ): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `ACM: Generating ${type} report...`,
        cancellable: false,
      },
      async () => {
        try {
          // Filter commits & work units to date range
          const commits = this.commitsStore.filter((c) => {
            const t = new Date(c.timestamp);
            return t >= start && t <= end;
          });

          const workUnits = this.workUnitsStore.filter((u) => {
            const t = new Date(u.startTime);
            return t >= start && t <= end;
          });

          // Generate AI narrative
          const repos = [...new Set(commits.map((c) => c.repoName))];
          let linesAdded = 0,
            linesRemoved = 0,
            totalActiveMinutes = 0;
          Object.values(
            this.builder.buildReportData(period, start, end, commits, workUnits)
              .repos,
          ).forEach((s) => {
            totalActiveMinutes += s.minutes;
          });
          commits.forEach((c) => {
            linesAdded += c.linesAdded;
            linesRemoved += c.linesRemoved;
          });

          const narrative = await this.aiReporter.generateNarrative(
            period,
            workUnits,
            {
              totalActiveMinutes,
              linesAdded,
              linesRemoved,
              repos,
            },
          );

          const reportData = this.builder.buildReportData(
            period,
            start,
            end,
            commits,
            workUnits,
            narrative,
          );

          // Save and open the report
          await this.saveReport(type, reportData, format, start);
        } catch (error) {
          vscode.window.showErrorMessage(
            `ACM: Failed to generate report — ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      },
    );
  }

  private async saveReport(
    type: ReportType,
    data: ReportData,
    format: ExportFormat,
    date: Date,
  ): Promise<void> {
    ensureAcmDirs();
    const reportsDir = getReportsDir();
    const dateStr = toDateString(date);
    const ext = format === 'markdown' ? '.md' : '.json';
    const fileName = `${dateStr}-${type}${ext}`;
    const filePath = path.join(reportsDir, fileName);

    const content = format === 'markdown' ? toMarkdown(data) : toJson(data);
    fs.writeFileSync(filePath, content, 'utf-8');

    const open = await vscode.window.showInformationMessage(
      `✅ ACM: ${type} report saved to ${filePath}`,
      'Open Report',
    );

    if (open === 'Open Report') {
      const uri = vscode.Uri.file(filePath);
      if (format === 'markdown') {
        await vscode.commands.executeCommand('markdown.showPreview', uri);
      } else {
        await vscode.window.showTextDocument(uri);
      }
    }
  }
}
