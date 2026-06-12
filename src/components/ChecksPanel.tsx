import { useEffect, useMemo, useRef, useState } from "react";
import { resolveHandler, usePrData } from "../lib/events";
import { runCheckAnalysis, runFixFlow } from "../lib/flows";
import { GitHubClient } from "../lib/github";
import { useCiAnalysis, useRepoStore } from "../lib/store";
import { interpolate, prVars } from "../lib/template";
import type { CheckInfo, PrSummary } from "../types";
import { AgentLaunchForm } from "./AgentLaunchForm";
import { AsciiField } from "./AsciiField";
import { Badge, Spinner } from "./common";
import { useFlow } from "./flow";

const ERR_RE = /\berror(s)?\b|\bfail(?:ed|ure|ing)?\b|fatal|exception|traceback|panic|✗|✘|×/i;
const WARN_RE = /\bwarn(?:ing)?s?\b|deprecat/i;

/**
 * One check's log: error/warning lines color-coded, auto-scrolled to the
 * first error (or the tail when nothing matches — failures usually die at
 * the end of the log).
 */
function CheckLog({ loading, text }: { loading: boolean; text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => text.split("\n"), [text]);

  useEffect(() => {
    const el = ref.current;
    if (loading || !el) return;
    const first = el.querySelector<HTMLElement>(".log-err");
    if (first) el.scrollTop = Math.max(0, first.offsetTop - 60);
    else el.scrollTop = el.scrollHeight;
  }, [loading, text]);

  return (
    <div className="check-log" ref={ref}>
      {loading ? (
        <span className="subtle">
          <Spinner /> fetching log…
        </span>
      ) : (
        <pre>
          {lines.map((l, i) => (
            <div
              key={i}
              className={`log-line ${ERR_RE.test(l) ? "log-err" : WARN_RE.test(l) ? "log-warn" : ""}`}
            >
              {l || " "}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

const UI_LOG_TAIL = 40_000;
const AGENT_LOG_TAIL = 16_000;

const glyphFor = (c: CheckInfo): { glyph: string; color: string } => {
  if (!c.conclusion) return { glyph: "●", color: "var(--amber)" };
  switch (c.conclusion) {
    case "success":
      return { glyph: "✓", color: "var(--acid)" };
    case "failure":
    case "error":
      return { glyph: "✗", color: "var(--red)" };
    case "cancelled":
    case "timed_out":
      return { glyph: "⊘", color: "var(--amber)" };
    default:
      return { glyph: "—", color: "var(--fg-subtle)" }; // skipped | neutral
  }
};

const duration = (c: CheckInfo): string => {
  if (!c.startedAt) return "";
  const end = c.completedAt ? Date.parse(c.completedAt) : Date.now();
  const sec = Math.max(0, Math.round((end - Date.parse(c.startedAt)) / 1000));
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60 ? ` ${sec % 60}s` : ""}`;
};

/**
 * CI panel for own PRs: per-check summary, drill-in log viewer, and the
 * fix pipeline — "Fix with agent" feeds the failing check's log tail into a
 * fix-flow agent as additional context.
 */
export function ChecksPanel({ pr }: { pr: PrSummary }) {
  const { ctx, poller } = useFlow();
  // fix agents push to the PR branch — own PRs only; teammates get a
  // read-only panel (logs + retry, both plain GitHub actions)
  const mine = pr.author === ctx.gh.login;
  const allChecks = usePrData((s) => s.checks[pr.number] ?? []);
  // skipped jobs are noise (path filters, matrix exclusions) — hide them
  const checks = allChecks.filter((c) => c.conclusion !== "skipped");
  const failing = checks.filter((c) => c.conclusion === "failure" || c.conclusion === "error");
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const [logs, setLogs] = useState<Record<string, { loading: boolean; text: string; open: boolean }>>({});
  const [fixOpen, setFixOpen] = useState<Record<string, boolean>>({});
  const [retrying, setRetrying] = useState<Record<string, "busy" | "queued" | string>>({});

  const expanded = openOverride ?? failing.length > 0;
  const running = checks.filter((c) => !c.conclusion).length;
  const passed = checks.filter((c) => c.conclusion === "success").length;

  // live CI: while the panel is expanded AND scrolled into view, refresh the
  // check list every 5s (one cheap API call; full polls still reconcile)
  const panelRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => setInView(es.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!expanded || !inView) return;
    const t = setInterval(() => void poller.refreshChecks(pr.number, pr.headSha), 5000);
    return () => clearInterval(t);
  }, [expanded, inView, pr.number, pr.headSha, poller]);

  const fetchLog = async (c: CheckInfo): Promise<string> => {
    const cached = logs[c.name];
    if (cached?.text) return cached.text;
    setLogs((l) => ({ ...l, [c.name]: { loading: true, text: "", open: true } }));
    const text = (await ctx.gh.getCheckLog(ctx.repo, c).catch(() => "")) || "(no log available)";
    const tail = text.slice(-UI_LOG_TAIL);
    setLogs((l) => ({ ...l, [c.name]: { loading: false, text: tail, open: l[c.name]?.open ?? true } }));
    return tail;
  };

  const toggleLog = (c: CheckInfo) => {
    const cur = logs[c.name];
    if (cur?.text || cur?.loading) {
      setLogs((l) => ({ ...l, [c.name]: { ...l[c.name], open: !l[c.name].open } }));
    } else {
      void fetchLog(c);
    }
  };

  const fix = async (c: CheckInfo, model?: string, guidance?: string) => {
    const handler = resolveHandler(ctx.config.events, "ci_failed");
    let task = interpolate(handler.prompt, {
      ...prVars(pr),
      repo: ctx.repo,
      "check-name": c.name,
      "check-url": c.url,
    });
    const log = await fetchLog(c);
    task += `\n\nFAILING CHECK: ${c.name}${c.outputTitle ? ` — ${c.outputTitle}` : ""}
LOG TAIL:
\`\`\`
${log.slice(-AGENT_LOG_TAIL)}
\`\`\``;
    if (guidance?.trim()) {
      task += `\n\nADDITIONAL GUIDANCE FROM THE USER (takes precedence):\n${guidance.trim()}`;
    }
    await runFixFlow(ctx, pr, task, `CI fix (${c.name})`, "ci_fix", model);
  };

  // auto-triage: every failed check gets a one-liner analysis (default model
  // Composer 2.5 Fast), keyed by head sha so new pushes re-analyze.
  // Settings → CI: master toggle + per-check ignore list.
  const autoAnalysis = ctx.config.ciAutoAnalysis !== false;
  const ignored = ctx.config.ignoredChecks ?? [];
  const analyses = useCiAnalysis((s) => s.map);
  const analysisKey = (c: CheckInfo) => `${pr.number}:${c.name}:${pr.headSha}`;
  const analyze = (c: CheckInfo) => {
    const key = analysisKey(c);
    if (useCiAnalysis.getState().map[key]?.status === "running") return;
    useCiAnalysis.getState().set(key, { status: "running", text: "" });
    runCheckAnalysis(ctx, pr, c)
      .then((text) => useCiAnalysis.getState().set(key, { status: "done", text }))
      .catch((e) =>
        useCiAnalysis.getState().set(key, {
          status: "error",
          text: e instanceof Error ? e.message : String(e),
        })
      );
  };
  // auto-run on the user's own PRs only — teammate PRs analyze on demand
  useEffect(() => {
    if (!autoAnalysis || !mine) return;
    for (const c of failing) {
      if (ignored.includes(c.name)) continue;
      if (useCiAnalysis.getState().map[analysisKey(c)]) continue;
      analyze(c);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr.number, pr.headSha, autoAnalysis, mine, ignored.join("|"), failing.map((c) => c.name).join("|")]);

  const ignoreCheck = (name: string) => {
    void useRepoStore
      .getState()
      .saveConfig({ ...ctx.config, ignoredChecks: [...new Set([...ignored, name])] });
  };

  // teammate PRs: post the (already-read) analysis as a PR comment
  const [commented, setCommented] = useState<Record<string, "busy" | "sent" | string>>({});
  const commentAnalysis = async (c: CheckInfo, text: string) => {
    setCommented((m) => ({ ...m, [c.name]: "busy" }));
    try {
      await ctx.gh.createIssueComment(
        ctx.repo,
        pr.number,
        `**CI failure** — \`${c.name}\`: ${text}${c.url ? `\n\n${c.url}` : ""}`
      );
      setCommented((m) => ({ ...m, [c.name]: "sent" }));
      void poller.refreshPr(pr.number);
    } catch (e) {
      setCommented((m) => ({ ...m, [c.name]: e instanceof Error ? e.message : String(e) }));
    }
  };

  const retry = async (c: CheckInfo) => {
    setRetrying((r) => ({ ...r, [c.name]: "busy" }));
    try {
      await ctx.gh.rerunCheck(ctx.repo, c.url);
      setRetrying((r) => ({ ...r, [c.name]: "queued" }));
      void poller.refreshPr(pr.number);
    } catch (e) {
      setRetrying((r) => ({ ...r, [c.name]: e instanceof Error ? e.message : String(e) }));
    }
  };

  if (checks.length === 0) return null;

  return (
    <div className="card checks-panel" ref={panelRef}>
      <div className="row checks-head">
        {running > 0 && (
          <div className="checks-head-fx" aria-hidden>
            <AsciiField height={34} color="255, 176, 0" opacity={0.28} speed={1.5} />
          </div>
        )}
        <button className="link small" onClick={() => setOpenOverride(!expanded)}>
          {expanded ? "▾" : "▸"}
        </button>
        <span className="checks-title">Checks</span>
        <Badge color={failing.length ? "red" : running ? "yellow" : "green"}>
          {failing.length
            ? `${failing.length} failing`
            : running
              ? `${running} running`
              : "all passing"}
        </Badge>
        <span className="subtle">
          {passed}/{checks.length} passed
        </span>
      </div>

      {expanded && (
      <div className="checks-list">
        {checks.map((c) => {
          const g = glyphFor(c);
          const log = logs[c.name];
          const failed = c.conclusion === "failure" || c.conclusion === "error";
          const retryable =
            ["failure", "error", "cancelled", "timed_out"].includes(c.conclusion ?? "") &&
            GitHubClient.actionsJobRef(c.url) !== null;
          const retryState = retrying[c.name];
          return (
            <div key={c.name} className="check-row">
              <div className="row">
                <span className="check-glyph" style={{ color: g.color }}>
                  {g.glyph}
                </span>
                <span className="check-name">{c.name}</span>
                {c.outputTitle && <span className="subtle check-output">{c.outputTitle}</span>}
                <span style={{ flex: 1 }} />
                <span className="subtle">{duration(c)}</span>
                <button className="link small" onClick={() => toggleLog(c)}>
                  {log?.open ? "hide logs" : "logs"}
                </button>
                {failed && !ignored.includes(c.name) && !analyses[analysisKey(c)] && (
                  <button
                    className="link small"
                    title="Run a fast read-only agent to summarize this failure"
                    onClick={() => analyze(c)}
                  >
                    ✦ analyze
                  </button>
                )}
                {retryable &&
                  (retryState === "queued" ? (
                    <span className="subtle" style={{ fontSize: 10.5 }}>
                      re-queued ✓
                    </span>
                  ) : (
                    <button
                      className="small"
                      disabled={retryState === "busy"}
                      title="Re-run this job (falls back to re-running all failed jobs when GitHub won't re-run it alone)"
                      onClick={() => void retry(c)}
                    >
                      {retryState === "busy" ? <Spinner /> : "↻"} Retry
                    </button>
                  ))}
                {failed && mine && (
                  <button
                    className={`small ${fixOpen[c.name] ? "" : "primary"}`}
                    onClick={() => setFixOpen((f) => ({ ...f, [c.name]: !f[c.name] }))}
                  >
                    Fix with agent
                  </button>
                )}
                <a href={c.url} target="_blank" rel="noreferrer" className="subtle">
                  ↗
                </a>
              </div>
              {retryState && retryState !== "busy" && retryState !== "queued" && (
                <div style={{ color: "var(--red)", fontSize: 11, marginTop: 2 }}>
                  retry failed: {retryState}
                </div>
              )}
              {failed &&
                (() => {
                  if (ignored.includes(c.name)) return null;
                  const a = analyses[analysisKey(c)];
                  if (!a) return null;
                  const sent = commented[c.name];
                  return (
                    <div className="check-analysis">
                      {a.status === "running" ? (
                        <span className="subtle">
                          <Spinner /> analyzing…
                        </span>
                      ) : a.status === "done" ? (
                        <>
                          {a.text}
                          <span className="check-analysis-actions">
                            <button
                              className="link small"
                              title={
                                mine
                                  ? "Launch a fix agent (guidance + model)"
                                  : `Launch a fix agent on ${pr.author}'s branch — you're explicitly authorizing the push`
                              }
                              onClick={() => setFixOpen((f) => ({ ...f, [c.name]: !f[c.name] }))}
                            >
                              ⚙ fix
                            </button>
                            {!mine &&
                              (sent === "sent" ? (
                                <span className="subtle">commented ✓</span>
                              ) : (
                                <button
                                  className="link small"
                                  disabled={sent === "busy"}
                                  title="Post this analysis as a PR comment for the author"
                                  onClick={() => void commentAnalysis(c, a.text)}
                                >
                                  {sent === "busy" ? <Spinner /> : "↪"} comment to author
                                </button>
                              ))}
                            {sent && sent !== "busy" && sent !== "sent" && (
                              <span style={{ color: "var(--red)" }}>{sent}</span>
                            )}
                            <button
                              className="link small"
                              title="Never auto-analyze this check again (manage in Settings → CI)"
                              onClick={() => ignoreCheck(c.name)}
                            >
                              ✕ ignore
                            </button>
                          </span>
                        </>
                      ) : (
                        <span className="subtle">analysis unavailable — {a.text}</span>
                      )}
                    </div>
                  );
                })()}
              {failed && fixOpen[c.name] && (
                <AgentLaunchForm
                  label={`Fix ${c.name}`}
                  flowKind="ci_fix"
                  placeholder="Optional: extra context — suspected cause, constraints, what not to touch  ( / for skills )"
                  onRun={(model, guidance) => fix(c, model, guidance)}
                  onClose={() => setFixOpen((f) => ({ ...f, [c.name]: false }))}
                />
              )}
              {log?.open && <CheckLog loading={log.loading} text={log.text} />}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
