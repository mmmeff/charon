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
  const [methods, setMethods] = useState<MergeMethod[] | null>(null);
  const [method, setMethod] = useState<MergeMethod>("squash");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mergeable = pr.mergeableState !== "dirty";

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
      {confirming ? (
        <>
          <button className="small primary" disabled={busy} onClick={() => void merge()}>
            {busy ? <Spinner /> : null} Confirm {METHOD_LABELS[method].toLowerCase()}
          </button>
          <button className="small" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button
          className="small primary"
          disabled={!mergeable || !methods || busy}
          title={mergeable ? METHOD_LABELS[method] : "Resolve conflicts first"}
          onClick={() => setConfirming(true)}
        >
          Merge…
        </button>
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
