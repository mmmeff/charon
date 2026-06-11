import { useEffect, useState } from "react";
import { notify } from "../lib/notify";
import type { PrSummary } from "../types";
import { Spinner } from "./common";
import { useFlow } from "./flow";

interface Candidates {
  users: string[];
  teams: { slug: string; name: string }[];
}

/**
 * One-shot "ship it for review" flow on the user's own draft PRs: pick
 * reviewers (users and/or teams), then a single action requests their review
 * and flips the draft to ready. Direct user-authored GitHub writes — the user
 * is choosing, no approval gate.
 */
export function SubmitForReview({ pr }: { pr: PrSummary }) {
  const { ctx, poller } = useFlow();
  const [open, setOpen] = useState(false);
  const [cands, setCands] = useState<Candidates | null>(null);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [users, setUsers] = useState<string[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || cands) return;
    void Promise.all([
      ctx.gh.listCollaborators(ctx.repo).catch(() => [] as string[]),
      ctx.gh.listOrgTeams(ctx.repo),
    ]).then(([u, t]) => setCands({ users: u.filter((x) => x !== ctx.gh.login), teams: t }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // people autocomplete: debounced org-wide search instead of paginating
  // the full collaborator list up front
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setRemote([]);
      return;
    }
    const t = setTimeout(() => {
      setSearching(true);
      ctx.gh
        .searchUsers(ctx.repo, q)
        .then(setRemote)
        .catch(() => setRemote([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (users.length || teams.length) {
        await ctx.gh.requestReviewers(ctx.repo, pr.number, users, teams);
      }
      await ctx.gh.markReadyForReview(ctx.repo, pr.number);
      void notify("Opened for review", `#${pr.number} ${pr.title}`);
      poller.refresh();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const q = query.trim().toLowerCase();
  // local first-page matches, then org-wide search results
  const userPool = [...(cands?.users ?? []), ...remote.filter((r) => !cands?.users.includes(r))];
  const matchUsers = userPool
    .filter(
      (u) => u !== ctx.gh.login && !users.includes(u) && (!q || u.toLowerCase().includes(q))
    )
    .slice(0, 8);
  const matchTeams = (cands?.teams ?? [])
    .filter(
      (t) =>
        !teams.includes(t.slug) &&
        (!q || t.slug.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
    )
    .slice(0, 8);
  const picked = users.length + teams.length;

  if (!open) {
    return (
      <button className="small primary" onClick={() => setOpen(true)}>
        ▸ Submit for review
      </button>
    );
  }

  return (
    <>
      <button className="small" onClick={() => setOpen(false)}>
        ▾ Submit for review
      </button>
      <div className="card submit-review">
        <div className="subtle" style={{ marginBottom: 6, fontWeight: 600 }}>
          Open #{pr.number} for review
        </div>

        {picked > 0 && (
          <div className="row" style={{ marginBottom: 6 }}>
            {users.map((u) => (
              <button
                key={u}
                className="small primary"
                title="Remove"
                onClick={() => setUsers(users.filter((x) => x !== u))}
              >
                @{u} ✕
              </button>
            ))}
            {teams.map((t) => (
              <button
                key={t}
                className="small primary"
                title="Remove"
                onClick={() => setTeams(teams.filter((x) => x !== t))}
              >
                #{t} ✕
              </button>
            ))}
          </div>
        )}

        <input
          type="text"
          autoFocus
          placeholder="Search reviewers — people and teams…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          style={{ width: "100%", marginBottom: 6 }}
        />

        {!cands ? (
          <div className="subtle">
            <Spinner /> loading collaborators…
          </div>
        ) : (
          <div className="row" style={{ marginBottom: 8 }}>
            {matchUsers.map((u) => (
              <button key={u} className="small" onClick={() => setUsers([...users, u])}>
                + @{u}
              </button>
            ))}
            {matchTeams.map((t) => (
              <button
                key={t.slug}
                className="small"
                title={t.name}
                onClick={() => setTeams([...teams, t.slug])}
              >
                + #{t.slug}
              </button>
            ))}
            {matchUsers.length === 0 && matchTeams.length === 0 && (
              <span className="subtle">
                {searching ? (
                  <>
                    <Spinner /> searching…
                  </>
                ) : (
                  <>no matches{q ? ` for “${query}”` : ""}</>
                )}
              </span>
            )}
          </div>
        )}

        <div className="row">
          <button className="small primary" disabled={busy} onClick={() => void submit()}>
            {busy ? <Spinner /> : null}{" "}
            {picked > 0
              ? `Request ${picked} review${picked > 1 ? "s" : ""} & mark ready`
              : "Mark ready (no reviewers)"}
          </button>
          <button className="small" onClick={() => setOpen(false)}>
            Cancel
          </button>
          {error && <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>}
        </div>
      </div>
    </>
  );
}
