import { useEffect, useRef, useState } from "react";
import { usePrData } from "../lib/events";
import type { PrSummary, ReviewInfo } from "../types";
import { Spinner } from "./common";
import { useFlow } from "./flow";

/** Click-outside + Escape dismissal for a popover root. */
function useDismiss(ref: React.RefObject<HTMLElement | null>, onAway: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onAway();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onAway();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

/** Latest meaningful review state per human author. */
function latestStates(reviews: ReviewInfo[]): [string, string][] {
  const latest: Record<string, string> = {};
  for (const r of [...reviews].sort(
    (a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt)
  )) {
    if (!r.author || r.state === "COMMENTED" || r.state === "PENDING") continue;
    latest[r.author] = r.state;
  }
  return Object.entries(latest);
}

const STATE_GLYPH: Record<string, { glyph: string; color: string; label: string }> = {
  APPROVED: { glyph: "✓", color: "var(--acid)", label: "approved" },
  CHANGES_REQUESTED: { glyph: "✗", color: "var(--red)", label: "requested changes" },
  DISMISSED: { glyph: "⊘", color: "var(--fg-subtle)", label: "dismissed" },
};

/** "n/m approvals" chip → popover listing who stands where. */
export function ApprovalsMenu({ pr }: { pr: PrSummary }) {
  const { ctx } = useFlow();
  const reviews = usePrData((s) => s.reviews[pr.number] ?? []);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, () => setOpen(false), open);

  const states = latestStates(reviews);
  const approvals = states.filter(([, s]) => s === "APPROVED").length;
  const required = ctx.config.requiredApprovals;

  return (
    <div className="chip-menu" ref={ref}>
      <button
        className={`badge ${approvals >= required ? "green" : "gray"} chip-btn`}
        title="Who has reviewed"
        onClick={() => setOpen(!open)}
      >
        {approvals}/{required} approvals ▾
      </button>
      {open && (
        <div className="overflow-pop chip-pop">
          {states.length === 0 && <div className="chip-row subtle">no reviews yet</div>}
          {states.map(([author, state]) => {
            const g = STATE_GLYPH[state] ?? { glyph: "·", color: "var(--fg-muted)", label: state };
            return (
              <div className="chip-row" key={author}>
                <span style={{ color: g.color }}>{g.glyph}</span> {author}{" "}
                <span className="subtle">{g.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** "reviewers" chip → popover listing requests, with remove + add (own PRs). */
export function ReviewersMenu({ pr }: { pr: PrSummary }) {
  const { ctx, poller } = useFlow();
  const mine = pr.author === ctx.gh.login;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, () => setOpen(false), open);

  // debounced collaborator search for the add path
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setMatches([]);
      return;
    }
    const t = setTimeout(() => {
      ctx.gh
        .searchCollaborators(ctx.repo, q)
        .then((r) =>
          setMatches(
            r.filter((u) => u !== pr.author && !pr.requestedReviewers.includes(u)).slice(0, 6)
          )
        )
        .catch(() => setMatches([]));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const total = pr.requestedReviewers.length + pr.requestedTeams.length;

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError("");
    try {
      await fn();
      void poller.refreshPr(pr.number);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="chip-menu" ref={ref}>
      <button
        className="badge gray chip-btn"
        title="Requested reviewers"
        onClick={() => setOpen(!open)}
      >
        {total > 0 ? `${total} reviewer${total > 1 ? "s" : ""}` : "reviewers"} ▾
      </button>
      {open && (
        <div className="overflow-pop chip-pop">
          {total === 0 && <div className="chip-row subtle">no outstanding requests</div>}
          {pr.requestedReviewers.map((u) => (
            <div className="chip-row" key={u}>
              @{u}
              {mine && (
                <button
                  className="link small danger-link"
                  disabled={busy === u}
                  title="Withdraw this review request"
                  onClick={() => void act(u, () => ctx.gh.removeReviewRequest(ctx.repo, pr.number, [u]))}
                >
                  {busy === u ? <Spinner /> : "✕"}
                </button>
              )}
            </div>
          ))}
          {pr.requestedTeams.map((t) => (
            <div className="chip-row" key={`#${t}`}>
              #{t}
              {mine && (
                <button
                  className="link small danger-link"
                  disabled={busy === t}
                  title="Withdraw this team review request"
                  onClick={() =>
                    void act(t, () => ctx.gh.removeReviewRequest(ctx.repo, pr.number, [], [t]))
                  }
                >
                  {busy === t ? <Spinner /> : "✕"}
                </button>
              )}
            </div>
          ))}
          {mine && (
            <>
              <input
                type="text"
                placeholder="Add reviewer…"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ marginTop: 6, fontSize: 11.5, padding: "4px 8px" }}
              />
              {matches.map((u) => (
                <button
                  key={u}
                  className="chip-row chip-add"
                  disabled={busy === u}
                  onClick={() =>
                    void act(u, async () => {
                      await ctx.gh.requestReviewers(ctx.repo, pr.number, [u], []);
                      setQuery("");
                      setMatches([]);
                    })
                  }
                >
                  {busy === u ? <Spinner /> : "+"} @{u}
                </button>
              ))}
            </>
          )}
          {error && <div className="chip-row" style={{ color: "var(--red)" }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
