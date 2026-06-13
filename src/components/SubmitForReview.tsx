import { useEffect, useRef, useState } from "react";
import { usePrData } from "../lib/events";
import { notify } from "../lib/notify";
import { useUiStore } from "../lib/store";
import type { PrSummary } from "../types";
import { Spinner } from "./common";
import { useFlow } from "./flow";

interface Candidates {
  users: string[];
  teams: { slug: string; name: string }[];
}

interface Reviewer {
  kind: "user" | "team";
  id: string;
  sub?: string;
}

const label = (r: Reviewer) => (r.kind === "user" ? `@${r.id}` : `#${r.id}`);

/**
 * One-shot "ship it for review" flow on the user's own draft PRs: a
 * keyboard-first combobox picks reviewers (people and teams), then a single
 * action requests their review and flips the draft to ready. Direct
 * user-authored GitHub writes — the user is choosing, no approval gate.
 *
 * Keys: type to search · ↑↓ highlight · ⏎ add (clears + refocuses) ·
 * ⌫ on empty removes last · ⌘⏎ submit · esc close.
 */
export function SubmitForReview({ pr }: { pr: PrSummary }) {
  const { ctx, poller } = useFlow();
  const [open, setOpen] = useState(false);
  const [cands, setCands] = useState<Candidates | null>(null);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [sel, setSel] = useState<Reviewer[]>([]);
  const [hi, setHi] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || cands) return;
    void Promise.all([
      ctx.gh.listCollaborators(ctx.repo).catch(() => [] as string[]),
      ctx.gh.listOrgTeams(ctx.repo),
    ]).then(([u, t]) => setCands({ users: u.filter((x) => x !== ctx.gh.login), teams: t }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // people autocomplete: debounced org-wide search; first-page collaborators
  // give instant local suggestions while it runs
  useEffect(() => {
    const q = query.trim();
    setHi(0);
    if (q.length < 2) {
      setRemote([]);
      return;
    }
    const t = setTimeout(() => {
      setSearching(true);
      ctx.gh
        .searchCollaborators(ctx.repo, q)
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
      const users = sel.filter((r) => r.kind === "user").map((r) => r.id);
      const teams = sel.filter((r) => r.kind === "team").map((r) => r.id);
      if (users.length || teams.length) {
        await ctx.gh.requestReviewers(ctx.repo, pr.number, users, teams);
      }
      await ctx.gh.markReadyForReview(ctx.repo, pr.number);
      void notify("pr_activity", "Opened for review", `#${pr.number} ${pr.title}`, {
        repo: ctx.repo,
        prNumber: pr.number,
      });
      poller.refresh();
      setOpen(false);
      // advance to the next draft after a beat — this one is on its way out
      const list = usePrData.getState().myDrafts;
      const idx = list.findIndex((p) => p.number === pr.number);
      const remaining = list.filter((p) => p.number !== pr.number);
      const next = remaining[Math.min(Math.max(idx, 0), remaining.length - 1)];
      if (next) {
        setTimeout(() => useUiStore.getState().setFocusedPr("drafts", next.number), 1000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const q = query.trim().toLowerCase();
  const taken = new Set(sel.map((r) => `${r.kind}:${r.id}`));
  const userPool = [...(cands?.users ?? []), ...remote.filter((r) => !cands?.users.includes(r))];
  const matches: Reviewer[] = [
    ...userPool
      .filter((u) => u !== ctx.gh.login && !taken.has(`user:${u}`) && (!q || u.toLowerCase().includes(q)))
      .map((u): Reviewer => ({ kind: "user", id: u })),
    ...(cands?.teams ?? [])
      .filter(
        (t) =>
          !taken.has(`team:${t.slug}`) &&
          (!q || t.slug.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
      )
      .map((t): Reviewer => ({ kind: "team", id: t.slug, sub: t.name })),
  ].slice(0, 9);

  const pick = (r: Reviewer) => {
    setSel((s) => [...s, r]);
    setQuery("");
    setHi(0);
    inputRef.current?.focus();
  };

  const unpick = (r: Reviewer) => {
    setSel((s) => s.filter((x) => !(x.kind === r.kind && x.id === r.id)));
    inputRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!busy) void submit();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (matches[hi]) pick(matches[hi]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => (matches.length ? (h + 1) % matches.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => (matches.length ? (h - 1 + matches.length) % matches.length : 0));
    } else if (e.key === "Backspace" && query === "" && sel.length > 0) {
      e.preventDefault();
      setSel((s) => s.slice(0, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

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
        <div className="row" style={{ marginBottom: 6 }}>
          <span className="subtle" style={{ fontWeight: 600 }}>
            Open #{pr.number} for review
          </span>
          <span style={{ flex: 1 }} />
          <span className="subtle picker-hint">
            ↑↓ · ⏎ add · ⌫ remove · ⌘⏎ submit
          </span>
        </div>

        <div className="picker-box" onClick={() => inputRef.current?.focus()}>
          {sel.map((r) => (
            <button
              key={`${r.kind}:${r.id}`}
              className="small primary picker-chip"
              title={r.sub ?? "Remove"}
              onClick={() => unpick(r)}
            >
              {label(r)} ✕
            </button>
          ))}
          <input
            type="text"
            ref={inputRef}
            autoFocus
            className="picker-input"
            // suppress macOS/WebKit autofill, autocorrect and QuickType here —
            // logins and team slugs are not prose
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={sel.length ? "Add another…" : "Type to search people and teams…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
        </div>

        {!cands ? (
          <div className="subtle" style={{ margin: "6px 0" }}>
            <Spinner /> loading reviewers…
          </div>
        ) : (
          <div className="picker-list">
            {matches.map((m, i) => (
              <div
                key={`${m.kind}:${m.id}`}
                className={`picker-item ${i === hi ? "hi" : ""}`}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the input
                  pick(m);
                }}
              >
                <span>{label(m)}</span>
                {m.sub && <span className="subtle"> {m.sub}</span>}
                {i === hi && <span className="picker-enter subtle">⏎</span>}
              </div>
            ))}
            {matches.length === 0 && (
              <div className="picker-item subtle">
                {searching ? (
                  <>
                    <Spinner /> searching…
                  </>
                ) : (
                  <>no matches{q ? ` for “${query}”` : ""}</>
                )}
              </div>
            )}
          </div>
        )}

        <div className="row" style={{ marginTop: 8 }}>
          <button className="small primary" disabled={busy} onClick={() => void submit()}>
            {busy ? <Spinner /> : null}{" "}
            {sel.length > 0
              ? `Request ${sel.length} review${sel.length > 1 ? "s" : ""} & mark ready`
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
