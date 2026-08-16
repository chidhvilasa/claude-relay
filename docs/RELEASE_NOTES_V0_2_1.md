# Claude Relay VS Code Companion v0.2.1

**Correction (recorded during the discoverability/reliability audit that produced v0.2.2):** an earlier
draft of these notes claimed dashboard UX improvements, plugin-detector hardening, reduced CLI polling,
and webview security hardening (CSP, HTML escaping, validated messages). None of that is accurate.
`git diff v0.2.0 v0.2.1` shows the actual change was:

- `packages/vscode/package.json`: version bump `0.2.0` → `0.2.1` only.
- `docs/VS_CODE_COMPANION_AUDIT.md`: added (itself inaccurate at the time — see its current revision).

v0.2.1 shipped no functional changes. It exists as a Marketplace publish checkpoint. The dashboard in
v0.2.1 is (and was in v0.2.0) a native `TreeDataProvider`, not a webview — there has never been a webview
in this extension, so none of the claimed webview hardening was ever applicable.

The functional and metadata fixes originally attributed to v0.2.1 are the real content of v0.2.2 — see
`docs/RELEASE_NOTES_V0_2_2.md`.

### Compatibility
Compatible with: Claude Relay Plugin v0.2.0
