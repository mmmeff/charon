# Charon (pr-copilot)

A macOS desktop app (Tauri 2 + React/TS) that turns every code change into a
review decision surface — every diff flows through the same lens: diff, CI,
comments, context, agent log, proposed fix. The native Rust layer owns all
network/git I/O; the webview never calls GitHub directly.

## Language

### Swarm

A single composer submission fanned out to N parallel agent runs that share
one prompt, one selection, one harness, and one ACP mode, differing only per
**Contender**. The user compares the **Trials** and promotes a single
**Winner**. v1 operates in **Race mode** (single winner). A future **Consensus
mode** will let the user union/merge trials instead of picking one; the
comparison host and Trial shape are structured so Consensus is an additive
mode on the same Swarm, not a separate entity.
_Avoid_: batch, ensemble, race (used as a Swarm mode, not the entity), fanout,
tournament, multi-run, swirl, jury

### Race mode / Consensus mode

A Swarm's mode. v1 supports only **Race**: pick exactly one Contender as the
Winner; losers are dismissed/their worktrees released. **Consensus** is
deferred: union-merge of trials (e.g. union all models' self-review findings,
dedupe by `path+line+side+body`-fuzzy) without a single winner. The mode is a
field on the Swarm; the comparison host's pick/union-merge affordances are the
only thing that changes by mode.
_Avoid_: merge, vote, jury, aggregate

### Contender

One slot in a **Swarm**: a `{model, reasoning?}` pair that shares the swarm's
prompt/harness/mode. The unit of variation in a swarm. Empty `reasoning` means
"inherit the harness/per-flow default," same semantics as the existing
`ReasoningPicker`.
_Avoid_: variant, slot, runner, entrant, candidate

### Trial

What one **Contender** produced — the comparable artifact the user diffs
against other contenders' trials before choosing the **Winner**. v1 supports
three render classes on the comparison host, each tied to a kick-off flow:

- **Diff Trial** (mutable: `draft_edit`, `draft_create`, fix flows) — one or
  more commits on the contender's local ephemeral worktree branch, **never
  pushed** until the contender is promoted. `draft_create` diff trials also
  carry the agent's `<draft-pr>` metadata (title/body).
- **Review Trial** (read-only: `runReviewFlow` teammate + `runSelfReviewFlow`
  self) — a review `{verdict, summary, comments[]}` Proposal, or for
  self-review a `ReviewFinding[]` set.
- **Proposal Trial** (read-only, proposal-shaped outputs) — an
  issue_comment / comment_reply Proposal. Used by teammate `runReviewFlow`
  review submissions; structurally available for `runAnalysisFlow`/event
  proposals if those flows are later wired for swarm kick-off (not in v1
  kick-off scope).

v1 kick-off scope is deliberately `{draft_edit, draft_create, draft_question,
review (self+teammate)}` — i.e. the composer's draft/ask/edit/review flows.
`runRewrite` / `runTitleDraft` / `runDescriptionDraft` (quick inline
editor-drop flows) and `runCheckAnalysis` are **excluded** from swarm
kick-off; `runAnalysisFlow`/event and `runFixFlow`/`applyFindings`/
`runAddressComment` are excluded from v1 kick-off but their Trial shapes are
structurally compatible with the comparison-host render classes.
_Avoid_: candidate, output, result, answer, draft (overloaded with PrSummary
draft and composer Edit/draft mode)

### Winner

The single **Contender** promoted from a **Swarm** in Race mode. Promotion
is enabled only when every contender has reached a terminal state
(`done`/`error`/`killed`), so no swarm is ever promoted off a partial trial.
Promotion reuses the existing single-run finalize path per flow kind:
read-only winners upsert their trial as the pending review/findings/answer;
mutable winners run *one* `git push origin HEAD:<pr.headRef>` of their local
commit (the same push a single mutable run does today), and the losing
contenders' worktrees are released without ever touching origin. (In
Consensus mode, deferred, there is no single Winner — see Consensus mode.)
_Avoid_: champion, picked, selected run, best

### Resolved / Abandoned

Race-mode **Swarm** terminal states. A swarm is **Resolved** when its Winner
has been promoted (losers released); **Abandoned** when discarded without a
winner (any still-running contenders are killed, all held local worktrees
released, no push). A swarm with running contenders cannot be promoted.
_Avoid_: closed, finished, cancelled (reserved for individual runs)
