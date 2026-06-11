import { create } from "zustand";
import type {
  CheckInfo,
  CommentInfo,
  EventHandlerConfig,
  FiredEvent,
  PrSnapshot,
  PrSummary,
  ReviewInfo,
  TimelineEventInfo,
} from "../types";
import { eventDef, EVENT_CATALOG } from "./defaults";
import { runAnalysisFlow, runFixFlow, runReviewFlow, type FlowContext, eventVars } from "./flows";
import type { ReviewThreadInfo } from "./github";
import { notify } from "./notify";
import { interpolate, truncate } from "./template";
import { useRepoStore } from "./store";
import { pruneBranchWorktree } from "./worktree";

// ---------------------------------------------------------------------------
// Live PR data for the UI (refreshed by the poller)
// ---------------------------------------------------------------------------

interface PrDataState {
  myDrafts: PrSummary[];
  myOpen: PrSummary[];
  reviewQueue: PrSummary[];
  checks: Record<number, CheckInfo[]>;
  comments: Record<number, CommentInfo[]>;
  reviews: Record<number, ReviewInfo[]>;
  /** review threads (resolution state) keyed by PR number */
  threads: Record<number, ReviewThreadInfo[]>;
  /** non-comment timeline events (pushes, merges, labels…) keyed by PR number */
  timeline: Record<number, TimelineEventInfo[]>;
  polling: boolean;
  lastPollAt: number | null;
  /** when the next poll is scheduled to fire */
  nextPollAt: number | null;
  pollError: string | null;
  patch(p: Partial<PrDataState>): void;
}

export const usePrData = create<PrDataState>((set) => ({
  myDrafts: [],
  myOpen: [],
  reviewQueue: [],
  checks: {},
  comments: {},
  reviews: {},
  threads: {},
  timeline: {},
  polling: false,
  lastPollAt: null,
  nextPollAt: null,
  pollError: null,
  patch: (p) => set(p),
}));

// ---------------------------------------------------------------------------
// Handler resolution: per-repo overrides overlaid on catalog defaults.
// Unknown ids in config still resolve (forward compatibility).
// ---------------------------------------------------------------------------

export function resolveHandler(
  events: Record<string, EventHandlerConfig>,
  id: string
): EventHandlerConfig {
  const override = events[id];
  if (override) return override;
  const def = eventDef(id);
  return def
    ? { enabled: def.defaultEnabled, prompt: def.defaultPrompt }
    : { enabled: false, prompt: "" };
}

// ---------------------------------------------------------------------------
// Snapshot construction & diffing
// ---------------------------------------------------------------------------

export interface PrPollData {
  pr: PrSummary;
  checks: CheckInfo[];
  comments: CommentInfo[];
  reviews: ReviewInfo[];
}

export function buildSnapshot(data: PrPollData, login: string, firstSeenAt: number): PrSnapshot {
  const checkMap: Record<string, string> = {};
  for (const c of data.checks) checkMap[c.name] = c.conclusion ?? c.status;
  // latest review state per human author; count approvals
  const latest: Record<string, string> = {};
  for (const r of data.reviews) {
    if (r.state === "COMMENTED" || !r.author) continue;
    latest[r.author] = r.state;
  }
  const approvals = Object.values(latest).filter((s) => s === "APPROVED").length;
  return {
    pr: data.pr,
    checks: checkMap,
    commentIds: data.comments.map((c) => c.id),
    reviewIds: data.reviews.map((r) => r.id),
    reviewStates: Object.fromEntries(data.reviews.map((r) => [r.id, r.state])),
    approvals,
    firstSeenAt,
    myCommentIds: data.comments.filter((c) => c.author === login).map((c) => c.id),
  };
}

interface DiffCtx {
  repo: string;
  login: string;
  bugBotPatterns: string[];
  requiredApprovals: number;
  prClass: "mine" | "teammate";
}

