# Supply Chain Security

## Stable Source Model
Claude Relay v0.2 adopts an **immutable stable release model**.
The `marketplace.json` uses the `repository.ref` field to strictly pin the plugin installation source to an immutable Git tag (`v0.2.0`).

Users will install from:
```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/chidhvilasa/claude-relay.git",
    "ref": "v0.2.0"
  }
}
```
This ensures production users are isolated from active development commits on `master` and protected from branch-based supply chain poisoning.

## GitHub Hardening Recommendations
To further secure the supply chain for the official `chidhvilasa/claude-relay` repository, we recommend enabling the following free protections:
1. **Branch Protection Rulesets**: Restrict direct pushes to `master`. Require Pull Requests with passing CI status checks.
2. **Secret Scanning**: Enable GitHub Advanced Security secret scanning to prevent accidental credential leakage in the codebase.
3. **Dependabot Alerts & Security Updates**: Automatically monitor Node.js package dependencies for vulnerabilities.
4. **Tag Protection**: Limit creation and deletion of `v*` tags to repository administrators.
