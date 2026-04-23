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
import { CodeBrainProStatusBar } from './ui/statusBarItem';
import { CodeBrainProSidebarProvider } from './ui/sidebarProvider';
import { ChatPanel } from './ui/chatPanel';
import { CommitRecord, WorkUnit, RiskEvent } from './types';
import { ensureCodeBrainProDirs } from './utils/storage';

// In-memory stores (repopulated on each activation via commit poller)
const allCommits: CommitRecord[] = [];
const allWorkUnits: WorkUnit[] = [];
const activeRisks: RiskEvent[] = [];

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  console.log('CodeBrainPro activated!');

  // Storage directories
  ensureCodeBrainProDirs();

  // Core services
  const credentialsManager = new CredentialsManager(context);
  const gitClient = new GitClient();
  const repoManager = new RepoManager();
  const sessionManager = new SessionManager();
  const logWriter = new LogWriter();

  // Detect repos
  await repoManager.detectRepos();

  // AI services — prompt for Gemini key if not yet stored
  const geminiKey = await credentialsManager.ensureGeminiKey();
  const classifier = new CommitClassifier(geminiKey);
  const grouper = new CommitGrouper(geminiKey);
  const aiReporter = new AiReporter(geminiKey);

  // Status Bar
  const statusBar = new CodeBrainProStatusBar(context);
  statusBar.setActiveMinutesProvider(() =>
    sessionManager.getTotalActiveMinutesToday(),
  );
  statusBar.startUpdating();

  // Sidebar
  const sidebarProvider = new CodeBrainProSidebarProvider(
    sessionManager,
    repoManager,
  );
  const treeView = vscode.window.createTreeView('codeBrainProSidebar', {
    treeDataProvider: sidebarProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Sidebar refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('codeBrainProSidebar.refresh', () => {
      sidebarProvider.refresh();
    }),
  );

  // [GitHub Sync is wired up after CommitPoller — see below]

  // Activity Tracker
  const activityTracker = new ActivityTracker(
    context,
    repoManager,
    sessionManager,
    logWriter,
  );

  const config = vscode.workspace.getConfiguration('codeBrainPro');
  if (config.get<boolean>('enabled', true)) {
    activityTracker.activate();
  }

  // Commit Poller
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

  // GitHub Sync — wired up here so onSyncEnd can reference commitPoller
  const githubSync = new GitHubSync(context, credentialsManager);
  githubSync.setSyncCallbacks(
    () => {
      statusBar.startSync();
    },
    async () => {
      statusBar.stopSync();

      // Re-poll commits immediately so the sidebar reflects the latest
      // work units and commit history without waiting for the next
      // scheduled 5-minute poll interval.
      try {
        await commitPoller.poll();
        sidebarProvider.refresh({
          workUnits: allWorkUnits,
          commits: allCommits.slice(-20),
        });
      } catch {
        // Non-fatal — sidebar will self-correct on next regular poll
      }
    },
  );
  githubSync.startAutoSync();

  // Risk Detector
  const riskDetector = new RiskDetector(context, gitClient, repoManager);
  riskDetector.start((totalRisks) => {
    statusBar.setRiskCount(totalRisks);
    sidebarProvider.refresh({ risks: activeRisks });
  });

  // Report Manager
  const reportManager = new ReportManager(aiReporter, allCommits, allWorkUnits);

  // Commands
  const commands: [string, () => void | Promise<void>][] = [
    [
      'codeBrainPro.start',
      async () => {
        await repoManager.detectRepos();
        activityTracker.activate();
        vscode.window.showInformationMessage('CodeBrainPro: Tracking started.');
      },
    ],
    [
      'codeBrainPro.stop',
      () => {
        vscode.window.showInformationMessage(
          'CodeBrainPro: Tracking paused. Use "CodeBrainPro: Start" to resume.',
        );
      },
    ],
    [
      'codeBrainPro.setInterval',
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
            `CodeBrainPro: Interval set to ${value} minutes.`,
          );
        }
      },
    ],
    ['codeBrainPro.generateDaily', () => reportManager.generateDaily()],
    ['codeBrainPro.generateWeekly', () => reportManager.generateWeekly()],
    ['codeBrainPro.generateMonthly', () => reportManager.generateMonthly()],
    ['codeBrainPro.generateAppraisal', () => reportManager.generateAppraisal()],
    [
      'codeBrainPro.askQuestion',
      () => {
        ChatPanel.show(context, aiReporter, allWorkUnits);
      },
    ],
    ['codeBrainPro.syncNow', () => githubSync.syncNow()],
    [
      'codeBrainPro.viewLog',
      async () => {
        const logPath = logWriter.getTodayLogPath();
        try {
          await vscode.window.showTextDocument(vscode.Uri.file(logPath));
        } catch {
          vscode.window.showInformationMessage(
            'CodeBrainPro: No activity log for today yet.',
          );
        }
      },
    ],
    [
      'codeBrainPro.setGeminiKey',
      async () => {
        const newKey = await credentialsManager.setGeminiKey();
        if (newKey) {
          // Live-update all three AI services without requiring a reload
          classifier.updateApiKey(newKey);
          grouper.updateApiKey(newKey);
          aiReporter.updateApiKey(newKey);
        }
      },
    ],
    [
      'codeBrainPro.clearCredentials',
      () => credentialsManager.clearCredentials(),
    ],
    [
      'codeBrainPro.openSettings',
      () =>
        vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'codeBrainPro',
        ),
    ],
    [
      'codeBrainPro.openSidebar',
      () => vscode.commands.executeCommand('codeBrainProSidebar.focus'),
    ],
  ];

  commands.forEach(([id, handler]) => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  });

  // Start-up Prompt
  if (config.get<boolean>('showStartupPrompt', true)) {
    const selection = await vscode.window.showInformationMessage(
      '🚀 CodeBrainPro is active! AI-powered activity tracking enabled.',
      'Configure',
      "Don't show again",
    );
    if (selection === 'Configure') {
      vscode.commands.executeCommand('codeBrainPro.openSettings');
    } else if (selection === "Don't show again") {
      await config.update(
        'showStartupPrompt',
        false,
        vscode.ConfigurationTarget.Global,
      );
    }
  }
}

// All cleanup handled via context.subscriptions
export function deactivate(): void {}
