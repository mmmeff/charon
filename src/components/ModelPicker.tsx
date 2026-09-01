import { modelIdsEncodeReasoning } from "../lib/codexModels";
import {
  MODEL_OVERRIDE_FALLBACKS,
  resolveFlowFastMode,
  resolveFlowReasoning,
} from "../lib/defaults";
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
  const fallbackKind = flowKind
    ? MODEL_OVERRIDE_FALLBACKS[flowKind]
    : undefined;
  const def =
    (flowKind ? global?.modelOverrides?.[flowKind] : "")
    || (fallbackKind ? global?.modelOverrides?.[fallbackKind] : "")
    || global?.defaultModel
    || "auto";
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
 * active harness exposes a separate reasoning axis. A persistent dial:
 * with a flowKind it edits that flow's per-flow override (empty = inherit the
 * route default); without one it edits the global default. Renders nothing
 * when reasoning is already baked into the model id, or the harness has no
 * reasoning axis.
 */
export function ReasoningPicker({ flowKind }: { flowKind?: string }) {
  const global = useGlobalConfig((s) => s.config);
  const save = useGlobalConfig((s) => s.save);
  const options = global?.reasoningOptions ?? [];
  if (
    !global ||
    options.length === 0 ||
    modelIdsEncodeReasoning(global.models)
  ) {
    return null;
  }
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
  const inheritedReasoning = flowKind
    ? resolveFlowReasoning(global, flowKind)
    : globalDefault;
  const defaultLabel = flowKind
    ? `reasoning: ${inheritedReasoning ? labels[inheritedReasoning] ?? inheritedReasoning : "harness default"}`
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

/**
 * Codex Fast service-tier selection. Per-flow picks inherit the global
 * default until the user chooses Standard or Fast explicitly. Mixed-model
 * swarms apply Fast only to the models that advertise support.
 */
export function FastPicker({
  flowKind,
  models = [],
}: {
  flowKind?: string;
  models?: string[];
}) {
  const global = useGlobalConfig((s) => s.config);
  const save = useGlobalConfig((s) => s.save);
  if (!global) return null;

  const fallback =
    (flowKind ? global.modelOverrides?.[flowKind] : "") ||
    global.defaultModel;
  const selected = models.length > 0
    ? models.map((model) => model || fallback)
    : [fallback];
  const fastModels = global.fastModels ?? [];
  const supportedCount = selected.filter((model) =>
    fastModels.includes(model),
  ).length;
  if (
    fastModels.length === 0 ||
    (!!flowKind && supportedCount === 0)
  ) {
    return null;
  }
  const someUnsupported = supportedCount < selected.length;

  const hasOverride =
    !!flowKind &&
    Object.prototype.hasOwnProperty.call(
      global.fastModeOverrides ?? {},
      flowKind,
    );
  const value = flowKind
    ? hasOverride
      ? (global.fastModeOverrides ?? {})[flowKind]
        ? "fast"
        : "standard"
      : ""
    : global.fastMode
      ? "fast"
      : "standard";

  const set = (nextValue: string) => {
    if (!flowKind) {
      void save({
        ...global,
        fastMode: nextValue === "fast",
      });
      return;
    }
    const next = { ...(global.fastModeOverrides ?? {}) };
    if (!nextValue) delete next[flowKind];
    else next[flowKind] = nextValue === "fast";
    void save({ ...global, fastModeOverrides: next });
  };

  const inherited = resolveFlowFastMode(global, flowKind)
    ? "fast"
    : "standard";
  return (
    <select
      value={value}
      title="Codex service tier; Fast uses increased usage"
      onChange={(event) => set(event.target.value)}
    >
      {flowKind && (
        <option value="">speed: {inherited} (default)</option>
      )}
      <option value="standard">speed: standard</option>
      <option value="fast">
        speed: fast{someUnsupported ? " where supported" : ""}
      </option>
    </select>
  );
}
