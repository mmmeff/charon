/**
 * Swarm lifecycle — fan a single composer submission out to N parallel
 * Contenders that share one prompt/selection/harness/mode and differ only by
 * model (+optional reasoning). The user compares Trials and promotes a single
 * Winner (Race mode, v1). See CONTEXT.md + docs/adr/0001..0003.
 *
 * Architectural invariants enforced here:
 *  - Trials never push to origin (ADR-0002). Mutable contenders run a
 *    "commit but do NOT push" prompt; only the winner's local commit is pushed
 *    once, on promotion, by Charon — never by the agent.
 *  - Contender reasoning is one-shot local state on the Contender record; it
 *    never mutates GlobalConfig (CONTEXT: "Contender"). The per-flow reasoning
 *    override (ReasoningPicker) still applies as a tier below, via resolveModel.
 *  - Promotion is enabled only when every contender is terminal
 *    (`done`/`error`/`killed`); only a `done` contender may be promoted (Q5).
 *  - A mutable swarm holds each `done` contender's worktree past its onDone
 *    until the swarm resolves; an errored/killed contender releases its
 *    worktree immediately (Q5 + ADR-0003).
 *
 * v1 kick-off flows wired here: `draft_edit` (mutable, full) and `draft_question`
 * (read-only, full). `draft_create` and `review` (self+teammate) are wired as
 * `Unsupported` dispatch — the architecture (types/store/persistence/boot
 * re-lease/compare host) supports them; the per-contender launchers + winner
 * promote paths are the documented follow-up, scoped deliberately to keep this
 * first slice shippable under the no-runtime-verification gate (AGENTS.md).
 */
import { killAgent, startAgent } from "./agents";
import { FlowContext, recordPushedCommit, resolveModel } from "./flows";
import { applySkills } from "./skills";
import { native } from "./tauri";
import { uid } from "./template";
import { useAgentStore, useSwarmStore } from "./store";
import {
  createWorktree,
  preserveWorktree,
  releaseWorktree,
  worktreeHead,
  type Worktree,
} from "./worktree";
import type {
  AgentRun,
  LineSelection,
  PrSummary,
  Swarm,
  SwarmContender,
  SwarmContenderSpec,
  SwarmFlowKind,
  SwarmTrigger,
} from "../types";

export { type FlowContext } from "./flows";

/** The active swarm for a (repo, prNumber, flow) tuple — used to mount the
 *  comparison host in place of the single-run RunResults. null when no swarm
 *  is active OR all swarms for that PR are Resolved/Abandoned. */
export function activeSwarmFor(
  repo: string,
  prNumber: number | null,
  flowKind?: SwarmFlowKind
): Swarm | undefined {
  const { swarms, order } = useSwarmStore.getState();
  for (const id of order) {
    const s = swarms[id];
    if (!s || s.trigger.repo !== repo || s.trigger.prNumber !== prNumber) continue;
    if (flowKind && s.flowKind !== flowKind) continue;
    if (s.status !== "running") continue;
    return s;
  }
  return undefined;
}

/** All contenders terminal? Promotion requires this (Q5 strict). */
export function allContendersTerminal(s: Swarm): boolean {
  const runs = useAgentStore.getState().runs;
  return s.contenders.every((c) => {
    const r = runs[c.runId];
    return r && (r.status === "done" || r.status === "error" || r.status === "killed");
  });
}

/** Per-contender AgentRun — drives the compare-host UI + the Promote action
 *  gating. A contender whose run is missing (e.g. dropped by MAX_PERSISTED_RUNS
 *  truncation on restart) reads undefined and reads as terminal-but-not-done. */
export function contenderRun(contender: SwarmContender): AgentRun | undefined {
  return useAgentStore.getState().runs[contender.runId];
}

/** Resolve a contender's effective model via the existing most-specific-wins
 *  tier: contender pick > per-flow override > global default (ADR-0001). */
function contenderModel(ctx: FlowContext, kind: SwarmFlowKind, model: string): string {
  return resolveModel(ctx, model, kind);
}

// ---------------------------------------------------------------------------
// draft_edit — mutable, full v1 wiring
// ---------------------------------------------------------------------------

/** Same body as flows.ts's runDraftEdit prompt, but with the push step removed:
 *  commit, do NOT push — Charon pushes the winning contender once, on promote
 *  (ADR-0002). No proposal block: a mutable contender's Trial is its local
 *  `baseSha..HEAD` diff, surfaced in the compare host. */
