import { useGlobalConfig } from "../lib/store";

/**
 * Model selection for a run. Empty value = the configured default (per-flow
 * override > global default). Rendered next to every "run an agent"
 * affordance so the model is choosable before any run.
 */
export function ModelPicker({
  value,
  onChange,
  flowKind,
}: {
  value: string;
  onChange: (model: string) => void;
  /** AgentKind whose per-flow default applies when nothing is picked */
  flowKind?: string;
}) {
  const global = useGlobalConfig((s) => s.config);
  const disabled = global?.disabledModels ?? [];
  const models = (global?.models ?? []).filter((m) => !disabled.includes(m));
  // a previously-chosen but now-disabled model stays listed so the select
  // doesn't silently misreport the current value
  if (value && !models.includes(value)) models.push(value);
  const labels = global?.modelLabels ?? {};
  const def = (flowKind ? global?.modelOverrides?.[flowKind] : "") || global?.defaultModel || "auto";
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} title="Model for this run">
      <option value="">model: {labels[def] ?? def} (default)</option>
      {models.map((m) => (
        <option key={m} value={m}>
          {labels[m] ?? m}
        </option>
      ))}
    </select>
  );
}

/**
 * Reasoning-effort selection, shown beside the model picker wherever the
 * active harness exposes a reasoning axis (e.g. codex). A persistent dial:
 * with a flowKind it edits that flow's per-flow override (empty = inherit the
 * global default); without one it edits the global default. Renders nothing
 * for harnesses without the axis (cursor bakes it into the model id; opencode
 * has none).
 */
export function ReasoningPicker({ flowKind }: { flowKind?: string }) {
  const global = useGlobalConfig((s) => s.config);
  const save = useGlobalConfig((s) => s.save);
  const options = global?.reasoningOptions ?? [];
  if (!global || options.length === 0) return null;
  const labels = global.reasoningLabels ?? {};
  const globalDefault = global.reasoningEffort;
  const value = flowKind ? (global.reasoningOverrides?.[flowKind] ?? "") : globalDefault;

  const set = (v: string) => {
    if (flowKind) {
      const next = { ...(global.reasoningOverrides ?? {}) };
      if (v) next[flowKind] = v;
      else delete next[flowKind];
      void save({ ...global, reasoningOverrides: next });
    } else {
      void save({ ...global, reasoningEffort: v });
    }
  };

  // the "inherit" label names what it falls back to
  const defaultLabel = flowKind
    ? `reasoning: ${globalDefault ? labels[globalDefault] ?? globalDefault : "harness default"}`
    : "reasoning: harness default";

  return (
    <select value={value} title="Reasoning effort" onChange={(e) => set(e.target.value)}>
      <option value="">{defaultLabel}{flowKind ? " (default)" : ""}</option>
      {options.map((r) => (
        <option key={r} value={r}>
          reasoning: {labels[r] ?? r}
        </option>
      ))}
    </select>
  );
}