const isBugBot = (author: string, patterns: string[]) => {
  const a = author.toLowerCase();
  return patterns.some((p) => p && a.includes(p.toLowerCase()));
};

/** Compare snapshots and emit catalog events. Pure: no IO, no dispatch. */
export function diffSnapshots(
  prev: PrSnapshot | undefined,
  data: PrPollData,
  ctx: DiffCtx
): FiredEvent[] {
  const out: FiredEvent[] = [];
  const pr = data.pr;
  const fire = (id: string, vars: Record<string, string> = {}) =>
    out.push({
      id,
      firedAt: Date.now(),
      repo: ctx.repo,
      prNumber: pr.number,
      prTitle: pr.title,
      prClass: ctx.prClass,
      vars,
    });

  if (!prev) {
    fire("pr_opened");
    if (ctx.prClass === "teammate" && pr.requestedFromMe && !pr.draft) fire("review_requested");
    return out;
  }
  const old = prev.pr;

  // --- checks + branch state: my PRs only ---
  // these events trigger FIX flows (agents that push); checks are fetched
  // for teammate PRs too (display), but must never fire fixes there
  if (ctx.prClass === "mine") {
    for (const c of data.checks) {
      const was = prev.checks[c.name];
      const now = c.conclusion;
      if (!now || was === now) continue;
      const vars = { "check-name": c.name, "check-url": c.url, "check-id": String(c.id ?? "") };
      if (now === "failure" || now === "error") fire("ci_failed", vars);
      else if (now === "timed_out") fire("check_timed_out", vars);
      else if (now === "cancelled") fire("check_cancelled", vars);
    }
    const allDone = data.checks.length > 0 && data.checks.every((c) => c.conclusion === "success");
    const wasAllDone =
      Object.keys(prev.checks).length > 0 &&
      Object.values(prev.checks).every((s) => s === "success");
    if (allDone && !wasAllDone) fire("ci_succeeded");

    if (pr.mergeableState === "dirty" && old.mergeableState !== "dirty") {
      fire("merge_conflict_detected");
    }
    if (pr.mergeableState === "behind" && old.mergeableState !== "behind") {
      fire("branch_out_of_date");
    }
    if (pr.baseSha && old.baseSha && pr.baseSha !== old.baseSha) {
      fire("base_branch_updated");
    }
  }

  // --- comments ---
  const known = new Set(prev.commentIds);
  for (const c of data.comments) {
    if (known.has(c.id)) continue;
    if (c.author === ctx.login) continue; // our own (or approved-by-us) comments
    const vars = {
      "comment-body": truncate(c.body, 6000),
      "comment-id": String(c.id),
      "comment-author": c.author,
      "comment-url": c.url,
      ...(c.path ? { "comment-path": c.path, "comment-line": String(c.line ?? "") } : {}),
    };
    if (c.body.includes(`@${ctx.login}`)) fire("mentioned", vars);
    if (ctx.prClass === "mine") {
      if (c.authorIsBot && isBugBot(c.author, ctx.bugBotPatterns)) {
        fire("bug_bot_finding", vars);
      } else if (!c.authorIsBot) {
        fire("teammate_comment_received", vars);
      }
    } else if (
      ctx.prClass === "teammate" &&
      c.inReplyTo !== undefined &&
      prev.myCommentIds.includes(c.inReplyTo) &&
      c.author === pr.author
    ) {
      fire("author_replied_to_your_comment", vars);
    }
  }

  // --- reviews ---
  const knownReviews = new Set(prev.reviewIds);
  for (const r of data.reviews) {
    if (ctx.prClass === "mine" && !knownReviews.has(r.id) && r.author !== ctx.login) {
      const vars = {
        "comment-body": truncate(`[${r.state}] ${r.body}`, 6000),
        "review-state": r.state,
        author: r.author,
      };
      if (r.authorIsBot) fire("automated_review_received", vars);
      else fire("teammate_review_submitted", vars);
    }
    const oldState = prev.reviewStates[r.id];
    if (oldState && oldState !== "DISMISSED" && r.state === "DISMISSED") {
      fire("review_dismissed", { author: r.author });
    }
  }

  // --- approvals ---
  const nowSnap = buildSnapshot(data, ctx.login, prev.firstSeenAt);
  if (
    nowSnap.approvals >= ctx.requiredApprovals &&
    prev.approvals < ctx.requiredApprovals &&
    ctx.prClass === "mine"
  ) {
    fire("pr_approved");
  }

  // --- lifecycle / drafts / labels ---
  if (pr.state === "closed" && old.state === "open") {
    fire(pr.merged ? "pr_merged" : "pr_closed_unmerged");
  }
  if (old.draft && !pr.draft) {
    fire(ctx.prClass === "mine" ? "draft_marked_ready_mine" : "draft_marked_ready");
  }
  if (!old.draft && pr.draft) fire("marked_as_draft");
  for (const l of pr.labels) if (!old.labels.includes(l)) fire("labeled", { label: l });
  for (const l of old.labels) if (!pr.labels.includes(l)) fire("unlabeled", { label: l });

  // --- review-request / update-under-review ---
  if (ctx.prClass === "teammate") {
    if (pr.requestedFromMe && !old.requestedFromMe && !pr.draft) fire("review_requested");
    if (pr.headSha !== old.headSha) fire("pr_updated_under_review");
  }

  return out;
}

