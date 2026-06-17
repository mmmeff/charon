import { createContext, useContext } from "react";
import type { RepoPoller } from "../lib/events";
import type { FlowContext } from "../lib/flows";
import type { PrStackIndex } from "../types";

/**
 * Flow context (GitHub client, repo config, poller) provided by RepoApp.
 * Lives outside RepoApp.tsx so component files export only components —
 * mixed exports break Vite Fast Refresh and force full-state reloads in dev.
 */
export const FlowCtx = createContext<{
  ctx: FlowContext;
  poller: RepoPoller;
  prStacks: PrStackIndex;
} | null>(null);

export function useFlow(): { ctx: FlowContext; poller: RepoPoller; prStacks: PrStackIndex } {
  const v = useContext(FlowCtx);
  if (!v) throw new Error("FlowCtx missing");
  return v;
}