function draftEditContenderPrompt(
  ctx: FlowContext,
  pr: PrSummary,
  wt: Worktree,
  selection: LineSelection | null,
  instruction: string
): string {
  const scope = selection
    ? `The user selected ${selection.path} lines ${selection.startLine}–${selection.endLine} (${selection.side} side of the diff):
\`\`\`
${selection.snippet}
\`\`\`
Apply the requested change to that code (and anything it forces you to touch).`
    : `The feedback applies to the PR diff as a whole.`;
  const task = `${scope}

REQUESTED CHANGE:
${instruction}`;
  const base = `You are Charon's code's draft-edit agent working on the user's own draft PR #${pr.number} ("${pr.title}") in ${ctx.repo}.

Your working directory is a dedicated git worktree at ${wt.path} on local branch ${wt.localBranch},
checked out from origin/${pr.headRef} (base: ${pr.baseRef}).

${task}

WORKFLOW:
1. Implement exactly what was asked — keep the change tightly scoped to the request.
2. Commit the change locally with a clear message. Do NOT push. Charon will push the winning
   contender's commit to ${pr.headRef} after the user picks one — never push yourself.
3. If you determine no code change is needed, do not commit; explain why in your final message.

DEPENDENCY & VALIDATION POLICY:
${ctx.config.fixPolicy}

Final message: a short summary of what you changed (or why no change was needed), for the activity log.
Do not emit a proposal block.`;
  return applySkills(base, ctx.skills, ctx.config.skills.draft);
}

/** Spawn one draft_edit contender. The worktree is held past run completion
 *  (preserveWorktree) so the trial's local commit survives the comparison; an
 *  errored/killed contender releases its worktree immediately (Q5 + ADR-0003). */
async function spawnDraftEditContender(
  ctx: FlowContext,
  pr: PrSummary,
  selection: LineSelection | null,
  instruction: string,
  spec: SwarmContenderSpec
): Promise<{ runId: string; worktree: Worktree }> {
  const wt = await createWorktree(ctx.gh, ctx.repo, ctx.config.localClonePath, pr);
  const prompt = draftEditContenderPrompt(ctx, pr, wt, selection, instruction);
  try {
    const runId = await startAgent({
      kind: "draft_edit",
      relation: `swarm edit${selection ? ` (${selection.path}:${selection.startLine})` : ""}`,
      repo: ctx.repo,
      prNumber: pr.number,
      prTitle: pr.title,
      prompt,
      model: contenderModel(ctx, "draft_edit", spec.model),
      binary: ctx.global.cursorBinary,
      cwd: wt.path,
      onDone: async (run) => {
        try {
          await recordPushedCommit(run.id, wt);
        } finally {
          preserveWorktree(wt);
        }
      },
      onSettled: (run) => {
        if (run.status !== "done") {
          void releaseWorktree(wt).catch(() => undefined);
        }
      },
    });
    return { runId, worktree: wt };
  } catch (e) {
    await releaseWorktree(wt);
    throw e;
  }
}

/** Promote the draft_edit winner: one `git push origin HEAD:${pr.headRef}` of
 *  the winner's local commit. Losers' worktrees are released without ever
 *  touching origin (ADR-0002). Empty-diff winner (HEAD == baseSha) is a no-op
 *  push with the disposition surfaced as the resolution note. */
async function promoteDraftEditWinner(winner: SwarmContender): Promise<string> {
  const wt = winner.worktree!;
  const head = await worktreeHead(wt);
  if (!head || head === wt.baseSha) {
    return "winner concluded no change was needed";
  }
  const res = await native.runGit(["push", "origin", `HEAD:${wt.prBranch}`], wt.path);
  if (res.code !== 0) {
    throw new Error(
      `winner push failed (${res.code}):\n${res.stderr || res.stdout}\n\nthe winning commit ${head.slice(
        0,
        7
      )} is still on local branch ${wt.localBranch}; re-push manually if the remote moved.`
    );
  }
  useAgentStore.getState().update(winner.runId, { commitSha: head });
  return `pushed winner ${head.slice(0, 7)} to ${wt.prBranch}`;
}

// ---------------------------------------------------------------------------
// draft_question — read-only, full v1 wiring (no worktree, no push)
// ---------------------------------------------------------------------------

/** Spawn one draft_question contender. The Trial is the agent's answer text
 *  (run.resultText) — compare as panes of prose. No worktree to hold. */
async function spawnDraftQuestionContender(
  ctx: FlowContext,
  pr: PrSummary,
  question: string,
  selection: LineSelection | null,
  spec: SwarmContenderSpec
): Promise<{ runId: string }> {
  // The shared prompt body lives in flows.runDraftQuestion — but that flow's
  // default behaviour is enough for the swarm too: it spawns one read-only
  // Ask run per contender and stores the answer in resultText. We import and
  // call it rather than duplicate the prompt assembly, so a future change to
  // the Ask prompt applies to both single-run and swarm contenders.
  const { runDraftQuestion } = await import("./flows");
  const runId = await runDraftQuestion(
    ctx,
    pr,
    question,
    selection,
    contenderModel(ctx, "draft_question", spec.model),
    undefined
  );
  return { runId };
}

