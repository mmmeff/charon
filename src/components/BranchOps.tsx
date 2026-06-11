import { useState } from "react";
import { eventDef } from "../lib/defaults";
import { resolveHandler } from "../lib/events";
import { runFixFlow } from "../lib/flows";
import { useAgentStore } from "../lib/store";
import { interpolate, prVars } from "../lib/template";
import type { PrSummary } from "../types";
import { MergeBadge, Spinner } from "./common";
import { MergeControl } from "./MergeControl";
import { useFlow } from "./flow";

/**
 * Branch operations block at the top of the activity panel (own PRs only):
 * merge state, conflict resolution / update-from-base, merge + auto-merge
 * controls, and the working-agents indicator — one grouped surface.
 */
export function BranchOps({ pr }: { pr: PrSummary }) {
  const { ctx, poller } = useFlow();
  const runs = useAgentStore((s) => s.runs);
  const order = useAgentStore((s) => s.order);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (pr.author !== ctx.gh.login) return null;

  const activeRuns = order
    .map((id) => runs[id])
    .filter(
      (r) => r && r.prNumber === pr.number && (r.status === "running" || r.status === "starting")
    ).length;

  const conflictFix = async (eventId: "merge_conflict_detected" | "base_branch_updated") => {
    const handler = resolveHandler(ctx.config.events, eventId);
    const prompt = interpolate(handler.prompt, { ...prVars(pr), repo: ctx.repo });
    await runFixFlow(ctx, pr, prompt, eventDef(eventId)?.label ?? eventId, "conflict_fix");
  };

  // server-side merge of base when clean; agent fallback when it conflicts
  const updateFromBase = async () => {
    setBusy(true);
    setError("");
    try {
      await ctx.gh.updateBranch(ctx.repo, pr.number);
      poller.refresh();
    } catch {
      try {
        await conflictFix("base_branch_updated");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const resolveConflicts = async () => {
    setBusy(true);
    setError("");
    try {
      await conflictFix("merge_conflict_detected");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="branch-ops">
      <div className="row">
        <MergeBadge state={pr.mergeableState} />
        <span style={{ flex: 1 }} />
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
      {!pr.draft && (
        <div className="row">
          <MergeControl pr={pr} />
        </div>
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
