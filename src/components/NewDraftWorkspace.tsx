import { useEffect, useState } from "react";
import { runDraftCreate } from "../lib/flows";
import { startSwarm } from "../lib/swarm";
import { useAgentStore, useSwarmStore, useUiStore } from "../lib/store";
import { uid } from "../lib/template";
import { Section, Spinner } from "./common";
import { AsciiMoon } from "./AsciiMoon";
import { ModelPicker, ReasoningPicker } from "./ModelPicker";
import { PromptInput } from "./PromptInput";
import { SwarmHost } from "./SwarmHost";
import { useFlow } from "./flow";
import type { AgentRun, SwarmContenderSpec } from "../types";

/** Prompt-first surface for creating a brand-new draft PR. */
export function NewDraftWorkspace({
  onStarted,
  onCreated,
}: {
  onStarted?: (runId: string) => void;
  onCreated?: (prNumber: number) => void;
}) {
  const { ctx, poller } = useFlow();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");
  const [branchErr, setBranchErr] = useState("");
  // Agent rows — always at least 1. 1 row = single-run; 2+ = swarm.
  const [agents, setAgents] = useState<SwarmContenderSpec[]>([{ id: uid("c-"), model: "" }]);
  const model = agents[0]?.model ?? "";
  const setModel = (m: string) => setAgents((prev) => [{ ...prev[0], model: m }, ...prev.slice(1)]);
  const addAgent = () => {
    if (agents.length >= 3) return;
    setAgents((prev) => [...prev, { id: uid("c-"), model: "" }]);
  };
  const removeAgent = (id: string) => {
    if (agents.length <= 1) return;
    setAgents((prev) => prev.filter((a) => a.id !== id));
  };
  const setAgentModel = (id: string, m: string) => {
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, model: m } : a)));
  };
  // Active draft_create swarm for this repo — mount SwarmHost instead of the
  // single-run activeRun card below when present.
  const swarm = useSwarmStore((s) => {
    for (const id of s.order) {
      const sw = s.swarms[id];
      if (sw && sw.trigger.repo === ctx.repo && sw.flowKind === "draft_create" && sw.status === "running") return sw;
    }
    return undefined;
  });
  const swarmActive = !!swarm;
  // The active draft_create run for this repo (not dismissed, still running).
  // Slice to a single AgentRun ref — the default `Object.is` equality means
  // we re-render only when this run changes, ignoring chunks on other agents.
  const activeRun = useAgentStore((s) => {
    for (const id of s.order) {
      const r = s.runs[id];
      if (
        r &&
        r.kind === "draft_create" &&
        r.repo === ctx.repo &&
        !r.draftCreate?.dismissed &&
        (r.status === "running" || r.status === "starting")
      ) {
        return r;
      }
    }
    return undefined;
  });
  const draftCfg = ctx.config.draftCreate;
  const canSubmit = !!prompt.trim() && !busy && !activeRun && (!!draftCfg.baseBranch.trim() || !!defaultBranch);

  useEffect(() => {
    let cancelled = false;
    setBranchErr("");
    void ctx.gh.defaultBranch(ctx.repo)
      .then((branch) => {
        if (!cancelled) setDefaultBranch(branch);
      })
      .catch((e) => {
        if (!cancelled) setBranchErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.gh, ctx.repo]);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (agents.length > 1) {
        await startSwarm({
          ctx,
          flowKind: "draft_create",
          trigger: {
            repo: ctx.repo,
            prNumber: null,
            prTitle: "New draft PR",
            prompt,
          },
          contenders: agents,
          onCreated: (pr) => {
            useUiStore.getState().setFocusedPr("drafts", pr.number);
            onCreated?.(pr.number);
            poller.refresh();
          },
        });
      } else {
        const runId = await runDraftCreate(ctx, prompt, model || undefined, async (pr) => {
          useUiStore.getState().setFocusedPr("drafts", pr.number);
          onCreated?.(pr.number);
          poller.refresh();
        });
        onStarted?.(runId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="workspace new-draft-workspace">
      <AsciiMoon fill />
      <div className="empty-stage-scrim" aria-hidden />
      <div className="ws-main pr-shell">
        <header className="pr-hero new-draft-hero">
          <div className="pr-hero-id">
            <h2>New draft PR</h2>
          </div>

          <Section label="Prompt">
            <div className="card composer new-draft-composer">
              <PromptInput
                autoFocus
                rows={8}
                placeholder="Describe the PR to create…  ( / for skills )"
                value={prompt}
                onChange={setPrompt}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) void submit();
                }}
              />
              <div className="composer-footer">
                <div className="composer-controls">
                  <ReasoningPicker flowKind="draft_create" />
                  <div className="composer-agents">
                    {agents.map((a) => (
                      <div key={a.id} className="composer-agent-row">
                        <ModelPicker value={a.model} onChange={(m) => setAgentModel(a.id, m)} flowKind="draft_create" />
                        {agents.length > 1 && (
                          <button
                            className="composer-agent-rm"
                            onClick={() => removeAgent(a.id)}
                            title="remove this contender"
                            aria-label="remove this contender"
                          >×</button>
                        )}
                      </div>
                    ))}
                    {agents.length < 3 && (
                      <button className="composer-agent-add" onClick={addAgent} title="run N models in parallel; keep the better output">
                        + add contender
                      </button>
                    )}
                  </div>
                </div>
                <div className="composer-actions">
                  <button className="primary composer-submit" disabled={!canSubmit} onClick={() => void submit()}>
                    {busy ? <Spinner /> : null}
                    <span>Create draft</span>
                  </button>
                </div>
                {(branchErr || error) && (
                  <div className="composer-error">{branchErr || error}</div>
                )}
              </div>
              {swarmActive && swarm && (
                <SwarmHost swarm={swarm} embedded />
              )}
            </div>
          </Section>
        </header>
      </div>
    </div>
  );
}
