export interface ModelCatalogEntry {
 modelId: string;
 name: string;
}

interface CodexDebugModel {
 slug?: unknown;
 display_name?: unknown;
 visibility?: unknown;
 default_reasoning_level?: unknown;
 supported_reasoning_levels?: unknown;
 additional_speed_tiers?: unknown;
}

interface CodexReasoningLevel {
 effort?: unknown;
}

const CODEX_ACP_REASONING_LEVELS = new Set([
 "low",
 "medium",
 "high",
 "xhigh",
]);

function debugPayload(
 stdout: string,
): { models: CodexDebugModel[] } | undefined {
 let payload: unknown;
 try {
  payload = JSON.parse(stdout);
 } catch {
  return undefined;
 }

 if (
  !payload ||
  typeof payload !== "object" ||
  !Array.isArray((payload as { models?: unknown }).models)
 ) {
  return undefined;
 }
 return payload as { models: CodexDebugModel[] };
}

function debugModels(stdout: string): CodexDebugModel[] {
 return debugPayload(stdout)?.models ?? [];
}

/**
 * Build a model catalog that codex-acp 0.16.0's embedded Codex core can
 * deserialize. The installed CLI may know newer reasoning levels; retaining
 * those makes the older bridge reject the entire catalog and fall back to
 * metadata that disables reasoning and service tiers for new model ids.
 */
export function codexAcpModelCatalog(
 stdout: string,
): string | undefined {
 const payload = debugPayload(stdout);
 if (!payload || payload.models.length === 0) return undefined;

 for (const model of payload.models) {
  if (!model || typeof model !== "object") continue;
  if (Array.isArray(model.supported_reasoning_levels)) {
   model.supported_reasoning_levels =
    model.supported_reasoning_levels.filter(
     (level) =>
      !!level &&
      typeof level === "object" &&
      typeof (level as CodexReasoningLevel).effort === "string" &&
      CODEX_ACP_REASONING_LEVELS.has(
       (level as CodexReasoningLevel).effort as string,
      ),
    );
  }
  if (
   typeof model.default_reasoning_level === "string" &&
   !CODEX_ACP_REASONING_LEVELS.has(model.default_reasoning_level)
  ) {
   const supported = Array.isArray(model.supported_reasoning_levels)
    ? model.supported_reasoning_levels
    : [];
   model.default_reasoning_level =
    (supported.at(-1) as CodexReasoningLevel | undefined)?.effort ??
    null;
  }
 }

 return JSON.stringify(payload);
}

/** Parse the visible picker models emitted by `codex debug models`. */
export function listedCodexModels(stdout: string): ModelCatalogEntry[] {
 const models: ModelCatalogEntry[] = [];
 for (const raw of debugModels(stdout)) {
  if (
   !raw ||
   typeof raw !== "object" ||
   raw.visibility !== "list" ||
   typeof raw.slug !== "string"
  ) {
   continue;
  }
  models.push({
   modelId: raw.slug,
   name:
    typeof raw.display_name === "string"
     ? raw.display_name
     : raw.slug,
  });
 }
 return models;
}

/**
 * Reasoning levels supported by every visible Codex model and by the older
 * Codex core embedded in codex-acp 0.16.0.
 */
export function commonCodexReasoningLevels(
 stdout: string,
): ModelCatalogEntry[] {
 const visible = debugModels(stdout).filter(
  (model) =>
   model &&
   typeof model === "object" &&
   model.visibility === "list" &&
   typeof model.slug === "string",
 );
 if (visible.length === 0) return [];

 const levels = visible.map((model) => {
  if (!Array.isArray(model.supported_reasoning_levels)) return [];
  return model.supported_reasoning_levels
   .filter(
    (level): level is CodexReasoningLevel =>
     !!level &&
     typeof level === "object" &&
     typeof level.effort === "string",
   )
   .map((level) => level.effort as string);
 });
 if (levels.some((supported) => supported.length === 0)) return [];

 const names: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Xhigh",
 };
 return levels[0]
  .filter(
   (effort) =>
    CODEX_ACP_REASONING_LEVELS.has(effort) &&
    levels.every((supported) => supported.includes(effort)),
  )
  .map((effort) => ({
   modelId: effort,
   name: names[effort] ?? effort,
  }));
}

/** Visible Codex models that advertise the Fast service tier. */
export function fastCodexModels(stdout: string): string[] {
 return debugModels(stdout)
  .filter(
   (model) =>
    model &&
    typeof model === "object" &&
    model.visibility === "list" &&
    typeof model.slug === "string" &&
    Array.isArray(model.additional_speed_tiers) &&
    model.additional_speed_tiers.includes("fast"),
  )
  .map((model) => model.slug as string);
}

export function isCodexBridge(
 command: string,
 args: string[],
): boolean {
 const executable = command
  .replaceAll("\\", "/")
  .split("/")
  .at(-1)
  ?.replace(/\.exe$/i, "");
 return (
  executable === "codex-acp" ||
  args.some((arg) =>
   /^@zed-industries\/codex-acp(?:@|$)/.test(arg),
  )
 );
}

/**
 * Pass a supported reasoning level as an ephemeral Codex config override.
 * The bridge applies this before it opens a session, including for new model
 * ids that its embedded model catalog does not recognize.
 */
export function codexBridgeArgs(
 command: string,
 args: string[],
 reasoning: string,
 fast: boolean,
 modelCatalogPath?: string,
): string[] {
 if (!isCodexBridge(command, args)) return args;
 const overrides: string[] = [];
 if (modelCatalogPath) {
  overrides.push(
   "-c",
   `model_catalog_json=${JSON.stringify(modelCatalogPath)}`,
  );
 }
 if (CODEX_ACP_REASONING_LEVELS.has(reasoning)) {
  overrides.push(
   "-c",
   `model_reasoning_effort=${JSON.stringify(reasoning)}`,
  );
 }
 overrides.push(
  "-c",
  `service_tier=${JSON.stringify(fast ? "priority" : "default")}`,
 );
 return overrides.length > 0 ? [...args, ...overrides] : args;
}

/**
 * Merge a fresher supplemental catalog into a primary catalog.
 * Supplemental labels win while the primary ordering stays stable.
 */
export function mergeModelCatalogs(
 primary: ModelCatalogEntry[],
 supplemental: ModelCatalogEntry[],
): ModelCatalogEntry[] {
 const merged = new Map<string, ModelCatalogEntry>();
 for (const model of primary) merged.set(model.modelId, model);
 for (const model of supplemental) merged.set(model.modelId, model);
 return [...merged.values()];
}
