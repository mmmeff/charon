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
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");
  const [branchErr, setBranchErr] = useState("");
  // Swarm opt-in (Q4: default off — single-run path byte-identical when off).
  const [swarm, setSwarm] = useState(false);
  const [contenders, setContenders] = useState<SwarmContenderSpec[]>([]);
  const toggleSwarm = () => {
    if (!swarm) {
      setContenders([{ id: uid("c-"), model }]);
    } else {
      if (contenders[0]) setModel(contenders[0].model);
      setContenders([]);
    }
    setSwarm(!swarm);
  };
  const addContender = () => {
    if (contenders.length >= 3) return;
    setContenders([...contenders, { id: uid("c-"), model: "" }]);
  };
  const removeContender = (id: string) => {
    if (contenders.length <= 1) return;
    setContenders(contenders.filter((c) => c.id !== id));
  };
  const setContenderModel = (id: string, m: string) => {
    setContenders(contenders.map((c) => (c.id === id ? { ...c, model: m } : c)));
  };
  // Active draft_create swarm for this repo — mount SwarmHost instead of the
  // single-run activeRun card below when present (Q4: no-swarm path untouched).
  const swarmActive = useSwarmStore((s) => {
    for (const id of s.order) {
      const sw = s.swarms[id];
      if (sw && sw.trigger.repo === ctx.repo && sw.flowKind === "draft_create" && sw.status === "running") return true;
    }
    return false;
  });
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
      if (swarm) {
        await startSwarm({
          ctx,
          flowKind: "draft_create",
          trigger: {
            repo: ctx.repo,
            prNumber: null,
            prTitle: "New draft PR",
            prompt,
          },
          contenders,
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
                  {swarm ? (
                    <>
                      <ReasoningPicker flowKind="draft_create" />
                      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
                        {contenders.map((c, i) => (
                          <div key={c.id} className="row" style={{ alignItems: "center", gap: 4 }}>
                            <span className="subtle" style={{ fontSize: 11, minWidth: 18 }}>#{i + 1}</span>
                            <ModelPicker value={c.model} onChange={(m) => setContenderModel(c.id, m)} flowKind="draft_create" />
                            {contenders.length > 1 && (
                              <button className="small" onClick={() => removeContender(c.id)}>−</button>
                            )}
                          </div>
                        ))}
                        {contenders.length < 3 && (
                          <button className="small" onClick={addContender}>+ contender</button>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <ModelPicker value={model} onChange={setModel} flowKind="draft_create" />
                      <ReasoningPicker flowKind="draft_create" />
                    </>
                  )}
                </div>
                <div className="composer-actions">
                  <button
                    className={`small ${swarm ? "primary" : ""}`}
                    onClick={toggleSwarm}
                    title={swarm ? "back to single run" : "fan out to N parallel contenders"}
                  >
                    Swarm
                  </button>
                  <button className="primary composer-submit" disabled={!canSubmit} onClick={() => void submit()}>
                    {busy ? <Spinner /> : null}
                    <span>Create draft</span>
                  </button>
                </div>
                {(branchErr || error) && (
                  <div className="composer-error">{branchErr || error}</div>
                )}
              </div>
              {swarmActive && (
                <SwarmHost prNumber={null} onReloadDiff={() => undefined} />
              )}
            </div>
          </Section>
        </header>
      </div>
    </div>
  );
}
