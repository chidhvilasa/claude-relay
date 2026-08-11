# CLAUDE RELAY v0.2 SECURITY ARCHITECTURE REVIEW

## A. Attack Surface Inventory

**Entry Points:**
1. **VS Code Extension Activation**: Triggered by VS Code on startup. (Trusted inputs: VS Code environment).
2. **VS Code Commands**: Triggered manually by user (Checkpoint, Handoff, Resume).
3. **Claude Hook Runner (Standalone)**: Triggered by Claude Code upon lifecycle events (`SessionStart`, `PreCompact`, etc.).
   - **Inputs**: STDIN JSON payload from Claude Code. (UNTRUSTED: `cwd`, `type`, etc.)
   - **Process Execution**: Spawns `git` to collect status.
   - **Filesystem Writes**: Writes to `.relay/checkpoints/` in `cwd`.
4. **Skill Invocation**: `/claude-relay:relay`. (Inputs: Claude LLM responses. UNTRUSTED).
5. **Legacy Migration**: Run via VS Code. Reads and modifies `~/.claude/settings.json`.

## B. Network Zero Audit
- **Result**: PASS. No networking libraries (`fetch`, `axios`, `http`, etc.) were found in the codebase. Relay operates completely locally and does not phone home or proxy requests.

## C. Authentication Zero Audit
- **Result**: PASS. Relay does not read `~/.claude/credentials`, does not intercept OAuth, and does not require Anthropic API keys.

## D. Hook Runtime Threat Model
- **Findings**: The `hook-runtime/src/index.ts` currently reads `cwd` from the untrusted STDIN JSON payload. It blindly uses `path.join(cwd, '.relay', 'checkpoints')` to write files. It uses `execSync('git rev-parse HEAD', { cwd })` which spawns a shell and could be abused if `cwd` is maliciously crafted (though Node limits `cwd` manipulation somewhat, it's safer to avoid `execSync`).

## E. Process Execution Audit
- **`git-provider.ts`**: Uses `spawn('git', args, { cwd: ... })` which defaults to `shell: false`. SAFE.
- **`hook-runtime/src/index.ts`**: Uses `execSync` which invokes a shell (`cmd.exe` or `sh`). UNSAFE (requires fix).
- **`plugin-detector.ts`**: Uses `execAsync('claude plugin list --json')`. SAFE (static string).

## F & G. Filesystem Boundary & Symlink Defense
- **Findings**: Symlink and traversal protection is currently MISSING in `hook-runtime`. Writing to a `.relay` symlink pointing to `/etc` or `C:\Windows` could allow arbitrary file overwrites given the untrusted `cwd` input from Claude Code.

## H & I. Data Minimization & Secret Handling
- **Findings**: The `.relay` checkpoint stores only `git.head`, `git.branch`, `git.isDirty`, and a basic schema. No source files, environment variables, or secrets are collected by the automated hook. Data collection is strictly minimized.

## J & K. Handoff Trust Model & Prompt Injection
- **Findings**: `SKILL.md` instructs Claude on the continuity process. It must explicitly state that WAKEUP files or handoffs are UNTRUSTED CONTEXT and not authoritative commands, to prevent a malicious repo from injecting a handoff that forces Claude to delete files.

## L. Git Safety Audit
- **Findings**: All Git interactions (`rev-parse`, `status`) are strictly READ-ONLY. No mutation commands (`commit`, `checkout`) exist in the codebase.

## M. Settings Migration Security
- **Findings**: The migration backs up the config, uses structural JSON parsing, precisely filters out `anthropic.claude-relay` entries, and preserves unrelated hooks safely.

## N. Plugin Supply Chain
- **Findings**: Marketplace manifests point to GitHub branches (`feature/...`). For stable releases, they must point to immutable release tags/commits to prevent supply chain attacks via branch poisoning.

## P. Plugin Privilege Minimization
- **Findings**: `SessionStart`, `PreCompact`, `PostCompact`, `Stop`, `StopFailure`, `SessionEnd`. All are currently included but only `PreCompact` and `StopFailure` carry the critical continuity data.

## Recommendations for v0.2 Release
1. Replace `execSync` in `hook-runtime` with `spawnSync({ shell: false })`.
2. Implement strict directory traversal and symlink/junction boundary checks in `hook-runtime` before calling `fs.writeFileSync`.
3. Add prompt injection warnings to `SKILL.md` explicitly defining handoff data as untrusted context.
4. Pin the marketplace distribution to immutable tags instead of branches.
