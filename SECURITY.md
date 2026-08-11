# Security Policy

## Supported Versions
Currently only `v0.1.x` is actively supported.

## Vulnerability Reporting
Please report vulnerabilities privately via GitHub Security Advisories or by contacting the project maintainers directly (contact info TBD).

## Data Model & Privacy
Claude Relay is entirely local.
- No Claude authentication material is ever read.
- No private Anthropic APIs are called.
- No repository contents are uploaded.

## Protections
- Hook runtime uses secure schemas to isolate handoffs.
- Malicious semantic commands are not automatically executed.
- `.claude/settings.json` backups are automatically preserved.
