import type { AgentRun, AgentStatus } from "../types";

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
