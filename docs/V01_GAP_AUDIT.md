# V0.1 Gap Audit

## 1. VS Code Extension (packages/vscode)
- **Commands**: `claudeRelay.setup`, `claudeRelay.healthCheck`, `claudeRelay.checkpoint`, `claudeRelay.handoff`, `claudeRelay.resume` are registered but **mocked** (only show informational messages). They do not invoke `@claude-relay/core`. [PARTIAL]
- **Dashboard**: Not implemented. [NOT_IMPLEMENTED]
- **Missing Commands**: `Open Latest Handoff`, `Clear Resolved Handoff`, `Reinstall Claude Integration`, `Remove Claude Integration`, `Show Logs` are missing. [NOT_IMPLEMENTED]

## 2. Core Engine (packages/core)
- **Schema Validation**: Schemas exist in `schemas/` but are never used at runtime to validate data boundaries (read/write). [NOT_IMPLEMENTED]
- **Storage**: `CheckpointStore` and `HandoffStore` read/write blindly without schema validation or integrity hashing checks on load. [PARTIAL]
- **Git Provider**: Does not gather upstream info or ahead/behind info. [PARTIAL]
- **Claude Config Installer**: Hardcodes an assumed hook path instead of the official `{ matcher: "", hooks: [{ type: "command", command: "..." }] }` format. Does not install a self-contained runtime. Lacks `uninstall` logic. [PARTIAL]

## 3. Claude Hooks
- **Hook Scripts**: No actual hook runner script exists to parse Claude's JSON `stdin` payloads and interact with the core. [NOT_IMPLEMENTED]

## 4. Testing
- **Unit Tests**: Package configuration exists for Vitest, but no actual test files exist. [NOT_IMPLEMENTED]
- **VS Code Integration Tests**: Missing entirely. [NOT_IMPLEMENTED]
- **Security Tests**: Missing entirely. [NOT_IMPLEMENTED]

## 5. Build and VSIX
- **VSIX Packaging**: Fails locally due to `pnpm` workspace security block on `esbuild`. [BLOCKED]
- **CI**: GitHub actions are missing. [NOT_IMPLEMENTED]

## 6. Documentation
- Missing `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE`, `VALIDATION_REPORT.md`. [NOT_IMPLEMENTED]
