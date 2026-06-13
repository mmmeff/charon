import { useState } from "react";
import { Spinner } from "./common";
import { ModelPicker, ReasoningPicker } from "./ModelPicker";
import { PromptInput } from "./PromptInput";

/**
 * Generic agent launch form: optional guidance for the agent plus model
 * choice, so the user can steer the work before it starts. The model pick is
 * one-shot — local to this form, no memory: the next launch starts back at
 * the configured default.
 */
export function AgentLaunchForm({
  label,
  placeholder = "Optional: anything the agent should know or do differently?  ( / for skills )",
  flowKind,
  onRun,
  onClose,
}: {
  label: string;
  placeholder?: string;
  /** AgentKind of the flow this launches — shows the right default in the picker */
  flowKind?: string;
  onRun: (model: string | undefined, guidance: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [model, setModel] = useState("");
  const [guidance, setGuidance] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      await onRun(model || undefined, guidance);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="apply-form">
      <PromptInput
        autoFocus
        rows={2}
        placeholder={placeholder}
        value={guidance}
        onChange={setGuidance}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) void run();
          if (e.key === "Escape") onClose();
        }}
      />
      <div className="row" style={{ marginTop: 6 }}>
        <button className="small primary" disabled={busy} onClick={() => void run()}>
          {busy ? <Spinner /> : null} {label}
        </button>
        <ModelPicker value={model} onChange={setModel} flowKind={flowKind} />
        <ReasoningPicker flowKind={flowKind} />
        <button className="small" onClick={onClose}>
          Cancel
        </button>
        {error && <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>}
      </div>
    </div>
  );
}
