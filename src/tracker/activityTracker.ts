import * as vscode from 'vscode';
import { ActivityEvent } from '../types';
import { RepoManager } from '../repos/repoManager';
import { SessionManager } from './sessionManager';
import { LogWriter } from './logWriter';
import { generateUUID } from '../utils/uuid';
import { toISO } from '../utils/dateUtils';

/**
 * Activity Tracker — hooks into VS Code document events to record developer activity.
 */
export class ActivityTracker {
  private lastEventTime: number = Date.now();
  private idleCheckHandle: ReturnType<typeof setInterval> | null = null;
  private isIdle = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repoManager: RepoManager,
    private readonly sessionManager: SessionManager,
    private readonly logWriter: LogWriter,
  ) {}

  /**
   * Activate all VS Code event hooks and start idle detection.
   */
  activate(): void {
    // Hook: text document changes
    const onEdit = vscode.workspace.onDidChangeTextDocument((e) => {
      const doc = e.document;
      if (doc.uri.scheme !== 'file') return;

      let linesAdded = 0;
      let linesRemoved = 0;
      e.contentChanges.forEach((change) => {
        const lines = change.text.split('\n').length - 1;
        linesAdded += lines;
        linesRemoved += change.range.end.line - change.range.start.line;
      });

      this.handleEvent({
        filePath: doc.uri.fsPath,
        type: 'edit',
        linesAdded,
        linesRemoved,
        languageId: doc.languageId,
      });
    });

    // Hook: active editor changes (focus/context switch)
    const onFocus = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor || editor.document.uri.scheme !== 'file') return;
      this.handleEvent({
        filePath: editor.document.uri.fsPath,
        type: 'focus',
        linesAdded: 0,
        linesRemoved: 0,
        languageId: editor.document.languageId,
      });
    });

    // Idle detection interval — check every 30 seconds
    const idleCheckInterval = setInterval(() => {
      this.checkIdle();
    }, 30 * 1000);

    // Fix v1 bug #3: push disposables so they are cleaned up on deactivation
    this.idleCheckHandle = idleCheckInterval;
    this.context.subscriptions.push(onEdit, onFocus, {
      dispose: () => clearInterval(idleCheckInterval),
    });
  }

  private handleEvent(args: {
    filePath: string;
    type: 'edit' | 'focus';
    linesAdded: number;
    linesRemoved: number;
    languageId: string;
  }): void {
    this.lastEventTime = Date.now();

    if (this.isIdle) {
      this.isIdle = false;
      this.sessionManager.resumeSession();
    }

    const repo = this.repoManager.getRepoForFile(args.filePath);
    if (!repo) return; // Ignore files outside tracked repos

    const session = this.sessionManager.getCurrentSession(repo.repoPath);

    const event: ActivityEvent = {
      eventId: generateUUID(),
      type: args.type,
      filePath: args.filePath,
      repoRoot: repo.repoPath,
      repoName: repo.repoName,
      timestamp: toISO(),
      linesAdded: args.linesAdded,
      linesRemoved: args.linesRemoved,
      languageId: args.languageId,
      sessionId: session.sessionId,
    };

    this.logWriter.writeEvent(event);
    this.sessionManager.recordActivity(event);
  }

  private checkIdle(): void {
    const config = vscode.workspace.getConfiguration('acm');
    const idleThresholdMs =
      config.get<number>('idleThresholdMinutes', 5) * 60 * 1000;
    const elapsed = Date.now() - this.lastEventTime;

    if (!this.isIdle && elapsed >= idleThresholdMs) {
      this.isIdle = true;
      this.sessionManager.markIdle();
    }
  }
}
