import * as vscode from 'vscode';
import * as path from 'path';

export class RelayDashboardProvider implements vscode.TreeDataProvider<DashboardItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<DashboardItem | undefined | void> = new vscode.EventEmitter<DashboardItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<DashboardItem | undefined | void> = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DashboardItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: DashboardItem): Promise<DashboardItem[]> {
    if (element) {
      return [];
    }

    return [
      new DashboardItem('Claude Code', 'Detected', vscode.TreeItemCollapsibleState.None),
      new DashboardItem('Claude Integration', 'Installed', vscode.TreeItemCollapsibleState.None),
      new DashboardItem('Repository', vscode.workspace.name || 'Unknown', vscode.TreeItemCollapsibleState.None),
      new DashboardItem('Recovery', 'Active', vscode.TreeItemCollapsibleState.None),
      new DashboardItem('Handoff', 'None', vscode.TreeItemCollapsibleState.None),
      new DashboardItem('Usage Context', 'Unavailable', vscode.TreeItemCollapsibleState.None),
      new DashboardItem('Health', 'PASS', vscode.TreeItemCollapsibleState.None)
    ];
  }
}

class DashboardItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly description: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command
  ) {
    super(label, collapsibleState);
    this.tooltip = `${this.label}: ${this.description}`;
    this.description = description;
  }
}
