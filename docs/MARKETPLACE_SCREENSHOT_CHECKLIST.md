# Marketplace Screenshot Checklist

Not captured automatically in this pass — screenshots require a human driving the real VS Code UI in a
demo workspace, and this audit does not fabricate them. Six scenarios, in order:

1. **Healthy Relay view** — dashboard showing plugin active, protection active, a recent checkpoint/
   handoff, and repository info, in a demo repo.
2. **Recovery available** — dashboard/resume view showing a fresh handoff with its freshness status.
3. **Create Checkpoint** — the command running, followed by the resulting `.relay/checkpoints/*.json`
   in the Explorer.
4. **History** — several checkpoints/handoffs listed (use the walkthrough or repeated manual actions to
   generate a few in the demo repo first).
5. **Health Check** — the health-check result message.
6. **Plugin setup/migration** — either the "Plugin not detected" first-run prompt, or the legacy-hooks
   migration prompt (trigger with a synthetic v0.1-style `~/.claude/settings.json` in an isolated
   `CLAUDE_CONFIG_DIR`, the same technique `packages/vscode/tests/legacy-migration.test.ts` uses).

**Before capturing, in the demo workspace:**
- Use a throwaway repo with a generic name (not a real project name from your machine).
- Confirm your VS Code username/file paths aren't visible in the window title or any visible path (use
  `code --user-data-dir <tmp>` in a folder outside your home directory, e.g. `C:\demo\claude-relay-demo`).
- No email, no OAuth screen, no token, no private repository content, in frame.
