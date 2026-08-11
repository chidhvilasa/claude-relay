import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  test('Extension should be present', () => {
    assert.ok(vscode.extensions.getExtension('anthropic.claude-relay'));
  });

  test('Commands should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('claudeRelay.setup'));
    assert.ok(commands.includes('claudeRelay.healthCheck'));
    assert.ok(commands.includes('claudeRelay.checkpoint'));
    assert.ok(commands.includes('claudeRelay.handoff'));
    assert.ok(commands.includes('claudeRelay.resume'));
  });
});
