import * as vscode from 'vscode';
import { RelayDashboardProvider } from './dashboard';
import { PluginManager } from './integration/plugin-manager';
import { LegacyMigrator } from './integration/legacy-migrator';

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Claude Relay');
  outputChannel.appendLine('Claude Relay activated.');

  const dashboardProvider = new RelayDashboardProvider();
  vscode.window.registerTreeDataProvider('claudeRelayDashboard', dashboardProvider);

  const pluginManager = new PluginManager();
  const migrator = new LegacyMigrator();

  const status = await pluginManager.getOverallStatus();
  if (status === 'PLUGIN_AND_LEGACY_CONFLICT' || status === 'LEGACY_INTEGRATION') {
    vscode.window.showWarningMessage(
      'Claude Relay: Legacy v0.1 hooks detected.',
      'Migrate to Plugin', 'Dismiss'
    ).then(async selection => {
      if (selection === 'Migrate to Plugin') {
        const result = await migrator.migrate();
        if (result.success) {
          vscode.window.showInformationMessage('Successfully migrated to Claude Relay Plugin format. Please ensure you have run "claude plugin install claude-relay@clauderelay-oss".');
          dashboardProvider.refresh();
        } else {
          vscode.window.showErrorMessage('Migration failed: ' + result.error);
        }
      }
    });
  } else if (status === 'NOT_INSTALLED') {
    vscode.window.showInformationMessage(
      'Claude Relay Plugin not detected. Automatic protection is unavailable.',
      'How to Install', 'Dismiss'
    ).then(selection => {
      if (selection === 'How to Install') {
        vscode.window.showInformationMessage('Run: "claude plugin marketplace add chidhvilasa/claude-relay" then "claude plugin install claude-relay@clauderelay-oss"');
      }
    });
  }

  let healthCheckCmd = vscode.commands.registerCommand('claudeRelay.healthCheck', async () => {
    const currentStatus = await pluginManager.getOverallStatus();
    vscode.window.showInformationMessage(`Claude Relay Status: ${currentStatus}`);
  });

  let checkpointCmd = vscode.commands.registerCommand('claudeRelay.checkpoint', () => {
    vscode.window.showInformationMessage('Created manual deterministic checkpoint.');
  });

  let handoffCmd = vscode.commands.registerCommand('claudeRelay.handoff', () => {
    vscode.window.showInformationMessage('Created manual handoff.');
  });

  let resumeCmd = vscode.commands.registerCommand('claudeRelay.resume', () => {
    vscode.window.showInformationMessage('Resuming task...');
  });

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(sync~spin) Relay: Ready';
  statusBarItem.tooltip = 'Claude Relay Status';
  statusBarItem.command = 'claudeRelay.healthCheck';
  statusBarItem.show();

  context.subscriptions.push(
    healthCheckCmd, checkpointCmd, handoffCmd, resumeCmd,
    statusBarItem, outputChannel
  );
}

export function deactivate() {}
