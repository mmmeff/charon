import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function sourceFiles(path) {
  return readdirSync(join(root, path), { withFileTypes: true })
    .flatMap((entry) => {
      const child = join(path, entry.name);
      return entry.isDirectory()
        ? sourceFiles(child)
        : [child];
    })
    .filter((path) => /\.(?:ts|tsx)$/.test(path));
}

test("UltraReview keeps browser network APIs outside its source", () => {
  const paths = [
    "src/components/UltraReviewWorkspace.tsx",
    ...sourceFiles("src/components/ultrareview"),
    ...sourceFiles("src/lib").filter((path) =>
      /\/(?:ultraReview|ultrareview-)[^/]*\.ts$/.test(path)
    ),
  ];
  const forbidden = [
    [/\bfetch\s*\(/, "fetch"],
    [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
    [/\bWebSocket\b/, "WebSocket"],
    [/\bEventSource\b/, "EventSource"],
    [/\bnavigator\.sendBeacon\b/, "navigator.sendBeacon"],
    [/\baxios\b/, "axios"],
    [/@tauri-apps\/api\/core/, "direct Tauri invoke"],
  ];

  assert.ok(paths.length > 5, "expected the UltraReview source set");
  for (const path of paths) {
    const source = read(path);
    for (const [pattern, name] of forbidden) {
      assert.doesNotMatch(
        source,
        pattern,
        `${path} bypasses the native boundary with ${name}`
      );
    }
  }
});

test("UltraReview acquires the trusted diff through the Rust HTTP command", () => {
  const flow = read("src/lib/ultrareview-flow.ts");
  assert.match(flow, /ctx\.gh\.getPullDiff\(/);
  for (const eagerRead of [
    "listChecks",
    "listComments",
    "listReviews",
    "listTimeline",
    "listPullCommits",
  ]) {
    assert.doesNotMatch(
      flow,
      new RegExp(`ctx\\.gh\\.${eagerRead}\\(`),
      `analysis must retrieve ${eagerRead} just in time`
    );
  }

  const github = read("src/lib/github.ts");
  assert.match(github, /import \{ native \} from "\.\/tauri";/);
  assert.match(github, /native\.httpRequest\(\{/);
  assert.doesNotMatch(github, /\bfetch\s*\(/);

  const tauri = read("src/lib/tauri.ts");
  assert.match(tauri, /invoke\("http_request", \{ req \}\)/);

  const rust = read("src-tauri/src/lib.rs");
  assert.match(rust, /async fn http_request\(req: HttpRequest\)/);
  assert.match(rust, /reqwest::Client::builder\(\)/);
  assert.match(
    rust,
    /\.invoke_handler\(tauri::generate_handler!\[[\s\S]*\bhttp_request,/,
    "the Tauri command registry must expose http_request"
  );
});

test("UltraReview persistence reaches native blob storage", () => {
  const store = read("src/lib/ultrareview-store.ts");
  assert.match(store, /import \{ native \} from "\.\/tauri";/);
  assert.match(store, /storage = native/);

  const storage = read("src/lib/ultrareview-storage.ts");
  assert.match(storage, /storage\.loadBlob\(/);
  assert.match(storage, /storage\.saveBlob\(/);

  const tauri = read("src/lib/tauri.ts");
  assert.match(tauri, /invoke\("load_blob", \{ rel \}\)/);
  assert.match(tauri, /invoke\("save_blob", \{ rel, content \}\)/);

  const rust = read("src-tauri/src/lib.rs");
  assert.match(rust, /fn load_blob\(/);
  assert.match(rust, /fn save_blob\(/);
  assert.match(
    rust,
    /\.invoke_handler\(tauri::generate_handler!\[[\s\S]*\bload_blob,[\s\S]*\bsave_blob,/,
    "the Tauri command registry must expose both blob commands"
  );
});

test("UltraReview packages its agent-side artifact validator", () => {
  const validator = read("scripts/validate-ultrareview.mjs");
  assert.match(validator, /--candidate/);
  assert.match(validator, /--context/);
  assert.match(validator, /references unknown/);

  const tauri = read("src/lib/tauri.ts");
  assert.match(
    tauri,
    /invoke\("prepare_ultrareview_validation", \{/,
  );

  const rust = read("src-tauri/src/lib.rs");
  assert.match(
    rust,
    /include_str!\("\.\.\/\.\.\/scripts\/validate-ultrareview\.mjs"\)/,
  );
  assert.match(rust, /fn prepare_ultrareview_validation\(/);
  assert.match(
    rust,
    /\.invoke_handler\(tauri::generate_handler!\[[\s\S]*\bprepare_ultrareview_validation,/,
    "the Tauri command registry must expose the packaged validator",
  );

  const flow = read("src/lib/ultrareview-flow.ts");
  assert.match(
    flow,
    /native\.prepareUltraReviewValidation\(/,
  );
  assert.match(
    flow,
    /native\.loadBlob\(\s*artifactValidation\.candidateRel,/,
  );
  assert.match(
    flow,
    /parseUltraReviewArtifactCandidate\(/,
  );
});

test("UltraReview packages a run-scoped chapter publisher", () => {
  const publisher = read("scripts/ultrareview-publisher.mjs");
  assert.match(publisher, /publish_plan/);
  assert.match(publisher, /publish_chapter/);
  assert.match(publisher, /waitForAcknowledgment/);

  const acp = read("src/lib/acp.ts");
  assert.match(acp, /mcpServers: AcpMcpServer\[\]/);
  assert.match(
    acp,
    /this\.request\("session\/new", \{ cwd, mcpServers \}\)/,
  );

  const rust = read("src-tauri/src/lib.rs");
  assert.match(
    rust,
    /include_str!\("\.\.\/\.\.\/scripts\/ultrareview-publisher\.mjs"\)/,
  );
  assert.match(
    rust,
    /include_str!\("\.\.\/\.\.\/scripts\/ultrareview-publisher-v2\.json"\)/,
  );
  assert.match(publisher, /--contract/);
  assert.match(rust, /fn prepare_ultrareview_publication\(/);
  assert.match(
    rust,
    /\.invoke_handler\(tauri::generate_handler!\[[\s\S]*\bprepare_ultrareview_publication,/,
  );

  const flow = read("src/lib/ultrareview-flow.ts");
  assert.match(flow, /prepareUltraReviewPublication\(\)/);
  assert.match(flow, /watchUltraReviewPublications\(/);
  assert.match(flow, /mcpServers: publication/);
});
