import * as vscode from 'vscode';
import { WorkUnit } from '../../types';
import { TYPE_ICON } from '../../constants';

type TreeItem = WorkUnitItem | ReportItem | SectionItem;

class SectionItem extends vscode.TreeItem {
  constructor(label: string, collapsible: vscode.TreeItemCollapsibleState) {
    super(label, collapsible);
    this.contextValue = 'section';
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
 * Shows: Work Units (This Week), Reports.
 */
export class CodeBrainProSidebarProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private workUnits: WorkUnit[] = [];

  constructor() {}

  /**
   * Restore persisted state on activation.
   * Called once during startup to hydrate the sidebar with data from disk.
   */
  restoreState(data: { workUnits?: WorkUnit[] }): void {
    if (data.workUnits) this.workUnits = data.workUnits;
    this._onDidChangeTreeData.fire();
  }

  /**
   * Refresh the tree with new data.
   */
  refresh(data?: { workUnits?: WorkUnit[] }): void {
    if (data?.workUnits) this.workUnits = data.workUnits;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): TreeItem[] {
    if (!element) {
      // Root level: two sections
      return [
        new SectionItem(
          '📦 Work Units (This Week)',
          vscode.TreeItemCollapsibleState.Expanded,
        ),
        new SectionItem('📊 Reports', vscode.TreeItemCollapsibleState.Expanded),
      ];
    }

    const label = (element as vscode.TreeItem).label as string;

    if (label?.startsWith('📦')) {
      return this.getWorkUnitItems();
    }
    if (label?.startsWith('📊')) {
      return this.getReportItems();
    }

    return [];
  }

  private getWorkUnitItems(): TreeItem[] {
    if (this.workUnits.length === 0) {
      const empty = new vscode.TreeItem(
        'No work units this week',
        vscode.TreeItemCollapsibleState.None,
      );
      empty.description = 'Commits will be grouped automatically';
      return [empty as TreeItem];
    }
    return this.workUnits.slice(0, 10).map((u) => new WorkUnitItem(u));
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
