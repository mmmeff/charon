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
