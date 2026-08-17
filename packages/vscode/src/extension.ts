import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { RelayDashboardProvider } from './dashboard';
import { PluginManager } from './integration/plugin-manager';
import { LegacyMigrator } from './integration/legacy-migrator';
import { RelayService } from './relay-service';
import { resolveTargetFolder } from './workspace-resolver';
import { MINIMUM_HEALTHY_PLUGIN_VERSION } from './integration/plugin-version';

const execAsync = promisify(exec);

const INSTALL_INSTRUCTIONS =
  'claude plugin marketplace add chidhvilasa/claude-relay\nclaude plugin install claude-relay@clauderelay-oss';

// Fixed, fully-literal command strings — never built from user/repo input,
// so there is nothing to inject despite exec() going through a shell. Same
// justification, same precedent, as plugin-detector.ts's
// CLAUDE_PLUGIN_LIST_COMMAND: execFile/spawn with shell:false cannot reach a
// `claude.cmd` npm shim on Windows at all (EINVAL, Node's CVE-2024-27980
// fix), and there is no per-invocation variable content here that a shell
// could misinterpret.
const UPDATE_PLUGIN_COMMAND = 'claude plugin update claude-relay@clauderelay-oss';
const CLAUDE_CLI_TIMEOUT_MS = 30000; // plugin update may re-fetch from the marketplace source; longer than the 5s status-check timeout
const MAX_STDOUT_BYTES = 1 * 1024 * 1024;

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Claude Relay');
  outputChannel.appendLine('Claude Relay activated.');

  const dashboardProvider = new RelayDashboardProvider();
  const treeView = vscode.window.registerTreeDataProvider('claudeRelayDashboard', dashboardProvider);

  const pluginManager = new PluginManager();
  const migrator = new LegacyMigrator();

  // Created early (moved up from the end of activate()) so checkStartupStatus()
  // and the update-plugin flow can update its text as soon as they know
  // something worth reflecting — not just a static "Ready" placeholder.
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(sync~spin) Relay: Ready';
  statusBarItem.tooltip = 'Claude Relay Status';
  statusBarItem.command = 'claudeRelay.healthCheck';
  statusBarItem.show();

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

  // Shown at most once per VS Code window session (this flag lives only in
  // memory, reset on every activation) — Part 24's "no repeated popup spam,"
  // without needing a persistent-dismissal store for a warning that should
  // stay visible in Health Check regardless.
  let outdatedPluginNoticeShown = false;

  // Deliberately small and static (Part 26): Relay ✓ / Relay: Update Plugin /
  // Relay: Manual / Relay: Recovery / Relay: Error. No Automatic Wake states
  // in 0.2.3 — that's v0.3-only.
  function updateStatusBar(status: string, health: string) {
    if (health === 'PLUGIN_OUTDATED') {
      statusBarItem.text = '$(warning) Relay: Update Plugin';
    } else if (status === 'INSTALLED') {
      statusBarItem.text = '$(check) Relay ✓';
    } else if (status === 'NOT_INSTALLED') {
      statusBarItem.text = '$(circle-outline) Relay: Manual';
    } else if (status === 'PLUGIN_AND_LEGACY_CONFLICT' || status === 'LEGACY_INTEGRATION') {
      statusBarItem.text = '$(sync) Relay: Recovery';
    } else {
      statusBarItem.text = '$(error) Relay: Error';
    }
  }

  async function checkStartupStatus() {
    const status = await pluginManager.getOverallStatus();
    log(`Plugin status: ${status}`);

    const { health, version } = await pluginManager.getPluginHealth();
    updateStatusBar(status, health);

    if (status === 'INSTALLED' && !outdatedPluginNoticeShown) {
      if (health === 'PLUGIN_OUTDATED') {
        outdatedPluginNoticeShown = true;
        log(`Plugin update required: installed ${version}, minimum healthy ${MINIMUM_HEALTHY_PLUGIN_VERSION}`);
        vscode.window.showWarningMessage(
          'Claude Relay Plugin update required. Your installed Plugin version may miss automatic lifecycle checkpoints. ' +
          'Update to continue using automatic protection reliably.',
          'Update Plugin', 'Learn More', 'Dismiss'
        ).then(selection => {
          if (selection === 'Update Plugin') vscode.commands.executeCommand('claudeRelay.updatePlugin');
          else if (selection === 'Learn More') {
            vscode.window.showInformationMessage(
              `Installed Plugin version: ${version ?? 'unknown'}. Minimum healthy version: ${MINIMUM_HEALTHY_PLUGIN_VERSION}. ` +
              'Older versions can silently miss SessionStart/PreCompact/StopFailure hook events, so automatic checkpoints stop working ' +
              'without any visible error.'
            );
          }
        });
      }
    }

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

  function describePluginHealthLine(health: string, version: string | undefined): string {
    switch (health) {
      case 'PLUGIN_HEALTHY': return `Plugin: v${version} (up to date)`;
      case 'PLUGIN_OUTDATED': return `Plugin: v${version} (update required — minimum v${MINIMUM_HEALTHY_PLUGIN_VERSION})`;
      case 'PLUGIN_DISABLED': return 'Plugin: installed but disabled';
      case 'PLUGIN_MISSING': return 'Plugin: not installed';
      default: return 'Plugin: version unknown';
    }
  }

  const healthCheckCmd = vscode.commands.registerCommand('claudeRelay.healthCheck', async () => {
    pluginManager.invalidate();
    const currentStatus = await pluginManager.getOverallStatus();
    const { health, version } = await pluginManager.getPluginHealth();
    log(`Health check: plugin status = ${currentStatus}, health = ${health}, version = ${version ?? 'unknown'}`);

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

    const pluginLine = describePluginHealthLine(health, version);
    vscode.window.showInformationMessage(`Claude Relay — ${pluginLine} | ${recoveryLine}`);
    dashboardProvider.refresh();
  });

  const updatePluginCmd = vscode.commands.registerCommand('claudeRelay.updatePlugin', async () => {
    // Explicit, user-triggered action only (Part 21) — never run automatically.
    log('User triggered: Update Plugin');
    vscode.window.showInformationMessage('Claude Relay: Updating Plugin…');
    try {
      const { stdout, stderr } = await execAsync(UPDATE_PLUGIN_COMMAND, { timeout: CLAUDE_CLI_TIMEOUT_MS, maxBuffer: MAX_STDOUT_BYTES });
      log(`Plugin update output: ${stdout.trim()}${stderr.trim() ? ` | stderr: ${stderr.trim()}` : ''}`);
      pluginManager.invalidate();
      const { health, version } = await pluginManager.getPluginHealth();
      updateStatusBar(await pluginManager.getOverallStatus(), health);
      if (health === 'PLUGIN_HEALTHY') {
        outdatedPluginNoticeShown = true; // don't re-show the outdated notice for a version we just confirmed is healthy
        vscode.window.showInformationMessage(
          `Claude Relay Plugin updated (now v${version}). Run /reload-plugins in Claude Code, or start a new Claude Code session, if the updated plugin is not active yet.`
        );
      } else {
        // The update command reported success, but re-detection doesn't
        // agree yet — don't claim live activation without verifying it.
        vscode.window.showInformationMessage(
          'Claude Relay: Plugin update command completed. Run /reload-plugins in Claude Code, or start a new Claude Code session, to pick up the change.'
        );
      }
      dashboardProvider.refresh();
    } catch (e: any) {
      log(`Plugin update failed: ${e.message}`);
      vscode.window.showErrorMessage(`Claude Relay: Plugin update failed — ${e.message}`);
    }
  });

  const pluginAutoUpdateHelpCmd = vscode.commands.registerCommand('claudeRelay.pluginAutoUpdateHelp', async () => {
    // Never edits Claude's marketplace config directly (Part 23) — shows the
    // official, user-driven steps only.
    vscode.window.showInformationMessage(
      'To enable automatic Plugin updates:\n' +
      '1. Open Claude Code\n' +
      '2. Run /plugin\n' +
      '3. Open Marketplaces\n' +
      '4. Select clauderelay-oss\n' +
      '5. Choose "Enable auto-update"\n\n' +
      'Claude Code then handles Relay Plugin updates through its own marketplace updater. ' +
      'The Companion works fine either way — this just controls whether Plugin updates happen automatically.'
    );
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

  context.subscriptions.push(
    treeView,
    setupCmd, healthCheckCmd, checkpointCmd, handoffCmd, resumeCmd,
    openLatestHandoffCmd, openDashboardCmd, clearResolvedHandoffCmd,
    reinstallClaudeIntegrationCmd, removeClaudeIntegrationCmd, showLogsCmd,
    updatePluginCmd, pluginAutoUpdateHelpCmd,
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
