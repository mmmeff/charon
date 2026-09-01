import assert from "node:assert/strict";
import test from "node:test";

import {
  codexAcpModelCatalog,
  codexBridgeArgs,
  commonCodexReasoningLevels,
  fastCodexModels,
  listedCodexModels,
  mergeModelCatalogs,
  modelIdEncodesReasoning,
  modelIdsEncodeReasoning,
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

test("codexBridgeArgs adds supported legacy overrides", () => {
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
    [
      "-c",
      "service_tier=\"priority\"",
    ],
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

test("modelIdEncodesReasoning recognizes Codex model variants", () => {
  assert.equal(
    modelIdEncodesReasoning("gpt-5.6-sol[ultra]"),
    true,
  );
  assert.equal(
    modelIdEncodesReasoning("gpt-5.6-sol"),
    false,
  );
  assert.equal(
    modelIdEncodesReasoning("anthropic/claude-opus-4-8"),
    false,
  );
});

test("modelIdsEncodeReasoning requires effort on every selectable model", () => {
  assert.equal(
    modelIdsEncodeReasoning([
      "gpt-5.6-sol[high]",
      "gpt-5.6-terra[max]",
    ]),
    true,
  );
  assert.equal(
    modelIdsEncodeReasoning([
      "gpt-5.6-sol[high]",
      "gpt-5.6-terra",
    ]),
    false,
  );
  assert.equal(modelIdsEncodeReasoning(["auto"]), false);
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
