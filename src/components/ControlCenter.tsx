import { useState } from "react";
import { eventDef } from "../lib/defaults";
import { resolveHandler, usePrData } from "../lib/events";
import { runFixFlow } from "../lib/flows";
import { notify } from "../lib/notify";
import { useAgentStore } from "../lib/store";
import { interpolate, prVars } from "../lib/template";
import type { PrSummary } from "../types";
import { Badge, CiBadge, MergeBadge, Spinner } from "./common";
import { MergeControl } from "./MergeControl";
import { SubmitForReview } from "./SubmitForReview";
import { useFlow } from "./flow";

/**
 * The PR control center at the top of the activity panel — one glanceable,
 * state-aware surface for every PR-level action:
 *
 *   own draft  → state badges · submit for review · update from base · close
 *   own open   → state badges · merge/automerge · update from base · to draft · close
 *   teammate   → state badges · approve (with optional comment)
 *
 * Everything here is a direct user-authored GitHub action — no approval gate.
 */
export function ControlCenter({ pr }: { pr: PrSummary }) {
  const { ctx, poller } = useFlow();
  const mine = pr.author === ctx.gh.login;
  const checks = usePrData((s) => s.checks[pr.number] ?? []);
  const reviews = usePrData((s) => s.reviews[pr.number] ?? []);
  const runs = useAgentStore((s) => s.runs);
  const order = useAgentStore((s) => s.order);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveText, setApproveText] = useState("");

  const activeRuns = order
    .map((id) => runs[id])
    .filter(
      (r) => r && r.prNumber === pr.number && (r.status === "running" || r.status === "starting")
    ).length;

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const conflictFix = async (eventId: "merge_conflict_detected" | "base_branch_updated") => {
    const handler = resolveHandler(ctx.config.events, eventId);
    const prompt = interpolate(handler.prompt, { ...prVars(pr), repo: ctx.repo });
    await runFixFlow(ctx, pr, prompt, eventDef(eventId)?.label ?? eventId, "conflict_fix");
  };

  // server-side merge of base when clean; agent fallback when it conflicts
  const updateFromBase = () =>
    guard(async () => {
      try {
        await ctx.gh.updateBranch(ctx.repo, pr.number);
        poller.refresh();
      } catch {
        await conflictFix("base_branch_updated");
      }
    });

  const resolveConflicts = () => guard(() => conflictFix("merge_conflict_detected"));

  const convertToDraft = () =>
    guard(async () => {
      await ctx.gh.convertToDraft(ctx.repo, pr.number);
      void notify("Converted to draft", `#${pr.number} ${pr.title}`);
      poller.refresh(); // re-buckets the PR from Open into Drafts
    });

  const closePr = () =>
    guard(async () => {
      await ctx.gh.closePull(ctx.repo, pr.number);
      void notify("PR closed", `#${pr.number} ${pr.title}`);
      poller.refresh();
      setConfirmClose(false);
    });

  const approvedByMe = reviews.some((r) => r.author === ctx.gh.login && r.state === "APPROVED");
  const approve = () =>
    guard(async () => {
      await ctx.gh.submitReview(ctx.repo, pr.number, {
        body: approveText.trim(),
        event: "APPROVE",
        comments: [],
      });
      void notify("PR approved", `#${pr.number} ${pr.title}`);
      setApproveOpen(false);
      setApproveText("");
      poller.refresh();
    });

  return (
    <div className="control-center">
      {/* ── state at a glance ── */}
      <div className="row">
        <Badge color={mine ? (pr.draft ? "gray" : "blue") : "purple"}>
          {mine ? (pr.draft ? "draft" : "open") : "review"}
        </Badge>
        {!mine && <span className="subtle">by {pr.author}</span>}
        <CiBadge checks={checks} />
        {mine && <MergeBadge state={pr.mergeableState} />}
        {pr.autoMerge && (
          <Badge color="green" title="Auto-merge is armed — merges once all requirements pass">
            ⏻
          </Badge>
        )}
      </div>

      {mine ? (
        <>
          {/* ── primary action by state ── */}
          {pr.draft ? (
            <div className="row">
              <SubmitForReview pr={pr} />
            </div>
          ) : (
            <div className="row">
              <MergeControl pr={pr} />
            </div>
          )}

          {/* ── branch maintenance ── */}
          <div className="row">
            {pr.mergeableState === "dirty" ? (
              <button className="small" disabled={busy} onClick={() => void resolveConflicts()}>
                {busy ? <Spinner /> : null} Resolve conflicts
              </button>
            ) : (
              <button
                className="small"
                disabled={busy}
                title={`Merge the latest ${pr.baseRef} into ${pr.headRef} — server-side when clean, agent if it conflicts`}
                onClick={() => void updateFromBase()}
              >
                {busy ? <Spinner /> : "⇡"} Update from {pr.baseRef}
              </button>
            )}
          </div>

          {/* ── tertiary ── */}
          <div className="row cc-tertiary">
            {!pr.draft && (
              <button
                className="link small"
                disabled={busy}
                title="Send back to draft — review requests pause until it's marked ready again"
                onClick={() => void convertToDraft()}
              >
                → to draft
              </button>
            )}
            {confirmClose ? (
              <>
                <button className="small danger" disabled={busy} onClick={() => void closePr()}>
                  {busy ? <Spinner /> : null} Confirm close
                </button>
                <button className="small" onClick={() => setConfirmClose(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="link small cc-danger"
                title="Close this PR on GitHub without merging"
                onClick={() => setConfirmClose(true)}
              >
                ✕ close PR
              </button>
            )}
          </div>
        </>
      ) : (
        /* ── teammate PR: approve, with an optional review comment ── */
        <>
          {!approveOpen ? (
            <div className="row">
              <button
                className={`small ${approvedByMe ? "" : "primary"}`}
                onClick={() => setApproveOpen(true)}
              >
                ✓ {approvedByMe ? "Re-approve" : "Approve PR"}
              </button>
              {approvedByMe && <Badge color="green">you approved</Badge>}
            </div>
          ) : (
            <>
              <textarea
                rows={2}
                autoFocus
                placeholder="Optional approval comment…"
                value={approveText}
                onChange={(e) => setApproveText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) void approve();
                  if (e.key === "Escape") setApproveOpen(false);
                }}
              />
              <div className="row">
                <button className="small primary" disabled={busy} onClick={() => void approve()}>
                  {busy ? <Spinner /> : "✓"} Approve{approveText.trim() ? " with comment" : ""}
                </button>
                <button className="small" onClick={() => setApproveOpen(false)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </>
      )}

      {activeRuns > 0 && (
        <div className="row subtle" style={{ fontSize: 11 }}>
          <Spinner /> {activeRuns} agent{activeRuns > 1 ? "s" : ""} working — see Agents
        </div>
      )}
      {error && <div style={{ color: "var(--red)", fontSize: 11.5 }}>{error}</div>}
    </div>
  );
}
