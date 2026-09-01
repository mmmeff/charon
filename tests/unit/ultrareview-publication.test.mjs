import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForFile(path) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(path) && readFileSync(path, "utf8").trim()) return;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function waitForLines(path, count) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(path)) {
      const lines = readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean);
      if (lines.length >= count) return;
    }
    await sleep(10);
  }
  throw new Error(`Timed out waiting for ${count} lines in ${path}`);
}

function semanticChapter() {
  return {
    chapterKey: "agent-contract",
    purpose: "Define the agent-facing publication contract.",
    before: "Agents serialized complete artifact records.",
    after: "Agents publish semantic chapter content.",
    risk: "medium",
    beats: [{
      title: "Materialize context",
      claim: "Charon constructs supporting evidence.",
      why: "The model should not calculate artifact identity.",
      risk: "low",
      changedEvidenceIds: ["evidence:0123456789abcdef"],
      context: [{
        path: "src/lib/ultraReview.ts",
        startLine: 10,
        endLine: 20,
        reason: "Defines evidence identity.",
      }],
    }],
  };
}

test("the MCP publisher exposes and enforces the v2 contract", async () => {
  const directory = mkdtempSync(join(tmpdir(), "charon-publisher-"));
  const inbox = join(directory, "inbox.jsonl");
  const acknowledgments = join(directory, "acks");
  const child = spawn(
    process.execPath,
    [
      join(root, "scripts/ultrareview-publisher.mjs"),
      "--inbox",
      inbox,
      "--acks",
      acknowledgments,
      "--contract",
      join(root, "scripts/ultrareview-publisher-v2.json"),
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const lines = createInterface({ input: child.stdout });
  const replies = [];
  const readers = [];
  lines.on("line", (line) => {
    const reader = readers.shift();
    if (reader) reader(JSON.parse(line));
    else replies.push(JSON.parse(line));
  });
  const nextReply = () => {
    const reply = replies.shift();
    if (reply) return Promise.resolve(reply);
    return new Promise((resolve) => readers.push(resolve));
  };
  const send = (request) => {
    child.stdin.write(`${JSON.stringify(request)}\n`);
  };

  try {
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    const initialized = await nextReply();
    assert.equal(
      initialized.result.serverInfo.name,
      "charon-ultrareview-publisher",
    );
    assert.equal(initialized.result.serverInfo.version, "2");

    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const listed = await nextReply();
    assert.deepEqual(
      listed.result.tools.map((tool) => tool.name),
      ["publish_plan", "publish_chapter", "finish_review"],
    );
    const chapterTool = listed.result.tools.find(
      (tool) => tool.name === "publish_chapter",
    );
    assert.deepEqual(
      chapterTool.inputSchema.required,
      ["chapterKey", "purpose", "before", "after", "risk", "beats"],
    );
    assert.equal(
      chapterTool.inputSchema.properties.beats.items
        .properties.context.items.additionalProperties,
      false,
    );
    assert.match(
      chapterTool.description,
      /Charon assigns every other id, fingerprint/,
    );

    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "publish_chapter",
        arguments: semanticChapter(),
      },
    });
    await waitForFile(inbox);
    const [event] = readFileSync(inbox, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(event.kind, "chapter");
    assert.equal(event.chapterKey, "agent-contract");
    assert.equal(event.payload.purpose, semanticChapter().purpose);
    assert.equal(event.payload.supportingEvidence, undefined);
    writeFileSync(
      join(acknowledgments, `${event.id}.json`),
      JSON.stringify({
        accepted: true,
        message: "Charon published agent-contract.",
        result: {
          kind: "chapter",
          chapterKey: "agent-contract",
          chapterId: "chapter:agent-contract",
          beatIds: ["beat:1234"],
          supportingEvidenceIds: ["evidence:5678"],
          sourceClaimIds: ["source:abcd"],
          concernIds: [],
          mechanicalChangeIds: [],
        },
      }),
    );

    const published = await nextReply();
    assert.equal(published.result.isError, false);
    assert.equal(published.result.structuredContent.ok, true);
    assert.equal(
      published.result.structuredContent.result.chapterId,
      "chapter:agent-contract",
    );
    assert.deepEqual(
      JSON.parse(published.result.content[0].text),
      published.result.structuredContent,
    );

    send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "publish_chapter",
        arguments: {
          chapter: {
            version: 1,
            supportingEvidence: [],
          },
        },
      },
    });
    const artifactShape = await nextReply();
    assert.equal(artifactShape.result.isError, true);
    assert.equal(
      artifactShape.result.structuredContent.errors[0].code,
      "MISSING_FIELD",
    );
    assert.ok(
      artifactShape.result.structuredContent.errors.some(
        (error) => error.code === "UNSUPPORTED_FIELD",
      ),
    );
    assert.equal(
      readFileSync(inbox, "utf8").trim().split("\n").length,
      1,
    );

    const invalidContext = semanticChapter();
    invalidContext.beats[0].context[0].id = "evidence:made-up";
    send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "publish_chapter",
        arguments: invalidContext,
      },
    });
    const contextIdentity = await nextReply();
    assert.equal(contextIdentity.result.isError, true);
    assert.deepEqual(
      contextIdentity.result.structuredContent.errors[0],
      {
        code: "UNSUPPORTED_FIELD",
        path: "beats[0].context[0].id",
        message:
          "beats[0].context[0].id is not part of the publisher contract.",
        repair: "Remove this field. Charon may own and derive it.",
      },
    );

    send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "publish_plan",
        arguments: { thesis: "x".repeat(64_001) },
      },
    });
    const oversized = await nextReply();
    assert.equal(oversized.result.isError, true);
    assert.equal(
      oversized.result.structuredContent.errors[0].code,
      "PAYLOAD_TOO_LARGE",
    );

    send({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "finish_review",
        arguments: { failedChapters: [] },
      },
    });
    await waitForLines(inbox, 2);
    const events = readFileSync(inbox, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const completed = events[1];
    assert.equal(completed.kind, "complete");
    assert.deepEqual(
      completed.payload,
      { failedChapters: [] },
    );
    writeFileSync(
      join(acknowledgments, `${completed.id}.json`),
      JSON.stringify({
        accepted: true,
        message: "Charon completed the staged review.",
        result: { kind: "complete", status: "complete" },
      }),
    );
    const finished = await nextReply();
    assert.equal(finished.result.isError, false);
  } finally {
    child.stdin.end();
    child.kill();
    lines.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
