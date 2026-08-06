import assert from "node:assert/strict";
import test from "node:test";

import {
  codexAcpModelCatalog,
  codexBridgeArgs,
  codexRuntimeErrorSummary,
  commonCodexReasoningLevels,
  fastCodexModels,
  harnessEnvironment,
  isCodexBridge,
  isLegacyCodexBridge,
  listedCodexModels,
  MAINTAINED_CODEX_ACP_PACKAGE,
  mergeModelCatalogs,
  migrateCodexHarness,
} from "../../src/lib/codexModels.ts";

test("listedCodexModels keeps visible models and hides internal entries", () => {
  const models = listedCodexModels(JSON.stringify({
    models: [
      {
        slug: "gpt-5.6-sol",
        display_name: "GPT-5.6-Sol",
        visibility: "list",
      },
      {
        slug: "gpt-5.6-sol-wm",
        display_name: "GPT-5.6-Sol-WM",
        visibility: "hide",
      },
      {
        slug: "gpt-5.6-terra",
        display_name: "GPT-5.6-Terra",
        visibility: "list",
      },
      {
        slug: "gpt-5.6-luna",
        display_name: "GPT-5.6-Luna",
        visibility: "list",
      },
    ],
  }));

  assert.deepEqual(models, [
    { modelId: "gpt-5.6-sol", name: "GPT-5.6-Sol" },
    { modelId: "gpt-5.6-terra", name: "GPT-5.6-Terra" },
    { modelId: "gpt-5.6-luna", name: "GPT-5.6-Luna" },
  ]);
});

test("commonCodexReasoningLevels keeps only levels every visible model and the bridge support", () => {
  const levels = commonCodexReasoningLevels(JSON.stringify({
    models: [
      {
        slug: "gpt-5.6-sol",
        visibility: "list",
        supported_reasoning_levels: [
          { effort: "low" },
          { effort: "medium" },
          { effort: "high" },
          { effort: "xhigh" },
          { effort: "max" },
          { effort: "ultra" },
        ],
      },
      {
        slug: "gpt-5.6-luna",
        visibility: "list",
        supported_reasoning_levels: [
          { effort: "low" },
          { effort: "medium" },
          { effort: "high" },
          { effort: "xhigh" },
          { effort: "max" },
        ],
      },
    ],
  }));

  assert.deepEqual(levels, [
    { modelId: "low", name: "Low" },
    { modelId: "medium", name: "Medium" },
    { modelId: "high", name: "High" },
    { modelId: "xhigh", name: "Xhigh" },
  ]);
});

test("codexBridgeArgs adds a supported ephemeral reasoning override", () => {
  assert.deepEqual(
    codexBridgeArgs(
      "npx",
      ["-y", "@zed-industries/codex-acp"],
      "xhigh",
      true,
      "/tmp/codex models.json",
    ),
    [
      "-y",
      "@zed-industries/codex-acp",
      "-c",
      "model_catalog_json=\"/tmp/codex models.json\"",
      "-c",
      "model_reasoning_effort=\"xhigh\"",
      "-c",
      "service_tier=\"priority\"",
    ],
  );
  assert.deepEqual(
    codexBridgeArgs(
      "npx",
      ["-y", "@zed-industries/codex-acp"],
      "max",
      false,
    ),
    [
      "-y",
      "@zed-industries/codex-acp",
      "-c",
      "service_tier=\"default\"",
    ],
  );
  assert.deepEqual(
    codexBridgeArgs(
      "codex-acp",
      [],
      "",
      true,
    ),
    [],
  );
  assert.deepEqual(
    codexBridgeArgs(
      "npx",
      ["-y", MAINTAINED_CODEX_ACP_PACKAGE],
      "xhigh",
      true,
      "/tmp/stale-catalog.json",
    ),
    ["-y", MAINTAINED_CODEX_ACP_PACKAGE],
  );
  assert.deepEqual(
    codexBridgeArgs(
      "cursor-agent",
      ["acp"],
      "xhigh",
      true,
    ),
    ["acp"],
  );
});

test("Codex bridge detection separates the archived adapter shim", () => {
  assert.equal(
    isCodexBridge("npx", ["-y", MAINTAINED_CODEX_ACP_PACKAGE]),
    true,
  );
  assert.equal(
    isLegacyCodexBridge("npx", ["-y", MAINTAINED_CODEX_ACP_PACKAGE]),
    false,
  );
  assert.equal(
    isLegacyCodexBridge("npx", ["-y", "@zed-industries/codex-acp"]),
    true,
  );
});