/** Promote is a no-op for a read-only Ask answer: the trial IS the text already
 *  shown in the compare host. Resolving marks the swarm done and dismisses the
 *  losers' panels (their runs stay in the activity feed for the record). */
async function promoteDraftQuestionWinner(winner: SwarmContender): Promise<string> {
  const run = useAgentStore.getState().runs[winner.runId];
  return run?.resultText
    ? "kept the winning answer in the feed"
    : "winner produced no answer";
}

// ---------------------------------------------------------------------------
// releaseLosers — release every non-winner mutable contender's held worktree
// ---------------------------------------------------------------------------

async function releaseLosers(swarm: Swarm, winnerId: string): Promise<void> {
  for (const c of swarm.contenders) {
    if (c.id === winnerId) continue;
    if (!c.worktree) continue;
    await releaseWorktree(c.worktree).catch(() => undefined);
  }
}

/** Release ALL mutable contenders' worktrees (used by abandonSwarm). */
async function releaseAllWorktrees(swarm: Swarm): Promise<void> {
  for (const c of swarm.contenders) {
    if (!c.worktree) continue;
    await releaseWorktree(c.worktree).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle — startSwarm / killContender / promoteWinner / abandonSwarm
// ---------------------------------------------------------------------------

export interface StartSwarmInput {
  ctx: FlowContext;
  flowKind: SwarmFlowKind;
  trigger: SwarmTrigger;
  /** 1..3 contender specs (Q6: max 3, dups OK). Empty/array length 1 degrades
   *  to a no-op "swarm of one" — the toggle is still allowed but adds nothing. */
  contenders: SwarmContenderSpec[];
}

/**
 * Fan a composer submission out to N contenders and register the Swarm. Each
 * contender spawns a deferred agent run; results (commit / answer / verdict)
 * land in the agent store and are linked through the swarm's contender list.
 * Throws if any contender's worktree allocation / spawn fails; already-spawned
 * contenders keep their runs (registering the swarm as `running` so the user
 * can release them via Abandon rather than silently orphaning held worktrees).
 */
export async function startSwarm(input: StartSwarmInput): Promise<Swarm> {
  const { ctx, flowKind, trigger, contenders } = input;
  if (contenders.length < 1 || contenders.length > 3) {
    throw new Error(`a swarm needs 1–3 contenders; got ${contenders.length}`);
  }

  // The pr summary comes from the trigger's PR when present; for draft_create
  // (prNumber null) there's no existing PR yet.
  let pr: PrSummary | null = null;
  if (trigger.prNumber != null) {
    pr = await ctx.gh.getPull(ctx.repo, trigger.prNumber).catch(() => null);
    if (!pr) throw new Error(`could not load PR #${trigger.prNumber} to launch a swarm`);
  }

  const id = uid("swarm-");
  const startedContenders: SwarmContender[] = [];
  let firstError: unknown = null;

  try {
    for (const spec of contenders) {
      let spawned: { runId: string; worktree?: Worktree };
      if (flowKind === "draft_edit") {
        if (!pr) throw new Error("draft_edit swarm requires an existing PR");
        const r = await spawnDraftEditContender(
          ctx,
          pr,
          trigger.selection ?? null,
          trigger.prompt,
          spec
        );
        spawned = { runId: r.runId, worktree: r.worktree };
      } else if (flowKind === "draft_question") {
        if (!pr) throw new Error("draft_question swarm requires an existing PR");
        const r = await spawnDraftQuestionContender(ctx, pr, trigger.prompt, trigger.selection ?? null, spec);
        spawned = { runId: r.runId };
      } else {
        // draft_create / review — wired as additive follow-ups (architecture
        // supports them; per-contender launchers + winner promote are the
        // documented next slice). Throw so the Composer UI gating makes the
        // boundary explicit rather than silently no-op'ing.
        throw new Error(
          `swarm flowKind "${flowKind}" is not wired in v1 (draft_edit, draft_question only)`
        );
      }
      const c: SwarmContender = {
        ...spec,
        runId: spawned.runId,
        worktree: spawned.worktree
          ? {
              path: spawned.worktree.path,
              localBranch: spawned.worktree.localBranch,
              prBranch: spawned.worktree.prBranch,
              clonePath: spawned.worktree.clonePath,
              persistent: spawned.worktree.persistent,
              baseSha: spawned.worktree.baseSha,
            }
          : undefined,
      };
      startedContenders.push(c);
    }
  } catch (e) {
    firstError = e;
  }

  const swarm: Swarm = {
    id,
    mode: "race",
    flowKind,
    trigger,
    contenders: startedContenders,
    status: firstError ? "abandoned" : "running",
    startedAt: Date.now(),
  };
  useSwarmStore.getState().register(swarm);

  // If a later contender failed to launch we don't silently hold earlier
  // contenders' worktrees forever. They're already registered with the
  // (now-Abandoned) swarm; Abandon semantics below clean up. Abandon reuses
  // the same path as the user pressing Abandon — kill any still-running + release.
  if (firstError) {
    await abandonSwarm(id).catch(() => undefined);
    throw firstError;
  }

  return swarm;
}

/** Kill one contender's run gracefully (ACP session/cancel + 5s hard-kill).
 *  Its worktree releases on settle (Q5: killed contender is terminal-but-not-
 *  promotable). The swarm itself stays running until the user promotes or
 *  abandons — a slow contender being killed unblocks the rest of the trial. */
export async function killContender(swarmId: string, contenderId: string): Promise<void> {
  const swarm = useSwarmStore.getState().swarms[swarmId];
  if (!swarm) return;
  const c = swarm.contenders.find((x) => x.id === contenderId);
  if (!c) return;
  await killAgent(c.runId).catch(() => undefined);
  // onSettled in the launcher releases the worktree on the killed state.
}

/**
 * Promote a single done contender as the Race-mode Winner.
 *  - Returns the resolution note.
 *  - Releases every loser's held worktree (ADR-0002).
 *  - For mutable flows, runs the winner-only push (one git push to the PR
 *    branch; ADR-0002). For read-only flows it is a no-op.
 *  - Marks the swarm Resolved.
 * Throws if the contender is not yet terminal, or is terminal-but-not-`done`
 * (Q5: only `done` trials are promotable), or all contenders aren't terminal
 * yet (Q5 strict: promotes only off a complete trial set).
 */
export async function promoteWinner(swarmId: string, winnerId: string): Promise<string> {
  const swarm = useSwarmStore.getState().swarms[swarmId];
  if (!swarm) throw new Error("swarm not found");
  if (swarm.mode !== "race") throw new Error(`only Race swarms promote (mode=${swarm.mode})`);
  if (swarm.status !== "running") throw new Error(`swarm already ${swarm.status}`);
  if (!allContendersTerminal(swarm))
    throw new Error("all contenders must be terminal before promotion (Q5 strict)");

  const winner = swarm.contenders.find((c) => c.id === winnerId);
  if (!winner) throw new Error("winner contender not found");
  const winRun = contenderRun(winner);
  if (!winRun || winRun.status !== "done")
    throw new Error("only a `done` contender may be promoted (Q5)");

  let note: string;
  if (swarm.flowKind === "draft_edit") {
    try {
      note = await promoteDraftEditWinner(winner);
    } catch (e) {
      // keep the loser release even on push failure
      await releaseLosers(swarm, winnerId).catch(() => undefined);
      throw e;
    }
  } else if (swarm.flowKind === "draft_question") {
    note = await promoteDraftQuestionWinner(winner);
  } else {
    throw new Error(`winner promotion for ${swarm.flowKind} not wired in v1`);
  }

  await releaseLosers(swarm, winnerId).catch(() => undefined);
  useSwarmStore.getState().update(swarm.id, {
    status: "resolved",
    winnerContenderId: winnerId,
    resolvedAt: Date.now(),
  });
  return note;
}

/** Discard a swarm without a winner. Any still-running contenders are killed;
 *  every held worktree is released; no push happens (ADR-0002). Idempotent. */
export async function abandonSwarm(swarmId: string): Promise<void> {
  const swarm = useSwarmStore.getState().swarms[swarmId];
  if (!swarm) return;
  if (swarm.status !== "running") {
    // still release anything still held — defensive against an Abandoned swarm
    // whose worktrees didn't get cleaned on a prior partial abandon
    await releaseAllWorktrees(swarm).catch(() => undefined);
    return;
  }
  for (const c of swarm.contenders) {
    const run = contenderRun(c);
    if (run && (run.status === "running" || run.status === "starting")) {
      await killAgent(c.runId).catch(() => undefined);
    }
  }
  await releaseAllWorktrees(swarm).catch(() => undefined);
  useSwarmStore.getState().update(swarm.id, { status: "abandoned", resolvedAt: Date.now() });
}
