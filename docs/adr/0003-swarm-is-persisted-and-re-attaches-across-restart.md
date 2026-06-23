# The Swarm is persisted and re-attaches across restart

A **Swarm** is a persisted entity, parallel to `AgentRun` history. It survives
app restart as a cohesive group rather than fragmenting into N independent
runs. v1 ships **Race mode** only (single **Winner**); the Swarm record is
shaped so a future **Consensus mode** is an additive axis, not a reshape.

## Why persist the wrapper (not just the contender runs)

- **Preserves the promotion affordance across restart.** Today `AgentRun`s
  persist per repo (`agents.json`, agents.ts:486) and draft-create branches
  persist on `run.draftCreate` (DraftCreateRunState) — so contender *runs*
  already survive restart. Without the Swarm wrapper, however, a finished-
  but-unpromoted swarm at restart scatters its N terminal trials into the
  flat activity feed / N `PendingDraftWorkspace` recovery cards, and the Q5
  "pick the single Winner → one push / one `gh pr create`" affordance is lost.
  Persisting the wrapper keeps that affordance after restart.
- **Restart degrades gracefully under Q5.** Because promotion under Race mode
  is enabled only when every contender is terminal (`done`/`error`/`killed`),
  an in-flight swarm at restart re-attaches in a coherent state: contender
  runs that were `running`/`starting` become `killed` (existing
  `initAgentPersistence` behavior); the surviving `done` contenders remain
  promotable; the swarm becomes "all-terminal, awaiting promote" rather than
  abandoned. The user just picks the winner post-restart and the existing
  finalize path runs.
- **Held worktrees re-attach.** By ADR-0002 a mutable swarm holds each
  `done` contender's worktree past its `onDone` until the swarm resolves. On
  restart those worktrees must be re-leased (the in-memory `leases` Set in
  worktree.ts:106 resets), not released — because the trial *is* the local
  commit on that worktree. The Swarm record references the surviving
  contenders' worktree paths so hydration re-takes their leases. Contenders
  that died on restart (now `killed`) get their worktrees released — they
  hold no promotable trial.
- **Per Q5, only `done` trials are promotable.** A contender killed-on-
  restart, even if it had committed, is not promotable; its diff is shown but
  its Promote control stays disabled. This keeps the promotion path
  uniform across "user killed a laggard" and "restart killed a slowpoke."
- **Real trade-off, chosen over the in-memory alternative.** Rejected: hold
  the Swarm only in memory (contender runs persist standalone as today).
  Cheaper MVP — no new persistence shape or migration — but the restart
  experience loses the comparison view and the single-promote flow, and
  draft-create swarms fragment into N independent recovery cards with no
  shared pick-a-winner affordance. The user explicitly chose persistence
  to preserve the cohesive entity.

## Shape

- A per-repo blob `repos/<repoKey>/swarms.json` (parallel to
  `agents.json`) storing the visible Swarms, newest-first, with the same
  debounce-save + boot-load discipline as agent-history persistence.
- Each Swarm record: `id`, `mode: "race"` (v1 only), `flowKind` (which of
  the v1 kick-off flows: `draft_edit`/`draft_create`/`draft_question`/
  `review` with `reviewKind` if applicable), the shared trigger context
  (`{repo, prNumber, prTitle, prompt, selection, harness, acpMode}`,
  `contenders: { id, model, reasoning?, runId }[]`, `status: "running" |
  "resolved" | "abandoned"`, `winnerContenderId?`, `startedAt`,
  `resolvedAt?`. Each contender carries the worktree reference for mutable
  flows (path/clonePath/localBranch/baseSha) so hydration can re-lease and
  the diff trial survives.
- Contender runs keep being plain `AgentRun`s (created by the existing
  `startAgent`); the Swarm references them by id and stamps a `swarmId` on
  each contender run so per-PR views can already group by swarm if needed
  without restructuring the activity feed.

## Consequences

- **New blob + forward-compat migration.** A `loadSwarmHistory`/`saveSwarm`
  pair mirrors `loadBlob`/`saveBlob`. Forward-compat: an unknown `mode` (a
  future Consensus value) is tolerated by skipping the swarm on hydrate
  rather than crashing, mirroring the `migrateGlobalConfig` discipline.
- **Boot re-lease step.** On app start, after agent history hydrates and
  restart-killed runs are settled, hydrate swarms, then for each swarm:
  re-take the `leases` entry for every contender whose `AgentRun` ended
  `done` and stored a worktree; release any contender's worktree whose run
  is now terminal-but-non-`done` (`killed`/`error`). Without this, a
  crashed-with-pending-promotion swarm leaves 0–3 parked worktrees on disk
  until the next allocation naturally resets them.
- **`draft_create` swarm recovery.** Loser branches clean up via a
  swarm-aware extension of `deleteDraftCreateArtifacts` (flows.ts:317) that
  loops N branches on `Abandoned` and on `Resolved`-losers. The Promote
  winner runs `createDraftPrWithGh` exactly once on the winner's branch +
  `<draft-pr>` metadata — preserving the "one swarm → eventually one draft
  PR" invariant (CONTEXT.md).
- **Restart of a swarm with NO terminal contenders.** If every contender
  was still running at restart (rare, e.g. crash early in a swarm), the
  swarm re-attaches with all contenders `killed` and no promotable trial —
  effectively `Abandoned` by the restart itself; the boot-re-lease step
  releases all its worktrees. The user just relaunches.
