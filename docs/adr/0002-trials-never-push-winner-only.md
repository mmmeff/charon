# Contender trials never push; only the Winner pushes

In a mutable **Swarm** (edit / fix / draft_create), each **Contender** runs
isolated in its own worktree, commits on a *local* ephemeral branch, and is
**never pushed to origin**. The user compares the N **Trials** (local
`baseSha..HEAD` diffs). Only the **Winner** is pushed — once — and that push
reuses the exact path a single mutable run takes today
(`git push origin HEAD:<pr.headRef>`, plus `createDraftPrWithGh` for the
draft-create winner's PR). Losing contenders' worktrees are released without
touching origin.

## Why we didn't push N candidate branches to origin

- **No origin noise.** Ephemeral comparison branches in the hosted repo
  clutter branch lists, leak experiment metadata to teammates, trigger
  branch-protection webhook/CI churn, and need explicit cleanup on the
  remote. Local worktree diffs deliver the same comparison with none of it.
- **Existing isolation already gives us this.** `createWorktree`
  (worktree.ts:140) already provisions a separate worktree per run from a
  per-branch pool (`MAX_BRANCH_SLOTS = 3` persistent + throwaway past the
  cap). The only new piece is *not* running the push at the end of a
  contender's run and instead surfacing its local commit as the trial.
  `recordPushedCommit` (flows.ts:175) already records "the commit this run
  produced by advancing past its baseSha" — that record becomes the
  trial link.
- **Averting the regression surface.** ADR-0001 scoped ensembles to a single
  harness partly because of the opencode `set_config_option("model")`
  corruption guard (agents.ts:295ff). That risk is conjoined with *concurrent
  push* races — `fixFlowWrapper`'s rebase-and-retry paragraph only exists
  because two fix agents push the same branch simultaneously. By eliminating
  concurrent pushing entirely (one push, post-selection), the entire
  rebase-race machinery becomes irrelevant to ensembles.
- **Real trade-off, deliberately chosen.** The rejected alternative — each
  contender pushes its own origin-visible candidate branch (FF-merge vs
  reset-vs-stacked-PR promotion) — would have made the trials visible to
  collaborators during comparison and would have let teammates review a
  candidate in place. We give that up for v1 in exchange for zero remote
  noise and a single-push promotion mechanic. That trade is reversible:
  per-contender origin branches can be added later as an opt-in "share this
  trial" action on an existing local trial without reshaping the entity.

## Consequences

- **Worktree lifetime extends past run completion.** Today `releaseWorktree`
  runs in each flow's `onDone`. For mutable swarms, releasing a contender's
  worktree must wait until the swarm resolves (winner promoted or all
  dismissed), because the trial *is* that worktree's local commit. v1 caps
  a swarm at **3 contenders** — exactly the per-branch persistent worktree
  pool (`MAX_BRANCH_SLOTS = 3`, worktree.ts:89) — so a mutable swarm never
  overflows the warm-slot pool; every contender gets a dep-cached worktree
  and none fall through to the throwaway path. Lifting the cap past 3 later
  is a deliberate, caching-aware choice (it forces contenders 4+ onto
  throwaway worktrees with no dep cache).
- **Swarm wrappers for mutable flows suppress the push step.**
  `fixFlowWrapper` and `runDraftEdit`'s prompts bake `git push origin
  HEAD:<ref>` into the *agent's* instructions. Swarm variants need a
  "commit but do NOT push" wrapper; the single winner push is run by
  Charon JS-side on promotion, not by the agent.
- **Loss-on-no-change is uniform.** A contender that concludes "no change
  needed" yields an empty diff trial (HEAD == baseSha) — same as a single
  run's `recordPushedCommit` no-op. Promotion of an empty-diff winner is
  itself a no-op (or a "no change needed" disposition). The trial is
  retained so the user can see the contender concluded this, alongside the
  contenders that did commit.
