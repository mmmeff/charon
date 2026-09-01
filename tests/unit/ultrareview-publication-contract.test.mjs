import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after } from "node:test";

import { createServer } from "vite";

const contract = JSON.parse(
  readFileSync(
    new URL(
      "../../scripts/ultrareview-publisher-v2.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "silent",
});
const {
  parseUltraReviewPublicationInput,
  ultraReviewPublicationContractVersion,
} = await server.ssrLoadModule(
  "/src/lib/ultrareview-publication-contract.ts",
);

after(async () => {
  await server.close();
});

function assertClosedObjects(schema, path) {
  if (schema.type === "object") {
    assert.equal(
      schema.additionalProperties,
      false,
      `${path} must reject unknown fields`,
    );
    assert.ok(schema.properties, `${path} must declare properties`);
    for (const [name, property] of Object.entries(schema.properties)) {
      assertClosedObjects(property, `${path}.${name}`);
    }
  }
  if (schema.type === "array" && schema.items) {
    assertClosedObjects(schema.items, `${path}[]`);
  }
}

test("the packaged publisher contract is exact and executable", () => {
  assert.equal(ultraReviewPublicationContractVersion(), 2);
  assert.deepEqual(
    Object.keys(contract.tools),
    ["publish_plan", "publish_chapter", "finish_review"],
  );
  for (const [name, tool] of Object.entries(contract.tools)) {
    assertClosedObjects(tool.inputSchema, name);
    for (const example of tool.inputSchema.examples) {
      assert.deepEqual(
        parseUltraReviewPublicationInput(name, example),
        example,
      );
    }
  }
});

test("the contract rejects Charon-owned artifact fields", () => {
  assert.throws(
    () => parseUltraReviewPublicationInput(
      "publish_chapter",
      {
        ...contract.tools.publish_chapter.inputSchema.examples[0],
        version: 1,
        sourceClaimIds: [],
        supportingEvidence: [],
      },
    ),
    (error) => {
      assert.deepEqual(
        error.issues.map((issue) => issue.path),
        ["version", "sourceClaimIds", "supportingEvidence"],
      );
      assert.ok(
        error.issues.every(
          (issue) => issue.code === "UNSUPPORTED_FIELD",
        ),
      );
      return true;
    },
  );
});