// ---------------------------------------------------------------------------
// Dispatch: event → enabled? → interpolated prompt → the right flow.
// Which flow an event uses is behavioral plumbing, not configuration —
// fix-shaped events get a worktree, review-shaped events get the diff, and
// everything else runs as a read-only analysis that can still propose a
// comment. New event ids default to "analyze", so future catalog entries work
// without engine changes.
// ---------------------------------------------------------------------------

const FIX_EVENTS = new Set([
  "ci_failed",
  "check_timed_out",
  "check_cancelled",
  "merge_conflict_detected",
  "base_branch_updated",
  "branch_out_of_date",
  "bug_bot_finding",
  "automated_review_received",
  "teammate_review_submitted",
  "teammate_comment_received",
]);
const REVIEW_EVENTS = new Set(["review_requested", "pr_updated_under_review", "draft_marked_ready"]);

export async function dispatchEvent(ctx: FlowContext, ev: FiredEvent, pr: PrSummary): Promise<void> {
  const def = eventDef(ev.id);
  const label = def?.label ?? ev.id;
  const handler = resolveHandler(ctx.config.events, ev.id);

  // every occurrence is logged; only enabled handlers notify (quiet by default)
  await useRepoStore.getState().logEvent(ev);
  if (!handler.enabled || !handler.prompt.trim()) return;
  void notify(`${label} — ${ctx.repo}`, `PR #${pr.number} ${pr.title}`);

  const vars = eventVars(ctx, pr, ev.vars);
  let prompt = interpolate(handler.prompt, vars);

  // ci_failed pipeline: attach the failing check's log tail as agent context
  if (ev.id === "ci_failed" && ev.vars["check-url"]) {
    const log = await ctx.gh
      .getCheckLog(ctx.repo, {
        name: ev.vars["check-name"] ?? "",
        url: ev.vars["check-url"],
        id: Number(ev.vars["check-id"]) || undefined,
      })
      .catch(() => "");
    if (log.trim()) {
      prompt += `\n\nFAILING CHECK: ${ev.vars["check-name"]}\nLOG TAIL:\n\`\`\`\n${log.slice(-16_000)}\n\`\`\``;
    }
  }

  try {
    if (REVIEW_EVENTS.has(ev.id)) {
      await runReviewFlow(ctx, pr, prompt);
    } else if (FIX_EVENTS.has(ev.id) && pr.state === "open") {
      // branch maintenance (conflicts, merging up base) — fix + push, no PR comment
      const BRANCH_STATE = ["merge_conflict_detected", "base_branch_updated", "branch_out_of_date"];
      const kind =
        ev.id === "ci_failed"
          ? ("ci_fix" as const)
          : BRANCH_STATE.includes(ev.id)
            ? ("conflict_fix" as const)
            : ("feedback_fix" as const);
      await runFixFlow(ctx, pr, prompt, label, kind);
    } else {
      await runAnalysisFlow(ctx, pr, prompt, label);
    }
  } catch (e) {
    console.error(`dispatch ${ev.id} on #${pr.number} failed`, e);
  }
}

