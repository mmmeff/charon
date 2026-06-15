import { useEffect, useState } from "react";
import { runDraftCreate } from "../lib/flows";
import { useAgentStore, useUiStore } from "../lib/store";
import { Section, Spinner } from "./common";
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
  const runs = useAgentStore((s) => s.runs);
  const order = useAgentStore((s) => s.order);
  const activeRun = order
    .map((id) => runs[id])
    .find(
      (r): r is AgentRun =>
        !!r &&
        r.kind === "draft_create" &&
        r.repo === ctx.repo &&
        !r.draftCreate?.dismissed &&
        (r.status === "running" || r.status === "starting")
    );
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
              <div className="row" style={{ marginTop: 8 }}>
                <button className="primary" disabled={!canSubmit} onClick={() => void submit()}>
                  {busy ? <Spinner /> : null}{" "}
                  Create draft
                </button>
                <ModelPicker value={model} onChange={setModel} flowKind="draft_create" />
                <ReasoningPicker flowKind="draft_create" />
                {branchErr && <span style={{ color: "var(--red)" }}>{branchErr}</span>}
                {error && <span style={{ color: "var(--red)" }}>{error}</span>}
              </div>
            </div>
          </Section>
        </header>
      </div>
    </div>
  );
}
