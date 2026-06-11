import { useGlobalConfig, useRepoStore } from "../lib/store";

/**
 * Model selection for a run. Empty value = repo/global default. Rendered next
 * to every "run an agent" affordance so the model is choosable before any run.
 */
export function ModelPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (model: string) => void;
}) {
  const global = useGlobalConfig((s) => s.config);
  const repoModel = useRepoStore((s) => s.config.model);
  const models = global?.models ?? [];
  const labels = global?.modelLabels ?? {};
  const def = repoModel || global?.defaultModel || "auto";
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