// ---------------------------------------------------------------------------
// Poller
// ---------------------------------------------------------------------------

const MAX_TRACKED_PER_CLASS = 25;

export class RepoPoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private ticking = false;
  private tickStartedAt = 0;

  constructor(private getCtx: () => FlowContext) {}

  start() {
    this.stopped = false;
    void this.tick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /**
   * Force an immediate re-poll (Sync now button, after sending a proposal).
   * Self-healing: if a previous tick has been "in flight" implausibly long,
   * its promise died without the finally running (dev HMR module swap,
   * webview hiccup) — clear the stuck flags so syncing works again.
   */
  refresh() {
    if (this.timer) clearTimeout(this.timer);
    this.stopped = false;
    if (this.ticking && Date.now() - this.tickStartedAt > 30_000) {
      this.ticking = false;
      usePrData.getState().patch({ polling: false });
    }
    void this.tick();
  }

  private schedule() {
    if (this.stopped) return;
    const sec = Math.max(20, this.getCtx().config.pollIntervalSec || 60);
    usePrData.getState().patch({ nextPollAt: Date.now() + sec * 1000 });
    this.timer = setTimeout(() => void this.tick(), sec * 1000);
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    this.tickStartedAt = Date.now();
    const ctx = this.getCtx();
    const data = usePrData.getState();
    data.patch({ polling: true });
    try {
      const { gh, repo, config } = ctx;
      const me = gh.login;
      const store = useRepoStore.getState();
      const isFirstRun = Object.keys(store.snapshots).length === 0;

      const [openPulls, requested] = await Promise.all([
        gh.listOpenPulls(repo),
        gh.reviewRequestedNumbers(repo),
      ]);

      const notExcluded = (pr: PrSummary, labels: string[]) =>
        !pr.labels.some((l) => labels.includes(l));

      const mine = openPulls.filter(
        (p) => p.author === me && notExcluded(p, config.babysitFilters.excludeLabels)
      );
      const myDrafts = mine.filter((p) => p.draft);
      const myNonDraft = mine.filter((p) => !p.draft);
      const teammate = openPulls
        .filter((p) => p.author !== me && requested.has(p.number))
        .filter((p) => notExcluded(p, config.reviewFilters.excludeLabels))
        .filter((p) => !p.draft || config.reviewFilters.processDrafts)
        .map((p) => ({ ...p, requestedFromMe: true }));

      // Track previously-known PRs that left the open list (merged/closed).
      const stillOpen = new Set(openPulls.map((p) => p.number));
      const vanished = Object.values(store.snapshots).filter((s) => !stillOpen.has(s.pr.number));

      const watchMine = myNonDraft.slice(0, MAX_TRACKED_PER_CLASS);
      const watchDrafts = myDrafts.slice(0, MAX_TRACKED_PER_CLASS);
      const watchTeam = teammate.slice(0, MAX_TRACKED_PER_CLASS);

      const checks: Record<number, CheckInfo[]> = {};
      const comments: Record<number, CommentInfo[]> = {};
      const reviews: Record<number, ReviewInfo[]> = {};
      const threads: Record<number, ReviewThreadInfo[]> = {};
      const timeline: Record<number, TimelineEventInfo[]> = {};
      const newSnapshots: Record<number, PrSnapshot> = {};
      const fired: { ev: FiredEvent; pr: PrSummary }[] = [];
      // detail payloads carry diff stats + mergeable_state; the UI lists are
      // built from these, not the shallow list responses
      const detailed: Record<number, PrSummary> = {};

      const pollOne = async (
        shallow: PrSummary,
        prClass: "mine" | "teammate",
        fireEvents: boolean
      ) => {
        // detail fetch fills mergeable_state (computed lazily by GitHub)
        const detail = await gh.getPull(repo, shallow.number);
        detail.requestedFromMe = shallow.requestedFromMe || requested.has(shallow.number);
        detailed[detail.number] = detail;
        const [ch, cm, rv, th, tl] = await Promise.all([
          gh.listChecks(repo, detail.headSha), // teammate checks: display-only (events stay mine-only)
          gh.listComments(repo, shallow.number),
          gh.listReviews(repo, shallow.number),
          // GraphQL-only; tolerate failure on older GHE
          gh.listReviewThreads(repo, shallow.number).catch(() => []),
          gh.listTimeline(repo, shallow.number),
        ]);
        checks[detail.number] = ch;
        comments[detail.number] = cm;
        reviews[detail.number] = rv;
        threads[detail.number] = th;
        timeline[detail.number] = tl;
        const pollData: PrPollData = { pr: detail, checks: ch, comments: cm, reviews: rv };
        const prevSnap = store.snapshots[detail.number];
        if (!isFirstRun && fireEvents) {
          for (const ev of diffSnapshots(prevSnap, pollData, {
            repo,
            login: me,
            bugBotPatterns: config.bugBotPatterns,
            requiredApprovals: config.requiredApprovals,
            prClass,
          })) {
            fired.push({ ev, pr: detail });
          }
        }
        newSnapshots[detail.number] = buildSnapshot(
          pollData,
          me,
          prevSnap?.firstSeenAt ?? Date.now()
        );
      };

      // Drafts are always tracked (Drafts view needs diff stats and comments)
      // but only generate events when the babysit filter opts drafts in.
      await Promise.all([
        ...watchMine.map((p) => pollOne(p, "mine", true).catch((e) => console.error(e))),
        ...watchDrafts.map((p) =>
          pollOne(p, "mine", config.babysitFilters.processDrafts).catch((e) => console.error(e))
        ),
        ...watchTeam.map((p) => pollOne(p, "teammate", true).catch((e) => console.error(e))),
      ]);

      // closed/merged transitions for vanished PRs
      for (const snap of vanished) {
        try {
          const detail = await gh.getPull(repo, snap.pr.number);
          if (detail.state === "closed") {
            // reclaim the branch's persistent worktree (deps and all)
            void pruneBranchWorktree(repo, snap.pr.headRef);
          }
          if (detail.state === "closed" && !isFirstRun && snap.pr.author === me) {
            fired.push({
              ev: {
                id: detail.merged ? "pr_merged" : "pr_closed_unmerged",
                firedAt: Date.now(),
                repo,
                prNumber: detail.number,
                prTitle: detail.title,
                prClass: "mine",
                vars: {},
              },
              pr: detail,
            });
          }
        } catch (e) {
          console.error(e);
        }
      }

      await store.saveSnapshots(newSnapshots);
      const enrich = (p: PrSummary) => detailed[p.number] ?? p;
      data.patch({
        myDrafts: myDrafts.map(enrich),
        myOpen: myNonDraft.map(enrich),
        reviewQueue: watchTeam.map(enrich),
        checks,
        comments,
        reviews,
        threads,
        timeline,
        lastPollAt: Date.now(),
        pollError: null,
      });

      // Dispatch after state is persisted so a crash can't double-fire.
      for (const { ev, pr } of fired) {
        await dispatchEvent(ctx, ev, pr);
      }
    } catch (e) {
      data.patch({ pollError: e instanceof Error ? e.message : String(e) });
    } finally {
      data.patch({ polling: false });
      this.ticking = false;
      this.schedule();
    }
  }
}

export { EVENT_CATALOG };
