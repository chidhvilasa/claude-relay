# Claude Relay: Plugin Install Validation

## Plugin & Marketplace Discovery

Through direct validation of the Claude Code CLI (`2.1.217`), the following commands and behaviors were confirmed:

### 1. Plugin CLI Commands
- `claude plugin list --json` provides a stable, machine-readable JSON array of installed plugins.
  - Example output object:
    ```json
    {
      "id": "test-relay@skills-dir",
      "version": "0.1.0",
      "scope": "user",
      "enabled": true,
      "installPath": "C:\\Users\\chidh\\.claude\\skills\\test-relay"
    }
    ```
- `claude plugin install <plugin>@<marketplace>` or `claude plugin install <path>` are supported.

### 2. Marketplace Installation
- `claude plugin marketplace add <source>` accepts a URL, local path, or GitHub repository.
- When pointing at a GitHub repository, Claude Code looks for `.claude-plugin/marketplace.json` at the root of the repository.
- Monorepos are supported natively via Git sparse-checkout: `claude plugin marketplace add chidhvilasa/claude-relay --sparse .claude-plugin plugins/claude-relay`

### 3. Local Development Validation
- `claude plugin init <name>` scaffolds a plugin directly into `~/.claude/skills/<name>`.
- The scaffolding confirms the schema:
  - `<root>/.claude-plugin/plugin.json` is the manifest.
  - `<root>/skills/<name>/SKILL.md` is the semantic entry point.

### 4. Verified Commands for Claude Relay
**Local Testing:**
```bash
claude plugin install ./plugins/claude-relay
```

**Marketplace Testing (Post-Release):**
```bash
claude plugin marketplace add chidhvilasa/claude-relay
claude plugin install claude-relay@claude-relay
```
