import { useEffect, useState } from "react";
import { usePrData } from "../lib/events";
import type { MergeMethod } from "../lib/github";
import { notify } from "../lib/notify";
import type { PrSummary } from "../types";
import { Spinner } from "./common";
import { useFlow } from "./flow";

const METHOD_LABELS: Record<MergeMethod, string> = {
  squash: "Squash & merge",
  merge: "Merge commit",
  rebase: "Rebase & merge",
};

/**
 * Merge actions for the user's own open PRs, GitHub-style: pick the merge
 * method (limited to what the repo allows), merge now (with confirm), or arm
 * auto-merge with that method. Direct user-authored actions — no gate.
 */
export function MergeControl({ pr }: { pr: PrSummary }) {
  const { ctx, poller } = useFlow();
  const reviews = usePrData((s) => s.reviews[pr.number] ?? []);
  const [methods, setMethods] = useState<MergeMethod[] | null>(null);
  const [method, setMethod] = useState<MergeMethod>("squash");
  const [canOverride, setCanOverride] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void ctx.gh
      .repoMergeMethods(ctx.repo)
      .then((ms) => {
        setMethods(ms);
        setMethod(ms[0]);
      })
      .catch(() => setMethods(["merge"]));
    void ctx.gh
      .canAdminOverride(ctx.repo)
      .then(setCanOverride)
      .catch(() => setCanOverride(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // blocked/behind = branch protection requirements unmet (approvals,
  // required checks, up-to-date rule) — merging means overriding, which only
  // repo admins can do. Non-admins get no merge button there (automerge is
  // their path); admins get an explicitly-labeled override.
  const state = pr.mergeableState;
  const blocked = state === "blocked" || state === "behind";
  const conflicted = state === "dirty";
  const approvals = new Set(
    reviews.filter((r) => r.state === "APPROVED").map((r) => r.author)
  ).size;
  const blockReason =
    approvals < ctx.config.requiredApprovals
      ? `${approvals}/${ctx.config.requiredApprovals} approvals — requirements not met`
      : "branch protection requirements not met";
  const showMerge = !blocked || canOverride;

  const merge = async () => {
    setBusy(true);
    setError("");
    try {
      await ctx.gh.mergePull(ctx.repo, pr.number, method);
      void notify("PR merged", `#${pr.number} ${pr.title}`);
      void poller.refreshPr(pr.number);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const toggleAutoMerge = async () => {
    setBusy(true);
    setError("");
    try {
      if (pr.autoMerge) await ctx.gh.disableAutoMerge(ctx.repo, pr.number);
      else await ctx.gh.enableAutoMerge(ctx.repo, pr.number, method);
      // optimistic flag flip; the next poll reconciles
      const d = usePrData.getState();
      const fix = (l: PrSummary[]) =>
        l.map((p) => (p.number === pr.number ? { ...p, autoMerge: !pr.autoMerge } : p));
      d.patch({ myDrafts: fix(d.myDrafts), myOpen: fix(d.myOpen), reviewQueue: fix(d.reviewQueue) });
      void poller.refreshPr(pr.number);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {(methods?.length ?? 0) > 1 && (
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as MergeMethod)}
          title="Merge method"
        >
          {(methods ?? []).map((m) => (
            <option key={m} value={m}>
              {METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      )}
      {showMerge &&
        (confirming ? (
          <>
            <button
              className={`small ${blocked ? "danger" : "primary"}`}
              disabled={busy}
              onClick={() => void merge()}
            >
              {busy ? <Spinner /> : null} Confirm {blocked ? "override " : ""}
              {METHOD_LABELS[method].toLowerCase()}
            </button>
            <button className="small" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : blocked ? (
          <button
            className="small danger"
            disabled={busy || !methods}
            title={`${blockReason} — merging overrides branch protection (admin)`}
            onClick={() => setConfirming(true)}
          >
            ⚠ Override merge…
          </button>
        ) : (
          <button
            className="small primary"
            disabled={conflicted || !methods || busy}
            title={conflicted ? "Resolve conflicts first" : METHOD_LABELS[method]}
            onClick={() => setConfirming(true)}
          >
            Merge…
          </button>
        ))}
      {!showMerge && (
        <span className="subtle" style={{ fontSize: 11 }} title={blockReason}>
          merge blocked — {blockReason}
        </span>
      )}
      <button
        className="small"
        disabled={busy}
        title={
          pr.autoMerge
            ? "Disarm auto-merge"
            : `Merge automatically (${METHOD_LABELS[method].toLowerCase()}) once requirements are met`
        }
        onClick={() => void toggleAutoMerge()}
      >
        ⏻ {pr.autoMerge ? "Disable automerge" : "Automerge"}
      </button>
      {error && <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>}
    </>
  );
}
