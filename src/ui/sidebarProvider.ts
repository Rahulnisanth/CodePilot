import * as vscode from 'vscode';
import { WorkUnit, CommitRecord, RiskEvent } from '../types';
import { formatDuration, toDateString } from '../utils/dateUtils';
import { SessionManager } from '../tracker/sessionManager';
import { RepoManager } from '../repos/repoManager';
import { TYPE_ICON } from '../constants';

type TreeItem =
  | ActivityItem
  | WorkUnitItem
  | RiskItem
  | ReportItem
  | SectionItem;

class SectionItem extends vscode.TreeItem {
  constructor(label: string, collapsible: vscode.TreeItemCollapsibleState) {
    super(label, collapsible);
    this.contextValue = 'section';
  }
}

class ActivityItem extends vscode.TreeItem {
  constructor(label: string, description?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.contextValue = 'activity';
  }
}

class WorkUnitItem extends vscode.TreeItem {
  constructor(unit: WorkUnit) {
    const icon = TYPE_ICON[unit.type] ?? '$(circle-outline)';
    super(unit.name, vscode.TreeItemCollapsibleState.None);
    this.description = `[${unit.type}] · ${unit.commits.length} commit(s)`;
    this.iconPath = new vscode.ThemeIcon(
      unit.type === 'feature'
        ? 'add'
        : unit.type === 'bugfix'
          ? 'bug'
          : unit.type === 'refactor'
            ? 'tools'
            : unit.type === 'docs'
              ? 'book'
              : unit.type === 'test'
                ? 'beaker'
                : 'gear',
    );
    this.contextValue = 'workUnit';
    this.tooltip = `${unit.repos.join(', ')} · ${unit.totalLinesChanged} lines changed`;
  }
}

class RiskItem extends vscode.TreeItem {
  constructor(risk: RiskEvent) {
    super(
      `${risk.repoName}: ${risk.linesChanged} lines uncommitted`,
      vscode.TreeItemCollapsibleState.None,
    );
    this.description = `${risk.minutesSinceLastCommit}m without commit`;
    this.iconPath = new vscode.ThemeIcon('warning');
    this.command = {
      command: 'workbench.view.scm',
      title: 'Open Source Control',
    };
    this.contextValue = 'risk';
  }
}

class ReportItem extends vscode.TreeItem {
  constructor(label: string, command: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('graph');
    this.command = {
      command,
      title: label,
    };
    this.contextValue = 'reportAction';
  }
}

/**
 * Sidebar Tree Data Provider for CodeBrainPro.
 * Shows: Today's Activity, Work Units, Risks, Reports.
 */
export class CodeBrainProSidebarProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private workUnits: WorkUnit[] = [];
  private risks: RiskEvent[] = [];
  private recentCommits: CommitRecord[] = [];

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly repoManager: RepoManager,
  ) {}

  /**
   * Restore persisted state on activation.
   * Called once during startup to hydrate the sidebar with data from disk.
   */
  restoreState(data: {
    workUnits?: WorkUnit[];
    commits?: CommitRecord[];
  }): void {
    if (data.workUnits) this.workUnits = data.workUnits;
    if (data.commits) this.recentCommits = data.commits;
    this._onDidChangeTreeData.fire();
  }

  /**
   * Refresh the tree with new data.
   */
  refresh(data?: {
    workUnits?: WorkUnit[];
    risks?: RiskEvent[];
    commits?: CommitRecord[];
  }): void {
    if (data?.workUnits) this.workUnits = data.workUnits;
    if (data?.risks) this.risks = data.risks;
    if (data?.commits) this.recentCommits = data.commits;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): TreeItem[] {
    if (!element) {
      // Root level: four sections
      return [
        new SectionItem(
          "📅 Today's Activity",
          vscode.TreeItemCollapsibleState.Expanded,
        ),
        new SectionItem(
          '📦 Work Units (This Week)',
          vscode.TreeItemCollapsibleState.Expanded,
        ),
        new SectionItem('⚠️ Risks', vscode.TreeItemCollapsibleState.Expanded),
        new SectionItem('📊 Reports', vscode.TreeItemCollapsibleState.Expanded),
      ];
    }

    const label = (element as vscode.TreeItem).label as string;

    if (label?.startsWith('📅')) {
      return this.getTodayActivityItems();
    }
    if (label?.startsWith('📦')) {
      return this.getWorkUnitItems();
    }
    if (label?.startsWith('⚠️')) {
      return this.getRiskItems();
    }
    if (label?.startsWith('📊')) {
      return this.getReportItems();
    }

    return [];
  }

  private getTodayActivityItems(): TreeItem[] {
    const activeMinutes = this.sessionManager.getTotalActiveMinutesToday();
    const repos = this.repoManager.getAll().map((r) => r.repoName);
    const today = toDateString();
    const todayCommits = this.recentCommits.filter((c) => {
      return c.timestamp && toDateString(new Date(c.timestamp)) === today;
    });
    const items: TreeItem[] = [
      new ActivityItem('Active Time', formatDuration(activeMinutes)),
      new ActivityItem('Commits Today', String(todayCommits.length)),
    ];

    if (repos.length > 0) {
      items.push(new ActivityItem('Repos', repos.join(', ')));
    }

    return items;
  }

  private getWorkUnitItems(): TreeItem[] {
    if (this.workUnits.length === 0) {
      return [
        new ActivityItem(
          'No work units this week',
          'Commits will be grouped automatically',
        ),
      ];
    }
    return this.workUnits.slice(0, 10).map((u) => new WorkUnitItem(u));
  }

  private getRiskItems(): TreeItem[] {
    if (this.risks.length === 0) {
      return [new ActivityItem('No risks detected', '✓ All clear')];
    }
    return this.risks.map((r) => new RiskItem(r));
  }

  private getReportItems(): TreeItem[] {
    return [
      new ReportItem('Generate Daily Report', 'codeBrainPro.generateDaily'),
      new ReportItem('Generate Weekly Report', 'codeBrainPro.generateWeekly'),
      new ReportItem('Generate Monthly Report', 'codeBrainPro.generateMonthly'),
      new ReportItem(
        'Generate Appraisal Report',
        'codeBrainPro.generateAppraisal',
      ),
      new ReportItem('Ask a Question...', 'codeBrainPro.askQuestion'),
    ];
  }
}
