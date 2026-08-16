# Claude Relay

Session continuity, recovery, checkpoints, and handoffs for Claude Code.

Claude Relay preserves deterministic project state — branch, commit, dirty files — plus an optional
human-written handoff, so a new Claude Code session (or a teammate) can understand where work stopped
instead of starting cold.

```text
Claude Code Session
        │
        ├── SessionStart
        ├── PreCompact
        └── StopFailure
                 │
                 ▼
        Claude Relay Plugin  (automatic — owns the hooks above)
                 │
                 ▼
             .relay/  ◄──────────────┐
                 │                   │
                 ▼                   │
          Shared Relay Core          │
        (@claude-relay/core)         │
                                      │
                     VS Code Companion (manual — dashboard, history, setup)
```

## Install

### Recommended: Claude Plugin + VS Code Companion

**Claude Relay Plugin** — automatic lifecycle protection (`SessionStart`/`PreCompact`/`StopFailure`).
**Claude Relay (VS Code)** — dashboard, recovery history, manual checkpoint/handoff, diagnostics.

**1. VS Code:** search **Claude Relay** in the Extensions view (publisher `clauderelay-oss`) and install,
or use the [Marketplace page](https://marketplace.visualstudio.com/items?itemName=clauderelay-oss.claude-relay)
directly. If search hasn't picked it up yet, install by exact ID as a fallback:
```bash
code --install-extension clauderelay-oss.claude-relay
```

**2. Claude Plugin:**
```bash
claude plugin marketplace add chidhvilasa/claude-relay
claude plugin install claude-relay@clauderelay-oss
```

Then open the **Claude Relay** view in the Activity Bar and run **Health Check**.

### Claude Plugin only
For Claude Code terminal/IDE users who want automatic continuity without the VS Code dashboard, just
step 2 above.

### VS Code Companion only
Manual checkpoint/handoff/resume, still works. Automatic protection between sessions requires the plugin.
Just step 1 above.

A VSIX is also attached to each [GitHub Release](https://github.com/chidhvilasa/claude-relay/releases) as
a manual/offline fallback — the Marketplace install above is the normal path.

## Security
- **No auth**: Claude Relay handles zero authentication and has no access to Claude credentials.
- **No network**: Relay runs entirely offline against your local Git repository and `.relay/` folder.
- **Untrusted state**: restored checkpoints and handoffs are treated strictly as untrusted historical
  context — a lead to verify, never a command to execute automatically.

See `docs/HOW_CLAUDE_RELAY_WORKS.md` for the full account, including exactly what does *not* happen.

## Migration
Upgrading from v0.1.0? Your existing `.relay` history is compatible. The VS Code extension detects
legacy hooks in `~/.claude/settings.json` and offers to migrate them to the Plugin structure (with a
backup, and only removing the hooks Relay itself owns).

## Known limitations
Relay covers deterministic Git state and semantic handoff text. It does not restore terminal history,
open editor state, or anything outside what Claude Code and Git themselves expose.

---

*Claude Relay is an independent open-source project and is not affiliated with or endorsed by Anthropic.*
