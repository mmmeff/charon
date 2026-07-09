import type { AgentRun, AgentStatus } from "../types";

/** Quote a shell arg only when it needs it (paths with spaces, etc.). */
const shq = (s: string) => (/^[A-Za-z0-9_./:@=-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);

/**
 * Terminal command to resume this run's harness session, or null when the
 * harness has no known resume CLI (claude-code/codex ACP adapters) or the run
 * predates session capture. Built strictly from launch-time metadata persisted
 * on the run — never from the currently-active harness, which may have
 * changed since.
 */
export function resumeCommand(run: AgentRun): string | null {
 if (!run.sessionId || !run.harnessId || !run.harnessCommand) return null;
 const bin = shq(run.harnessCommand);
 const sid = shq(run.sessionId);
 // Bare command, no `cd` prefix: the explicit session id addresses the
 // session directly, and a released/pruned worktree path would make a cd
 // prefix fail before the harness even runs. The card shows the worktree
 // path separately for context.
 switch (run.harnessId) {
  case "omp":
  case "cursor":
   return `${bin} --resume ${sid}`;
  case "opencode":
   return `${bin} --session ${sid}`;
  default:
   return null;
 }
}

const isCiAnalysisRun = (run: AgentRun): boolean =>
  run.notifyCategory === "ci_analysis" || run.relation.startsWith("CI analysis (");

/** Runs that support background features but should not appear as user-visible agent activity. */
export function isHiddenAgentRun(run: AgentRun): boolean {
  return run.hiddenFromActivity === true || isCiAnalysisRun(run);
}

export function isVisibleAgentRun(run: AgentRun): boolean {
  return !isHiddenAgentRun(run);
}

export function isActiveAgentStatus(status: AgentStatus): boolean {
  return status === "running" || status === "starting";
}
