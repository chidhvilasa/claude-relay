import * as vscode from 'vscode';

/**
 * Resolves which workspace folder a Relay action should target.
 *
 * Relay state is per-project (`<repo>/.relay/`). In a multi-root workspace
 * there is no safe default folder to guess — silently picking the first one
 * risks writing a checkpoint/handoff into the wrong repository. So: zero
 * folders -> no target (caller must explain why the action is unavailable);
 * exactly one folder -> use it; more than one -> ask the user explicitly.
 */
export async function resolveTargetFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0];
  }

  const pick = await vscode.window.showQuickPick(
    folders.map(f => ({ label: f.name, description: f.uri.fsPath, folder: f })),
    { placeHolder: 'Multiple workspace folders are open — choose which repository this Relay action applies to' }
  );
  return pick?.folder;
}
