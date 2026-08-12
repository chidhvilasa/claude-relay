import * as assert from 'assert';
import * as vscode from 'vscode';

const DECLARED_COMMANDS = [
  'claudeRelay.setup',
  'claudeRelay.healthCheck',
  'claudeRelay.checkpoint',
  'claudeRelay.handoff',
  'claudeRelay.resume',
  'claudeRelay.openLatestHandoff',
  'claudeRelay.openDashboard',
  'claudeRelay.clearResolvedHandoff',
  'claudeRelay.reinstallClaudeIntegration',
  'claudeRelay.removeClaudeIntegration',
  'claudeRelay.showLogs',
];

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  test('Extension should be present', () => {
    const ext = vscode.extensions.getExtension('clauderelay-oss.claude-relay');
    assert.ok(ext);
  });

  test('Every command declared in package.json is registered (no "command not found")', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of DECLARED_COMMANDS) {
      assert.ok(commands.includes(id), `Command "${id}" is declared in package.json but not registered`);
    }
  });

  test('Dashboard tree view is registered', async () => {
    // registerTreeDataProvider succeeding at activation (no throw) is what
    // this proves indirectly: if activation failed, the extension wouldn't
    // report active, and the '<viewId>.focus' command VS Code auto-generates
    // for a contributed view wouldn't exist either.
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('claudeRelayDashboard.focus'), 'claudeRelayDashboard view was not registered');
  });

  test('Extension activates without throwing', async () => {
    const ext = vscode.extensions.getExtension('clauderelay-oss.claude-relay');
    assert.ok(ext);
    if (!ext!.isActive) {
      await ext!.activate();
    }
    assert.strictEqual(ext!.isActive, true);
  });
});
