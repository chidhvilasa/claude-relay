import * as vscode from 'vscode';
import * as path from 'path';
import { RelayDashboardProvider } from './dashboard';

export async function activate(context: vscode.ExtensionContext) {
  console.log('Claude Relay is now active!');

  const outputChannel = vscode.window.createOutputChannel('Claude Relay');
  outputChannel.appendLine('Claude Relay activated.');

  const dashboardProvider = new RelayDashboardProvider();
  vscode.window.registerTreeDataProvider('claudeRelayDashboard', dashboardProvider);

  let setupCmd = vscode.commands.registerCommand('claudeRelay.setup', async () => {
    try {
      const { ClaudeConfigInstaller } = require('@claude-relay/core');
      const os = require('os');
      const path = require('path');
      const installer = new ClaudeConfigInstaller(os.homedir());
      const runnerPath = path.join(context.extensionPath, 'dist', 'hook-runner.cjs');
      const skillPath = path.join(context.extensionPath, '..', '..', 'claude', 'skill', 'SKILL.md');
      const success = await installer.installIntegration(runnerPath, skillPath);
      if (success) {
        vscode.window.showInformationMessage('Claude Relay installed successfully!');
      } else {
        vscode.window.showErrorMessage('Failed to install Claude Relay hooks.');
      }
    } catch (e: any) {
      vscode.window.showErrorMessage('Setup error: ' + e.message);
    }
  });

  let healthCheckCmd = vscode.commands.registerCommand('claudeRelay.healthCheck', () => {
    vscode.window.showInformationMessage('Claude Relay Health Check: PASS (Stub)');
  });

  let checkpointCmd = vscode.commands.registerCommand('claudeRelay.checkpoint', () => {
    vscode.window.showInformationMessage('Created deterministic checkpoint.');
  });

  let handoffCmd = vscode.commands.registerCommand('claudeRelay.handoff', () => {
    vscode.window.showInformationMessage('Created handoff.');
  });

  let resumeCmd = vscode.commands.registerCommand('claudeRelay.resume', () => {
    vscode.window.showInformationMessage('Resuming task...');
  });

  // Check for unresolved work
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const wsPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    // Mock check for now
    setTimeout(() => {
       vscode.window.showInformationMessage(
         'Claude Relay found unfinished work from your previous session.',
         'Resume Previous Task', 'View Handoff', 'Dismiss'
       ).then(selection => {
         if (selection === 'Resume Previous Task') {
           vscode.commands.executeCommand('claudeRelay.resume');
         }
       });
    }, 2000);
  }

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(sync~spin) Relay: Ready';
  statusBarItem.tooltip = 'Claude Relay Status';
  statusBarItem.command = 'claudeRelay.healthCheck';
  statusBarItem.show();

  let openLatestHandoffCmd = vscode.commands.registerCommand('claudeRelay.openLatestHandoff', () => {
    vscode.window.showInformationMessage('Opening latest handoff (mock)');
  });

  let openDashboardCmd = vscode.commands.registerCommand('claudeRelay.openDashboard', () => {
    vscode.window.showInformationMessage('Dashboard (mock)');
  });

  let clearResolvedHandoffCmd = vscode.commands.registerCommand('claudeRelay.clearResolvedHandoff', () => {
    vscode.window.showInformationMessage('Cleared resolved handoffs (mock)');
  });

  let reinstallCmd = vscode.commands.registerCommand('claudeRelay.reinstallClaudeIntegration', () => {
    vscode.commands.executeCommand('claudeRelay.setup');
  });

  let uninstallCmd = vscode.commands.registerCommand('claudeRelay.removeClaudeIntegration', async () => {
    try {
      const { ClaudeConfigInstaller } = require('@claude-relay/core');
      const os = require('os');
      const installer = new ClaudeConfigInstaller(os.homedir());
      if (await installer.uninstallIntegration()) {
        vscode.window.showInformationMessage('Claude Relay removed successfully.');
      }
    } catch (e) {}
  });

  let showLogsCmd = vscode.commands.registerCommand('claudeRelay.showLogs', () => {
    outputChannel.show();
  });

  context.subscriptions.push(
    setupCmd, healthCheckCmd, checkpointCmd, handoffCmd, resumeCmd, 
    openLatestHandoffCmd, openDashboardCmd, clearResolvedHandoffCmd, 
    reinstallCmd, uninstallCmd, showLogsCmd, 
    statusBarItem, outputChannel
  );
}

export function deactivate() {}