test("Codex runtime version failures become plain remediation copy", () => {
  assert.equal(
    codexRuntimeErrorSummary(
      "The 'gpt-5.6-sol' model requires a newer version of Codex.",
    ),
    "This model rejected the Codex runtime Charon launched. Choose your current Codex executable under Settings > Agent harness, then Verify. Updating Charon does not update that executable.",
  );
  assert.equal(codexRuntimeErrorSummary("rate limited"), undefined);
});

test("the stock archived adapter migrates to the selected Codex runtime", () => {
  const migrated = migrateCodexHarness({
    id: "codex",
    name: "Codex CLI",
    command: "npx",
    args: ["-y", "@zed-industries/codex-acp"],
  });
  const custom = {
    id: "codex",
    name: "Custom Codex",
    command: "/opt/tools/codex-acp",
    args: ["--custom"],
  };

  assert.deepEqual(migrated.args, ["-y", MAINTAINED_CODEX_ACP_PACKAGE]);
  assert.equal(migrated.codexPath, "codex");
  assert.deepEqual(harnessEnvironment(migrated), { CODEX_PATH: "codex" });
  assert.deepEqual(migrateCodexHarness(custom), custom);
});

test("CODEX_PATH belongs only to the Codex harness", () => {
  assert.deepEqual(
    harnessEnvironment({
      id: "codex",
      command: "codex-acp",
      args: [],
      codexPath: "/opt/codex/bin/codex",
    }),
    { CODEX_PATH: "/opt/codex/bin/codex" },
  );
  assert.equal(
    harnessEnvironment({
      id: "cursor",
      command: "cursor-agent",
      args: ["acp"],
      codexPath: "/opt/codex/bin/codex",
    }),
    undefined,
  );
});

test("codexAcpModelCatalog normalizes current metadata for the old bridge", () => {
  const catalog = codexAcpModelCatalog(JSON.stringify({
    models: [
      {
        slug: "gpt-5.6-sol",
        default_reasoning_level: "ultra",
        supported_reasoning_levels: [
          { effort: "low", description: "Low" },
          { effort: "xhigh", description: "Extra high" },
          { effort: "max", description: "Maximum" },
          { effort: "ultra", description: "Ultra" },
        ],
        service_tiers: [
          { id: "priority", name: "Fast", description: "Faster" },
        ],
      },
    ],
  }));

  assert.deepEqual(JSON.parse(catalog), {
    models: [
      {
        slug: "gpt-5.6-sol",
        default_reasoning_level: "xhigh",
        supports_reasoning_summaries: true,
        supported_reasoning_levels: [
          { effort: "low", description: "Low" },
          { effort: "xhigh", description: "Extra high" },
        ],
        service_tiers: [
          { id: "priority", name: "Fast", description: "Faster" },
        ],
      },
    ],
  });
});

test("fastCodexModels returns only visible models with the Fast tier", () => {
  const models = fastCodexModels(JSON.stringify({
    models: [
      {
        slug: "gpt-5.6-terra",
        visibility: "list",
        additional_speed_tiers: ["fast"],
      },
      {
        slug: "gpt-5.4-mini",
        visibility: "list",
        additional_speed_tiers: [],
      },
      {
        slug: "internal-fast",
        visibility: "hide",
        additional_speed_tiers: ["fast"],
      },
    ],
  }));

  assert.deepEqual(models, ["gpt-5.6-terra"]);
});

test("mergeModelCatalogs adds missing models and refreshes labels", () => {
  const models = mergeModelCatalogs(
    [
      { modelId: "gpt-5.6-sol", name: "gpt-5.6-sol" },
      { modelId: "gpt-5.5", name: "GPT-5.5" },
    ],
    [
      { modelId: "gpt-5.6-sol", name: "GPT-5.6-Sol" },
      { modelId: "gpt-5.6-terra", name: "GPT-5.6-Terra" },
      { modelId: "gpt-5.6-luna", name: "GPT-5.6-Luna" },
    ],
  );

  assert.deepEqual(models, [
    { modelId: "gpt-5.6-sol", name: "GPT-5.6-Sol" },
    { modelId: "gpt-5.5", name: "GPT-5.5" },
    { modelId: "gpt-5.6-terra", name: "GPT-5.6-Terra" },
    { modelId: "gpt-5.6-luna", name: "GPT-5.6-Luna" },
  ]);
});
