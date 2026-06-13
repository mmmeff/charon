import { useGlobalConfig, useRepoStore } from "../lib/store";

/**
 * Model selection for a run. Empty value = the configured default (per-flow
 * override > repo default > global default). Rendered next to every "run an
 * agent" affordance so the model is choosable before any run.
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
  const repoModel = useRepoStore((s) => s.config.model);
  const disabled = global?.disabledModels ?? [];
  const models = (global?.models ?? []).filter((m) => !disabled.includes(m));
  // a previously-chosen but now-disabled model stays listed so the select
  // doesn't silently misreport the current value
  if (value && !models.includes(value)) models.push(value);
  const labels = global?.modelLabels ?? {};
  const def =
    (flowKind ? global?.modelOverrides?.[flowKind] : "") ||
    repoModel ||
    global?.defaultModel ||
    "auto";
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
 * active harness exposes a reasoning axis (e.g. codex). Bound to the global
 * reasoning effort — a persistent dial, applied to every run — so it reads
 * and writes the same value everywhere it appears. Renders nothing for
 * harnesses without the axis (cursor bakes it into the model id; opencode
 * has none).
 */
export function ReasoningPicker() {
  const global = useGlobalConfig((s) => s.config);
  const save = useGlobalConfig((s) => s.save);
  const options = global?.reasoningOptions ?? [];
  if (!global || options.length === 0) return null;
  const labels = global.reasoningLabels ?? {};
  return (
    <select
      value={global.reasoningEffort}
      title="Reasoning effort (applies to every run)"
      onChange={(e) => void save({ ...global, reasoningEffort: e.target.value })}
    >
      <option value="">reasoning: harness default</option>
      {options.map((r) => (
        <option key={r} value={r}>
          reasoning: {labels[r] ?? r}
        </option>
      ))}
    </select>
  );
}
