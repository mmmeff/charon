import { useEffect, useRef, useState } from "react";
import { usePrData } from "../lib/events";
import { notify } from "../lib/notify";
import type { PrSummary } from "../types";
import { Spinner } from "./common";
import { useFlow } from "./flow";

/**
 * Tertiary actions for the user's own PRs (draft or open) behind a ⋯ menu.
 * Destructive items use an in-menu confirm step. All entries are direct
 * user-authored GitHub actions — no approval gate.
 */
export function PrOverflowMenu({ pr }: { pr: PrSummary }) {
  const { ctx, poller } = useFlow();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const dismiss = () => {
    setOpen(false);
    setConfirming(null);
    setError("");
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) dismiss();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const closePr = async () => {
    setBusy(true);
    setError("");
    try {
      await ctx.gh.closePull(ctx.repo, pr.number);
      void notify("PR closed", `#${pr.number} ${pr.title}`);
      poller.refresh();
      dismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  };

  const toggleAutoMerge = async () => {
    setBusy(true);
    setError("");
    try {
      if (pr.autoMerge) await ctx.gh.disableAutoMerge(ctx.repo, pr.number);
      else await ctx.gh.enableAutoMerge(ctx.repo, pr.number);
      // optimistic flag flip; the next poll reconciles
      const d = usePrData.getState();
      const fix = (l: PrSummary[]) =>
        l.map((p) => (p.number === pr.number ? { ...p, autoMerge: !pr.autoMerge } : p));
      d.patch({ myDrafts: fix(d.myDrafts), myOpen: fix(d.myOpen), reviewQueue: fix(d.reviewQueue) });
      poller.refresh();
      dismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-menu" ref={ref}>
      <button
        className="small"
        title="More actions"
        onClick={() => (open ? dismiss() : setOpen(true))}
      >
        ⋯
      </button>
      {open && (
        <div className="overflow-pop">
          {error && <div className="overflow-error">{error}</div>}
          <button
            className="overflow-item"
            disabled={busy}
            title={
              pr.autoMerge
                ? "Disarm auto-merge"
                : "Merge automatically once requirements are met (method follows repo settings)"
            }
            onClick={() => void toggleAutoMerge()}
          >
            {busy && confirming === null ? <Spinner /> : null}{" "}
            {pr.autoMerge ? "Disable automerge" : "Enable automerge"}
          </button>
          {confirming === "close" ? (
            <div className="row" style={{ padding: "2px 4px", gap: 4 }}>
              <button className="small danger" disabled={busy} onClick={() => void closePr()}>
                {busy ? <Spinner /> : null} Confirm close
              </button>
              <button className="small" onClick={() => setConfirming(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="overflow-item danger"
              title="Close this PR on GitHub without merging"
              onClick={() => setConfirming("close")}
            >
              Close PR
            </button>
          )}
        </div>
      )}
    </div>
  );
}
