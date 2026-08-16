import * as vscode from 'vscode';
import { RelayDashboardProvider } from './dashboard';
import { PluginManager } from './integration/plugin-manager';
import { LegacyMigrator } from './integration/legacy-migrator';
import { RelayService } from './relay-service';
import { resolveTargetFolder } from './workspace-resolver';
import { AutomaticWakeConfigManager, WakeScope, WakeWriteResult } from '@claude-relay/core';

const INSTALL_INSTRUCTIONS =
  'claude plugin marketplace add chidhvilasa/claude-relay\nclaude plugin install claude-relay@clauderelay-oss';

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Claude Relay');
  outputChannel.appendLine('Claude Relay activated.');

  const dashboardProvider = new RelayDashboardProvider();
  const treeView = vscode.window.registerTreeDataProvider('claudeRelayDashboard', dashboardProvider);

  const pluginManager = new PluginManager();
  const migrator = new LegacyMigrator();
  const wakeManager = new AutomaticWakeConfigManager();

  // A RelayService is created per-command against the folder the user picks
  // (or the sole folder, if unambiguous) rather than cached once at
  // activation, so a manual action in a multi-root workspace never silently
  // targets the wrong repository.
  async function getService(): Promise<RelayService | undefined> {
    const folder = await resolveTargetFolder();
    if (!folder) {
      if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('Claude Relay: open a folder or workspace first — there is no project to act on.');
      }
      return undefined;
    }
    return new RelayService(folder.uri.fsPath);
  }

  function log(message: string) {
    outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  async function checkStartupStatus() {
    const status = await pluginManager.getOverallStatus();
    log(`Plugin status: ${status}`);
    if (status === 'PLUGIN_AND_LEGACY_CONFLICT' || status === 'LEGACY_INTEGRATION') {
      vscode.window.showWarningMessage(
        'Claude Relay: Legacy v0.1 hooks detected.',
        'Migrate to Plugin', 'Dismiss'
      ).then(async selection => {
        if (selection === 'Migrate to Plugin') {
          const result = await migrator.migrate();
          pluginManager.invalidate();
          if (result.success) {
            vscode.window.showInformationMessage(`Successfully migrated to Claude Relay Plugin format. Please run:\n${INSTALL_INSTRUCTIONS}`);
            dashboardProvider.refresh();
          } else {
            vscode.window.showErrorMessage('Migration failed: ' + result.error);
            log(`Migration failed: ${result.error}`);
          }
        }
      });
    } else if (status === 'NOT_INSTALLED') {
      vscode.window.showInformationMessage(
        'Claude Relay Plugin not detected. Automatic protection is unavailable.',
        'How to Install', 'Dismiss'
      ).then(selection => {
        if (selection === 'How to Install') {
          vscode.window.showInformationMessage(`Run:\n${INSTALL_INSTRUCTIONS}`);
        }
      });
    }
    return status;
  }

  const setupCmd = vscode.commands.registerCommand('claudeRelay.setup', async () => {
    const choice = await vscode.window.showInformationMessage(
      `Install the Claude Relay Plugin for automatic protection:\n${INSTALL_INSTRUCTIONS}`,
      'Copy Commands', 'Re-check Status'
    );
    if (choice === 'Copy Commands') {
      await vscode.env.clipboard.writeText(INSTALL_INSTRUCTIONS);
      vscode.window.showInformationMessage('Install commands copied to clipboard.');
    } else if (choice === 'Re-check Status') {
      pluginManager.invalidate();
      await checkStartupStatus();
      dashboardProvider.refresh();
    }
  });

  function describeWakeStatus(folder: vscode.WorkspaceFolder | undefined): string {
    const userStatus = wakeManager.getStatus('user');
    const workspaceStatus = folder ? wakeManager.getStatus('workspace', folder.uri.fsPath) : { configured: false, values: {} };
    if (!userStatus.configured && !workspaceStatus.configured) return 'Automatic Wake: Off';
    const scope = workspaceStatus.configured ? 'this workspace' : 'all workspaces';
    // "configured" only means the env keys are written to a settings file —
    // it does not prove the currently running Claude Code process actually
    // reads them the way docs/AUTOMATIC_WAKE_OFFICIAL_CAPABILITIES.md
    // describes (that mechanism is undocumented and version-dependent).
    // Health Check must not claim more certainty than that.
    return `Automatic Wake: Configured (${scope}, Level 1 only — undocumented mechanism, not independently verified as active in the current session)`;
  }

  const healthCheckCmd = vscode.commands.registerCommand('claudeRelay.healthCheck', async () => {
    pluginManager.invalidate();
    const currentStatus = await pluginManager.getOverallStatus();
    log(`Health check: plugin status = ${currentStatus}`);

    const folder = vscode.workspace.workspaceFolders?.[0];
    let recoveryLine = 'No workspace open';
    if (folder) {
      try {
        const service = new RelayService(folder.uri.fsPath);
        const [checkpoint, handoff] = await Promise.all([service.getLatestCheckpoint(), service.getLatestHandoff()]);
        recoveryLine = `Last checkpoint: ${checkpoint ? checkpoint.createdAt : 'none'}; Last handoff: ${handoff ? handoff.createdAt : 'none'}`;
      } catch (e: any) {
        recoveryLine = `Recovery state check failed: ${e.message}`;
        log(`Health check recovery-state error: ${e.message}`);
      }
    }

    const wakeLine = describeWakeStatus(folder);
    log(`Health check: ${wakeLine}`);
    vscode.window.showInformationMessage(`Claude Relay — Plugin: ${currentStatus} | ${recoveryLine} | ${wakeLine}`);
    dashboardProvider.refresh();
  });

  const enableWakeCmd = vscode.commands.registerCommand('claudeRelay.enableAutomaticWake', async () => {
    const folder = await resolveTargetFolder();
    const choices: Array<{ label: string; scope: WakeScope | null }> = [
      { label: 'This Workspace', scope: 'workspace' },
      { label: 'All Workspaces (user-wide)', scope: 'user' },
      { label: 'Cancel', scope: null },
    ];
    if (!folder) choices.splice(0, 1); // no workspace open -> can't scope to "this workspace"

    const pick = await vscode.window.showQuickPick(
      choices.map(c => c.label),
      {
        placeHolder: 'Enable Automatic Wake for…',
        title: 'Automatic Wake allows an interrupted Claude task to continue after usage becomes ' +
          'available again. Claude Code\'s normal permission rules remain active — Relay never enables ' +
          'bypassPermissions. This relies on an undocumented Claude Code mechanism (see ' +
          'docs/AUTOMATIC_WAKE_OFFICIAL_CAPABILITIES.md); Level 1 only (same live process).',
      }
    );
    const choice = choices.find(c => c.label === pick);
    if (!choice || !choice.scope) return;

    const result = wakeManager.enable(choice.scope, folder?.uri.fsPath);
    log(`Automatic Wake enable (${choice.scope}): ${result.success ? 'success' : result.error}`);
    if (result.success) {
      vscode.window.showInformationMessage(`Claude Relay: Automatic Wake enabled (${choice.label}).`);
    } else {
      vscode.window.showErrorMessage(`Claude Relay: Failed to enable Automatic Wake — ${result.error}`);
    }
  });

  const disableWakeCmd = vscode.commands.registerCommand('claudeRelay.disableAutomaticWake', async () => {
    const folder = await resolveTargetFolder();
    const choices: Array<{ label: string; scope: WakeScope | null }> = [
      { label: 'This Workspace', scope: 'workspace' },
      { label: 'All Workspaces (user-wide)', scope: 'user' },
      { label: 'Both', scope: null },
      { label: 'Cancel', scope: undefined as unknown as null },
    ];
    if (!folder) choices.splice(0, 1);

    const pick = await vscode.window.showQuickPick(choices.map(c => c.label), { placeHolder: 'Disable Automatic Wake for…' });
    if (pick === undefined || pick === 'Cancel') return;

    const results: WakeWriteResult[] = [];
    if (pick === 'Both') {
      if (folder) results.push(wakeManager.disable('workspace', folder.uri.fsPath));
      results.push(wakeManager.disable('user'));
    } else {
      const choice = choices.find(c => c.label === pick);
      if (choice?.scope) results.push(wakeManager.disable(choice.scope, folder?.uri.fsPath));
    }

    const failed = results.find(r => !r.success);
    log(`Automatic Wake disable: ${failed ? failed.error : 'success'}`);
    if (failed) {
      vscode.window.showErrorMessage(`Claude Relay: Failed to disable Automatic Wake — ${failed.error}`);
    } else {
      vscode.window.showInformationMessage('Claude Relay: Automatic Wake disabled.');
    }
  });

  const showWakeDiagnosticsCmd = vscode.commands.registerCommand('claudeRelay.showWakeDiagnostics', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    outputChannel.appendLine('--- Automatic Wake Diagnostics ---');
    outputChannel.appendLine(describeWakeStatus(folder));
    const userStatus = wakeManager.getStatus('user');
    outputChannel.appendLine(`User scope configured: ${userStatus.configured}`);
    if (folder) {
      const wsStatus = wakeManager.getStatus('workspace', folder.uri.fsPath);
      outputChannel.appendLine(`Workspace scope configured: ${wsStatus.configured}`);
    }
    outputChannel.appendLine('See docs/AUTOMATIC_WAKE_OFFICIAL_CAPABILITIES.md for what these settings do and their limits.');
    outputChannel.show();
  });

  const checkpointCmd = vscode.commands.registerCommand('claudeRelay.checkpoint', async () => {
    const service = await getService();
    if (!service) return;
    try {
      const checkpoint = await service.createCheckpoint('manual');
      log(`Checkpoint created: ${checkpoint.id}`);
      vscode.window.showInformationMessage(`Claude Relay: Checkpoint saved (${checkpoint.git.branch}@${checkpoint.git.head.slice(0, 8)}).`);
      dashboardProvider.refresh();
    } catch (e: any) {
      log(`Checkpoint failed: ${e.message}`);
      vscode.window.showErrorMessage(`Claude Relay: Checkpoint failed — ${e.message}`);
    }
  });

  const handoffCmd = vscode.commands.registerCommand('claudeRelay.handoff', async () => {
    const service = await getService();
    if (!service) return;

    const objective = await vscode.window.showInputBox({
      prompt: 'What is the objective of this session? (deterministic handoff — no AI required)',
      placeHolder: 'e.g. Fix the login redirect bug',
    });
    if (objective === undefined) return; // cancelled

    const nextAction = await vscode.window.showInputBox({
      prompt: 'What is the exact next action for whoever resumes this?',
      placeHolder: 'e.g. Add a test for the redirect edge case, then run the suite',
    });
    if (nextAction === undefined) return; // cancelled

    try {
      const handoff = await service.createHandoff(objective || 'Manual handoff', nextAction || 'Not specified', 'manual');
      log(`Handoff created: ${handoff.id}`);
      vscode.window.showInformationMessage('Claude Relay: Handoff saved to .relay/handoffs and .relay/WAKEUP.md.', 'Open').then(sel => {
        if (sel === 'Open') vscode.commands.executeCommand('claudeRelay.openLatestHandoff');
      });
      dashboardProvider.refresh();
    } catch (e: any) {
      log(`Handoff failed: ${e.message}`);
      vscode.window.showErrorMessage(`Claude Relay: Handoff failed — ${e.message}`);
    }
  });

  const resumeCmd = vscode.commands.registerCommand('claudeRelay.resume', async () => {
    const service = await getService();
    if (!service) return;
    try {
      const handoff = await service.getLatestHandoff();
      if (!handoff) {
        vscode.window.showInformationMessage('Claude Relay: No handoff found for this project.');
        return;
      }
      const freshness = await service.evaluateFreshness(handoff);
      const instruction = await service.buildResumeInstruction(handoff);
      log(`Resume: handoff ${handoff.id} freshness=${freshness}`);

      const doc = await vscode.workspace.openTextDocument({ content: instruction, language: 'markdown' });
      await vscode.window.showTextDocument(doc, { preview: false });

      if (freshness === 'STALE' || freshness === 'POSSIBLY_STALE' || freshness === 'INVALID') {
        vscode.window.showWarningMessage(`Claude Relay: Recovery Available — Needs Reconciliation (${freshness}).`);
      } else {
        vscode.window.showInformationMessage('Claude Relay: Recovery Available (fresh).');
      }
    } catch (e: any) {
      log(`Resume failed: ${e.message}`);
      vscode.window.showErrorMessage(`Claude Relay: Resume failed — ${e.message}`);
    }
  });

  const openLatestHandoffCmd = vscode.commands.registerCommand('claudeRelay.openLatestHandoff', async () => {
    const folder = await resolveTargetFolder();
    if (!folder) return;
    const wakeupUri = vscode.Uri.joinPath(folder.uri, '.relay', 'WAKEUP.md');
    try {
      const doc = await vscode.workspace.openTextDocument(wakeupUri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch {
      vscode.window.showInformationMessage('Claude Relay: No handoff found for this project yet.');
    }
  });

  const openDashboardCmd = vscode.commands.registerCommand('claudeRelay.openDashboard', async () => {
    await vscode.commands.executeCommand('claudeRelayDashboard.focus');
    dashboardProvider.refresh();
  });

  const clearResolvedHandoffCmd = vscode.commands.registerCommand('claudeRelay.clearResolvedHandoff', async () => {
    const service = await getService();
    if (!service) return;
    const handoff = await service.getLatestHandoff();
    if (!handoff) {
      vscode.window.showInformationMessage('Claude Relay: No active handoff to clear.');
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Mark the handoff from ${handoff.createdAt} as resolved? It will move to .relay/history.`,
      { modal: true }, 'Clear Handoff'
    );
    if (confirm !== 'Clear Handoff') return;
    await service.clearResolvedHandoff(handoff.id);
    log(`Handoff ${handoff.id} marked resolved.`);
    vscode.window.showInformationMessage('Claude Relay: Handoff cleared.');
    dashboardProvider.refresh();
  });

  const reinstallClaudeIntegrationCmd = vscode.commands.registerCommand('claudeRelay.reinstallClaudeIntegration', async () => {
    // Claude Relay 0.2 no longer injects hooks itself — hooks come from the
    // Claude Relay Plugin. "Reinstall" therefore re-checks plugin status and
    // re-surfaces install guidance rather than mutating settings.json.
    pluginManager.invalidate();
    const status = await checkStartupStatus();
    dashboardProvider.refresh();
    if (status === 'INSTALLED') {
      vscode.window.showInformationMessage('Claude Relay: Plugin integration verified.');
    }
  });

  const removeClaudeIntegrationCmd = vscode.commands.registerCommand('claudeRelay.removeClaudeIntegration', async () => {
    const confirm = await vscode.window.showWarningMessage(
      'Remove Claude Relay\'s legacy v0.1 hooks from your global Claude settings.json? A timestamped backup is created first. This does not uninstall the Claude Relay Plugin.',
      { modal: true }, 'Remove'
    );
    if (confirm !== 'Remove') return;
    const result = await migrator.migrate();
    pluginManager.invalidate();
    if (result.success) {
      vscode.window.showInformationMessage('Claude Relay: Legacy integration removed.');
      log('Legacy integration removed via removeClaudeIntegration.');
    } else {
      vscode.window.showErrorMessage(`Claude Relay: Removal failed — ${result.error}`);
      log(`Removal failed: ${result.error}`);
    }
    dashboardProvider.refresh();
  });

  const showLogsCmd = vscode.commands.registerCommand('claudeRelay.showLogs', () => {
    outputChannel.show();
  });

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(sync~spin) Relay: Ready';
  statusBarItem.tooltip = 'Claude Relay Status';
  statusBarItem.command = 'claudeRelay.healthCheck';
  statusBarItem.show();

  context.subscriptions.push(
    treeView,
    setupCmd, healthCheckCmd, checkpointCmd, handoffCmd, resumeCmd,
    openLatestHandoffCmd, openDashboardCmd, clearResolvedHandoffCmd,
    reinstallClaudeIntegrationCmd, removeClaudeIntegrationCmd, showLogsCmd,
    enableWakeCmd, disableWakeCmd, showWakeDiagnosticsCmd,
    statusBarItem, outputChannel
  );

  // Every command above is registered synchronously before this point, so
  // they're available immediately regardless of how long plugin detection
  // takes. checkStartupStatus() shells out to the `claude` CLI (bounded by a
  // 5s timeout, but not instant) — deliberately not awaited here, so a slow
  // or hanging CLI delays only the startup notification, never command
  // availability. (Previously this was awaited before any command was
  // registered, so every Claude Relay command was "command not found" for
  // however long that check took — caught by the extension-host test
  // suite, not assumed.)
  checkStartupStatus().catch(e => log(`Startup status check failed: ${e.message}`));
}

export function deactivate() {}
