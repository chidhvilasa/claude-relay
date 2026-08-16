import * as vscode from 'vscode';
import { PluginManager } from './integration/plugin-manager';
import { RelayService } from './relay-service';

export class RelayDashboardProvider implements vscode.TreeDataProvider<DashboardItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<DashboardItem | undefined | void> = new vscode.EventEmitter<DashboardItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<DashboardItem | undefined | void> = this._onDidChangeTreeData.event;
  private pluginManager = new PluginManager();

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

    const status = await this.pluginManager.getOverallStatus();
    let pluginDesc = 'Unknown';
    let protectionDesc = 'Not Verified';
    let legacyDesc = 'None';

    if (status === 'INSTALLED') {
      pluginDesc = 'Active';
      protectionDesc = 'Active';
    } else if (status === 'INSTALLED_DISABLED') {
      pluginDesc = 'Installed (Disabled)';
      protectionDesc = 'Manual Mode';
    } else if (status === 'NOT_INSTALLED') {
      pluginDesc = 'Not Installed';
      protectionDesc = 'Manual Mode';
    } else if (status === 'LEGACY_INTEGRATION') {
      pluginDesc = 'Not Installed';
      protectionDesc = 'Active (Legacy)';
      legacyDesc = 'Active';
    } else if (status === 'PLUGIN_AND_LEGACY_CONFLICT') {
      pluginDesc = 'Active';
      protectionDesc = 'Conflict (Both Active)';
      legacyDesc = 'Active (Conflict)';
    } else if (status === 'UNKNOWN') {
      pluginDesc = 'Unknown (Claude CLI unavailable)';
      protectionDesc = 'Not Verified';
    }

    const folders = vscode.workspace.workspaceFolders;
    let recoveryDesc: string;
    let repositoryDesc: string;

    if (!folders || folders.length === 0) {
      recoveryDesc = 'No workspace open';
      repositoryDesc = 'None';
    } else if (folders.length > 1) {
      recoveryDesc = `${folders.length} folders open — use "Claude Relay: ..." commands to pick one`;
      repositoryDesc = `${folders.length} folders (multi-root)`;
    } else {
      repositoryDesc = folders[0].name;
      try {
        const service = new RelayService(folders[0].uri.fsPath);
        const [checkpoint, handoff] = await Promise.all([service.getLatestCheckpoint(), service.getLatestHandoff()]);
        const checkpointPart = checkpoint ? `Checkpoint: ${checkpoint.createdAt}` : 'Checkpoint: none';
        let handoffPart = 'Handoff: none';
        if (handoff) {
          const freshness = await service.evaluateFreshness(handoff);
          handoffPart = `Handoff: ${handoff.createdAt} (${freshness})`;
        }
        recoveryDesc = `${checkpointPart} | ${handoffPart}`;
      } catch (e: any) {
        recoveryDesc = `Recovery State: Invalid (${e.message})`;
      }
    }

    return [
      new DashboardItem('Claude Code', 'Detected', vscode.TreeItemCollapsibleState.None),
      new DashboardItem('Claude Relay Plugin', pluginDesc, vscode.TreeItemCollapsibleState.None),
      new DashboardItem('Automatic protection', protectionDesc, vscode.TreeItemCollapsibleState.None),
      new DashboardItem('Legacy integration', legacyDesc, vscode.TreeItemCollapsibleState.None),
      new DashboardItem('Recovery', recoveryDesc, vscode.TreeItemCollapsibleState.None),
      new DashboardItem('Repository', repositoryDesc, vscode.TreeItemCollapsibleState.None),
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
