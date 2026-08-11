# Claude Relay Security Model

## Threat Model & Mitigations

### 1. Accidental Secret Capture
- **Risk**: API keys, passwords, or tokens are captured in git diffs or handoff files.
- **Mitigation**: The core engine includes a `SecretRedactor` service that sanitizes outputs before saving. It uses regex patterns for known formats (AWS, JWT, GitHub, generic Bearer tokens). We do not save full diffs; we only save diff statistics and hashes.

### 2. Malicious Repository Content / Command Injection
- **Risk**: Filenames with shell metacharacters could trigger command injection when parsing git output.
- **Mitigation**: All Git operations use direct argument arrays (e.g., `spawn('git', ['status'])`) rather than shell interpolation. Semantic handoff commands are never executed directly.

### 3. Path Traversal & File Writes
- **Risk**: A crafted handoff attempts to overwrite arbitrary files on the user's system.
- **Mitigation**: Storage operations are strictly isolated to the `.relay` directory inside the workspace root. Paths are canonicalized and validated.

### 4. Malformed Configuration
- **Risk**: Modifying `~/.claude/settings.json` corrupts the user's setup.
- **Mitigation**: The config installer uses safe JSON parsing, merges iteratively, writes a backup timestamped file first, uses atomic writes, and rolls back on parsing errors.

### 5. Workspace Trust
- **Risk**: Running Claude Relay in an untrusted VS Code workspace triggers arbitrary behavior.
- **Mitigation**: The extension explicitly checks VS Code Workspace Trust before initializing the Relay engine or executing git commands.

### 6. DoS / Handoff Loops
- **Risk**: A hook continuously triggers handoffs, consuming disk space and CPU.
- **Mitigation**: The State Machine enforces cooldowns. A `HANDOFF_READY` state prevents further handoffs until the state returns to `IDLE` or `RESUMED`. Retention policies limit stored handoffs.
