import * as vscode from 'vscode';
import { CredentialsManager } from './auth/credentials';
import { GitClient } from './git/gitClient';
import { RepoManager } from './repos/repoManager';
import { ActivityTracker } from './tracker/activityTracker';
import { SessionManager } from './tracker/sessionManager';
import { LogWriter } from './tracker/logWriter';
import { CommitPoller } from './git/commitPoller';
import { RiskDetector } from './git/riskDetector';
import { CommitClassifier } from './ai/classifier';
import { CommitGrouper } from './ai/grouper';
import { AiReporter } from './ai/reporter';
import { ReportManager } from './reports/reportManager';
import { GitHubSync } from './sync/githubSync';
import { AcmStatusBar } from './ui/statusBarItem';
import { AcmSidebarProvider } from './ui/sidebarProvider';
import { ChatPanel } from './ui/chatPanel';
import { CommitRecord, WorkUnit, RiskEvent } from './types';
import { ensureAcmDirs } from './utils/storage';

// In-memory stores (repopulated on each activation via commit poller)
const allCommits: CommitRecord[] = [];
const allWorkUnits: WorkUnit[] = [];
const activeRisks: RiskEvent[] = [];

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  console.log('✅ Auto-Commit Mate++ v2 activated!');

  // ─── Storage directories ─────────────────────────────────────────────────
  ensureAcmDirs();

  // ─── Core services ────────────────────────────────────────────────────────
  const credentialsManager = new CredentialsManager(context);
  const gitClient = new GitClient();
  const repoManager = new RepoManager();
  const sessionManager = new SessionManager();
  const logWriter = new LogWriter();

  // ─── Detect repos ────────────────────────────────────────────────────────
  await repoManager.detectRepos();

  // ─── AI services ─────────────────────────────────────────────────────────
  const geminiKey = (await context.secrets.get('acm.geminiApiKey')) ?? null;
  const classifier = new CommitClassifier(geminiKey);
  const grouper = new CommitGrouper(geminiKey);
  const aiReporter = new AiReporter(geminiKey);

  // ─── Status Bar ───────────────────────────────────────────────────────────
  const statusBar = new AcmStatusBar(context);
  statusBar.setActiveMinutesProvider(() =>
    sessionManager.getTotalActiveMinutesToday(),
  );
  statusBar.startUpdating();

  // ─── Sidebar ──────────────────────────────────────────────────────────────
  const sidebarProvider = new AcmSidebarProvider(sessionManager, repoManager);
  const treeView = vscode.window.createTreeView('acmSidebar', {
    treeDataProvider: sidebarProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Sidebar refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('acmSidebar.refresh', () => {
      sidebarProvider.refresh();
    }),
  );

  // ─── GitHub Sync ─────────────────────────────────────────────────────────
  const githubSync = new GitHubSync(context, credentialsManager);
  githubSync.setSyncCallbacks(
    () => statusBar.startSync(),
    () => statusBar.stopSync(),
  );
  githubSync.startAutoSync();

  // ─── Activity Tracker ─────────────────────────────────────────────────────
  const activityTracker = new ActivityTracker(
    context,
    repoManager,
    sessionManager,
    logWriter,
  );

  const config = vscode.workspace.getConfiguration('acm');
  if (config.get<boolean>('enabled', true)) {
    activityTracker.activate();
  }

  // ─── Commit Poller ────────────────────────────────────────────────────────
  const commitPoller = new CommitPoller(context, gitClient, repoManager);

  commitPoller.onNewCommit(async (commit) => {
    const classification = await classifier.classify(
      commit.hash,
      commit.message,
      commit.diffStat,
    );
    const enrichedCommit: CommitRecord = { ...commit, classification };
    allCommits.push(enrichedCommit);

    // Re-group work units on each new commit
    const newWorkUnits = await grouper.group(allCommits.slice(-50));
    allWorkUnits.length = 0;
    allWorkUnits.push(...newWorkUnits);

    sidebarProvider.refresh({
      workUnits: allWorkUnits,
      commits: allCommits.slice(-20),
    });
  });

  commitPoller.start();

  // ─── Risk Detector ────────────────────────────────────────────────────────
  const riskDetector = new RiskDetector(context, gitClient, repoManager);
  riskDetector.start((totalRisks) => {
    statusBar.setRiskCount(totalRisks);
    sidebarProvider.refresh({ risks: activeRisks });
  });

  // ─── Report Manager ───────────────────────────────────────────────────────
  const reportManager = new ReportManager(aiReporter, allCommits, allWorkUnits);

  // ─── Commands ─────────────────────────────────────────────────────────────
  const commands: Array<[string, () => void | Promise<void>]> = [
    [
      'acm.start',
      async () => {
        await repoManager.detectRepos();
        activityTracker.activate();
        vscode.window.showInformationMessage('✅ ACM: Tracking started.');
      },
    ],
    [
      'acm.stop',
      () => {
        vscode.window.showInformationMessage(
          '⏹️ ACM: Tracking paused. Use "ACM: Start" to resume.',
        );
      },
    ],
    [
      'acm.setInterval',
      async () => {
        const value = await vscode.window.showInputBox({
          prompt: 'Set auto-commit interval (minutes)',
          value: String(config.get<number>('commitIntervalMinutes', 30)),
          validateInput: (v) => {
            const n = parseInt(v, 10);
            return isNaN(n) || n < 1 ? 'Enter a number ≥ 1' : null;
          },
        });
        if (value) {
          await config.update(
            'commitIntervalMinutes',
            parseInt(value, 10),
            vscode.ConfigurationTarget.Global,
          );
          vscode.window.showInformationMessage(
            `⏱️ ACM: Interval set to ${value} minutes.`,
          );
        }
      },
    ],
    ['acm.generateDaily', () => reportManager.generateDaily()],
    ['acm.generateWeekly', () => reportManager.generateWeekly()],
    ['acm.generateMonthly', () => reportManager.generateMonthly()],
    ['acm.generateAppraisal', () => reportManager.generateAppraisal()],
    [
      'acm.askQuestion',
      () => ChatPanel.show(context, aiReporter, allWorkUnits),
    ],
    ['acm.syncNow', () => githubSync.syncNow()],
    [
      'acm.viewLog',
      async () => {
        const logPath = logWriter.getTodayLogPath();
        try {
          await vscode.window.showTextDocument(vscode.Uri.file(logPath));
        } catch {
          vscode.window.showInformationMessage(
            'ACM: No activity log for today yet.',
          );
        }
      },
    ],
    ['acm.clearCredentials', () => credentialsManager.clearCredentials()],
    [
      'acm.openSettings',
      () =>
        vscode.commands.executeCommand('workbench.action.openSettings', 'acm'),
    ],
    [
      'acm.openSidebar',
      () => vscode.commands.executeCommand('acmSidebar.focus'),
    ],
  ];

  commands.forEach(([id, handler]) => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  });

  // ─── Startup Prompt ───────────────────────────────────────────────────────
  if (config.get<boolean>('showStartupPrompt', true)) {
    const selection = await vscode.window.showInformationMessage(
      '🚀 Auto-Commit Mate++ v2 is active! AI-powered activity tracking enabled.',
      'Configure',
      "Don't show again",
    );
    if (selection === 'Configure') {
      vscode.commands.executeCommand('acm.openSettings');
    } else if (selection === "Don't show again") {
      await config.update(
        'showStartupPrompt',
        false,
        vscode.ConfigurationTarget.Global,
      );
    }
  }
}

export function deactivate(): void {
  // All cleanup handled via context.subscriptions
}
