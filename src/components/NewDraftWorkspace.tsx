import { useEffect, useState } from "react";
import { runDraftCreate } from "../lib/flows";
import { useAgentStore, useUiStore } from "../lib/store";
import { Section, Spinner } from "./common";
import { AsciiMoon } from "./AsciiMoon";
import { ModelPicker, ReasoningPicker } from "./ModelPicker";
import { PromptInput } from "./PromptInput";
import { useFlow } from "./flow";
import type { AgentRun } from "../types";

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
      const runId = await runDraftCreate(ctx, prompt, model || undefined, async (pr) => {
        useUiStore.getState().setFocusedPr("drafts", pr.number);
        onCreated?.(pr.number);
        poller.refresh();
      });
      onStarted?.(runId);
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
                  <ModelPicker value={model} onChange={setModel} flowKind="draft_create" />
                  <ReasoningPicker flowKind="draft_create" />
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
            </div>
          </Section>
        </header>
      </div>
    </div>
  );
}
