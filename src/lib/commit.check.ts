// Runnable check for the commit-mention splitter (no framework, no deps; Node
// strips the types): `node src/lib/commit.check.ts`.
import { splitCommitMention } from "./commit.ts";

function eq(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`commit.check failed — ${label}\n  expected ${e}\n  got      ${a}`);
}

// pushed event: the short hash becomes its own (clickable) segment
eq(splitCommitMention("pushed abc1234", "abc1234def5567"), { before: "pushed ", short: "abc1234", after: "" }, "pushed");

// merged event: text on both sides of the hash is preserved
eq(
  splitCommitMention("merged this PR as 0011223 cleanly", "0011223aa"),
  { before: "merged this PR as ", short: "0011223", after: " cleanly" },
  "merged"
);

// no sha (e.g. "closed this PR") → nothing to link
eq(splitCommitMention("closed this PR", undefined), null, "no sha");

// defensive: a sha that isn't actually in the sentence → nothing to link
eq(splitCommitMention("reopened this PR", "deadbeef0"), null, "absent sha");

console.log("commit.check: all assertions passed");
