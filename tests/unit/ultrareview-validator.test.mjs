import assert from "node:assert/strict";
import {
 mkdtempSync,
 writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const validator = join(
 root,
 "scripts",
 "validate-ultrareview.mjs",
);

function validAnalysis() {
 const evidenceId = "evidence:7fc8b372869214a5";
 return {
  version: 1,
  thesis: "Persist review progress.",
  sourceClaimIds: ["source:identity"],
  systems: [{
   id: "system:persistence",
   title: "Persist the review",
   thesis: "Keep one story for one pull request version.",
   order: 0,
   risk: "medium",
   sourceClaimIds: ["source:identity"],
   scope: {
    changedLines: 1,
    files: 1,
   },
   chapters: [{
    id: "chapter:artifact",
    title: "Define the artifact",
    purpose: "Give review state one durable owner.",
    before: "Review progress disappears.",
    after: "Review progress resumes.",
    order: 0,
    risk: "medium",
    sourceClaimIds: ["source:identity"],
    dependencyChapterIds: [],
    beats: [{
     id: "beat:identity",
     title: "Bind state to the diff",
     claim: "The artifact records the change.",
     objective: "Inspect the version identity.",
     question: null,
     order: 0,
     risk: "medium",
     evidenceIds: [evidenceId],
     sourceClaimIds: ["source:identity"],
    }],
   }],
  }],
  evidence: [{
   id: evidenceId,
   kind: "changed",
   change: "addition",
   location: {
    path: "src/lib/store.ts",
    side: "RIGHT",
    startLine: 210,
    endLine: 210,
   },
   fingerprint: "sha256:add-line",
   sourceClaimIds: ["source:identity"],
  }],
  coverage: [{
   evidenceId,
   assignment: {
    kind: "beat",
    beatId: "beat:identity",
   },
  }],
  mechanicalChanges: [],
  sourceClaims: [{
   id: "source:identity",
   kind: "code_observed",
   claim: "Review progress persists.",
   evidenceIds: [evidenceId],
  }],
  concerns: [],
  generation: {
   status: "complete",
   stages: [{
    id: "stage:coverage",
    label: "Checking coverage",
    status: "complete",
    systemId: null,
    error: null,
   }],
   failures: [],
  },
 };
}

function runValidator(
 candidate,
 trustedEvidence = validAnalysis().evidence,
) {
 const directory = mkdtempSync(
  join(tmpdir(), "charon-ultrareview-validator-"),
 );
 const candidatePath = join(directory, "candidate.json");
 const contextPath = join(directory, "context.json");
 writeFileSync(
  candidatePath,
  JSON.stringify(candidate),
 );
 writeFileSync(
  contextPath,
  JSON.stringify({
   version: 1,
   evidenceInventory: trustedEvidence,
  }),
 );
 return spawnSync(
  process.execPath,
  [
   validator,
   "--candidate",
   candidatePath,
   "--context",
   contextPath,
  ],
  { encoding: "utf8" },
 );
}

test("packaged validator accepts a valid UltraReview analysis", () => {
 const result = runValidator(validAnalysis());

 assert.equal(result.status, 0, result.stderr);
 assert.match(result.stdout, /UltraReview artifact is valid/);
});

test("packaged validator reports a dangling evidence reference", () => {
 const candidate = validAnalysis();
 candidate.systems[0].chapters[0].beats[0].evidenceIds.push(
  "evidence:missing",
 );

 const result = runValidator(candidate);

 assert.equal(result.status, 1);
 assert.match(
  result.stderr,
  /analysis\.systems\[0\]\.chapters\[0\]\.beats\[0\]\.evidenceIds\[1\] references unknown evidence:missing/,
 );
});

test("packaged validator rejects changed evidence that differs from Charon's manifest", () => {
 const candidate = validAnalysis();
 candidate.evidence[0].location.path = "src/invented.ts";

 const result = runValidator(candidate);

 assert.equal(result.status, 1);
 assert.match(
  result.stderr,
  /analysis\.evidence\[0\] must match trusted evidence/,
 );
});
