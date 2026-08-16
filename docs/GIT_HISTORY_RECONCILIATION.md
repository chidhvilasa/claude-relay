# Git History Reconciliation

Captured via `git fetch --all --tags --prune` + `git ls-remote` against `origin` (not from cached
tracking refs) on 2026-08-12. All hashes below are verified, not assumed.

## Correction to the prior audit

The previous audit session claimed "v0.2.0 and v0.2.1 ... were apparently never pushed." **That was
wrong**, and this document exists specifically to replace that claim with verified fact: the tags, and
every commit reachable from them, are present on `origin`. What's actually true is narrower and less
alarming: the `master` **branch ref** on origin was never fast-forwarded past `v0.1.0`, even though the
`v0.2.0` and `v0.2.1` **tags** (and their full commit history) were pushed directly and are public on
GitHub right now.

## Verified commit identity

| Ref | Commit | On origin? |
|---|---|---|
| `v0.1.0` | `e4c163b585ce613d6fff7dcbaa09fe7dd61cac79` | Yes — `git ls-remote --tags origin` confirms `refs/tags/v0.1.0^{}` = this hash |
| `v0.2.0` | `8f1f560d2d34788d54b74d0898f6ad5c641ff480` | Yes — `refs/tags/v0.2.0^{}` matches |
| `v0.2.1` | `9042c086b08ac77720f1533b2152a4603175fe68` | Yes — `refs/tags/v0.2.1^{}` matches |
| `origin/master` (branch ref) | `9074a51f970c5936743d27d65220c672c2765ecf` | This *is* origin's current `master` — it predates all three tags above |
| local `master` | `9042c086b08ac77720f1533b2152a4603175fe68` | Identical to `v0.2.1` (local `master` currently points at the v0.2.1 commit) |
| `fix/vscode-discoverability-reliability` | `5191d4fcb43c30acfbeacc0816cfecda6721a64d` | Yes, pushed and up to date with origin |

## Ancestry (verified via `git merge-base --is-ancestor`)

```
origin/master (9074a51)
   └─ is an ancestor of ─→ v0.2.0 (8f1f560)
        └─ is an ancestor of ─→ v0.2.1 (9042c08) = local master
             └─ is an ancestor of ─→ fix/vscode-discoverability-reliability (5191d4f)
```

Every arrow above was individually confirmed true and its reverse false. There is no divergence anywhere
in this chain — `origin/master`, `v0.2.0`, `v0.2.1`, local `master`, and the fix branch form a single
straight line, in that order. `git merge-base origin/master fix/vscode-discoverability-reliability`
returns `9074a51` itself (origin/master's own tip), which is the algebraic proof of a clean fast-forward:
the merge base of the two branches is one of the branches' own tips.

## Answers to the specific questions

- Does `origin/master` contain the v0.2.1 release commit? **No** (that's the actual, narrower problem —
  the branch ref is stale, not that the release is missing from GitHub).
- Does the fix branch contain v0.2.0? **Yes.**
- Does the fix branch contain v0.2.1? **Yes.**
- Is v0.2.1 reachable from local master? **Yes — they're the same commit.**
- Is v0.2.1 reachable from origin/master? **No**, for the same reason as above.
- Is the fix branch a descendant of v0.2.1? **Yes**, directly (`git branch --contains v0.2.1` lists only
  `master` and `fix/vscode-discoverability-reliability`).
- Did histories diverge? **No.** There is no fork/divergence to reconcile — this is purely a matter of
  `origin/master` never having been moved forward, not conflicting or incompatible history.

## Safe reconciliation strategy

Because `origin/master` is a strict ancestor of the fix branch with no divergence, merging
`fix/vscode-discoverability-reliability` → `master` (via a normal PR) and then updating `origin/master`
to the merge result is a **pure fast-forward at the origin/master level, or at worst a standard merge
commit** — never a rewrite, never a force push, and it does not move `v0.1.0`, `v0.2.0`, or `v0.2.1`,
which stay exactly where they are.

**Force push required: NO.**

Recommended path once the release gates in `docs/RELEASE_NOTES_V0_2_2.md`/this task's report pass:
1. Open a PR: `fix/vscode-discoverability-reliability` → `master` on GitHub.
2. Merge normally (merge commit or fast-forward, either is safe here — no rebase needed since there's
   nothing to replay against, the branch is already a linear descendant).
3. `origin/master` then contains the full, real v0.2.0 → v0.2.1 → v0.2.2 history for the first time.
4. Tag `v0.2.2` only after that merge, from the merged `master` tip — not from the feature branch — so
   the tag matches what's actually on the default branch.
