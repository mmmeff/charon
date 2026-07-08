/**
 * Local-only integration test: proves pr-copilot's ACP integration works
 * against every supported harness (cursor, opencode, omp, claude-code, codex) —
 * model listing, model/mode selection, and a baseline prompt all succeed.
 *
 * Why this exists: a previous regression silently called set_config_option
 * to switch opencode's model, corrupting every agent run with a misleading
 * "Internal error: OpenCode service failure" surfaced as a session/prompt
 * failure (see src/lib/agents.ts:305 comment + opencode 1.15.13's
 * session.next.model.switched handler calling appendMessage with seq=NULL
 * over an empty session_message table, failing SQLite's NOT NULL constraint
 * synchronously inside the next session/prompt's createUserMessage). This
 * test reproduces the harness-wire contract end-to-end against real harness
 * subprocesses, so a future change that breaks model selection, mode
 * selection, prompt dispatch, or error surfacing fails here before it ships.
 *
 * Local-only. NOT in any npm chain (no pretest/test/build hook). Spawns real
 * subprocesses (cursor-agent / opencode / npx), talks to live model providers,
 * and may take minutes per harness. Run by hand:
 *
 *     npm run test:integration
 *
 * Filter to one harness:
 *
 *     node --test --test-name-pattern='opencode' tests/integration/
 *
 * Skip individual harnesses by env:
 *
 *     ACP_SKIP_HARNESSES=cursor,codex npm run test:integration
 *
 * The ACP client below mirrors src/lib/acp.ts AcpConnection + AcpRpcError
 * standalone — production can't be imported because it depends on the Tauri
 * runtime (./tauri). Keep these in sync; if this client and the production
 * one drift, the test no longer proves what it claims.
 */
import { test, describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SKIP = new Set(
  (process.env.ACP_SKIP_HARNESSES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

// --- AcpRpcError — mirrors src/lib/acp.ts AcpRpcError ----------------------
class AcpRpcError extends Error {
  constructor(message, opts = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "AcpRpcError";
    this.rpcCode = opts.rpcCode;
    this.rpcData = opts.rpcData;
    this.stderr = opts.stderr?.trim() || undefined;
    this.exitCode = opts.exitCode;
    this.agentId = opts.agentId;
    this.method = opts.method;
  }
}

function isMethodNotFound(e) {
  return e instanceof AcpRpcError && (
    e.rpcCode === -32601 ||
    /unknown (acp )?(ext )?method|method not found/i.test(
      String(e.message) + JSON.stringify(e.rpcData ?? "")
    )
  );
}

// --- Minimal ACP client — mirrors src/lib/acp.ts AcpConnection -----------
class AcpClient {
  constructor(label, command, args, cwd, env) {
    this.label = label;
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
    this.nextId = 1;
    this.pending = new Map();
    this.buf = "";
    this.stderr = "";
    this.dead = false;
    this.proc = null;
    this.messageChunks = [];
    this.thoughtChunks = [];
  }

  async start() {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.command, this.args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: this.cwd,
        env: { ...process.env, ...(this.env ?? {}) },
      });
      this.proc = proc;
      proc.once("spawn", () => resolve());
      proc.once("error", (err) => reject(new AcpRpcError(`spawn failed: ${err.message}`, { stderr: this.stderr })));
      proc.stdout.setEncoding("utf8");
      proc.stderr.setEncoding("utf8");
      proc.stdout.on("data", (d) => this._onStdout(d));
      proc.stderr.on("data", (d) => { this.stderr = (this.stderr + d).slice(-4000); });
      proc.once("exit", (code) => {
        if (!this.dead) {
          this._fail(new AcpRpcError(
            this.stderr.trim() || `agent exited (code ${code ?? "?"})`,
            { exitCode: code ?? undefined, stderr: this.stderr }
          ));
        }
      });
    });
  }

  _onStdout(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      if (line.trim()) this._handleLine(line);
    }
  }

  _handleLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        p.reject(new AcpRpcError(msg.error.message || "ACP error", {
          rpcCode: msg.error.code,
          rpcData: msg.error.data,
          stderr: this.stderr,
          method: p.method,
        }));
      } else {
        p.resolve(msg.result);
      }
      return;
    }
    if (msg.method === "session/update" && msg.params?.update) {
      const u = msg.params.update;
      if (u.sessionUpdate === "agent_message_chunk" && u.content?.text) {
        this.messageChunks.push(u.content.text);
      } else if (u.sessionUpdate === "agent_thought_chunk" && u.content?.text) {
        this.thoughtChunks.push(u.content.text);
      }
    }
  }

  _fail(err) {
    if (this.dead) return;
    this.dead = true;
    for (const { reject, method } of this.pending.values()) {
      if (err instanceof AcpRpcError && !err.method) err.method = method;
      reject(err);
    }
    this.pending.clear();
  }

  _request(method, params) {
    if (this.dead) return Promise.reject(new AcpRpcError("agent connection closed", { method }));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  _notify(method, params) {
    if (this.dead || !this.proc.stdin.writable) return;
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  initialize() {
    return this._request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "pr-copilot-test", title: "pr-copilot integration test", version: "1" },
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
  }
  newSession(cwd) { return this._request("session/new", { cwd, mcpServers: [] }); }
  setMode(sessionId, modeId) { return this._request("session/set_mode", { sessionId, modeId }); }
  setModel(sessionId, modelId) { return this._request("session/set_model", { sessionId, modelId }); }
  setConfigOption(sessionId, configId, value) {
    return this._request("session/set_config_option", { sessionId, configId, value });
  }
  cancel(sessionId) { this._notify("session/cancel", { sessionId }); }

  async prompt(sessionId, blocks) {
    this.messageChunks = [];
    this.thoughtChunks = [];
    const res = await this._request("session/prompt", { sessionId, prompt: blocks });
    return {
      stopReason: res?.stopReason ?? "end_turn",
      messageText: this.messageChunks.join(""),
      thoughtText: this.thoughtChunks.join(""),
      rawResult: res,
    };
  }

  kill() {
    if (this.dead && !this.proc) return Promise.resolve();
    this._fail(new AcpRpcError("killed by test", { method: undefined }));
    try { this.proc.stdin.end(); } catch {}
    try { this.proc.stdin.destroy(); } catch {}
    try { this.proc.stdout.destroy(); } catch {}
    try { this.proc.stderr.destroy(); } catch {}
    try { this.proc.kill("SIGTERM"); } catch {}
    // Resolve when the proc actually exits (so `after` hooks can await
    // cleanup and the test runner doesn't see pending promises); or after
    // a 3s hard fallback. unref'd so it doesn't keep the runner's event
    // loop alive on its own.
    return new Promise((resolve) => {
      let done = false;
      const settle = () => { if (!done) { done = true; resolve(); } };
      this.proc.once("exit", () => settle());
      const t1 = setTimeout(() => { try { this.proc.kill("SIGKILL"); } catch {} }, 1000);
      const t2 = setTimeout(settle, 3000);
      t1.unref(); t2.unref();
    });
  }
}

// --- harness fixtures — mirrors src/lib/defaults.ts harnessTemplates() ----
const HARNESS = [
  { id: "cursor", command: "cursor-agent", args: ["acp"] },
  { id: "opencode", command: "opencode", args: ["acp"] },
  { id: "omp", command: "omp", args: ["acp"] },
  // claude-code-acp proxies to Anthropic and needs ANTHROPIC_API_KEY in env.
  // Without it, initialize succeeds but session/prompt fails with
  // "Authentication required" (rpc -32000) — skip with an actionable message
  // rather than failing the suite on a setup issue.
  { id: "claude-code", command: "npx", args: ["-y", "@zed-industries/claude-code-acp"],
    requiresEnv: ["ANTHROPIC_API_KEY"] },
  { id: "codex", command: "npx", args: ["-y", "@zed-industries/codex-acp"] },
];

// Probe: spawn the harness, send initialize, resolve true if ACP response
// arrives within probeMs. False on ENOENT/exit/timeout. npx harnesses that
// aren't cached will hang on auto-install and time out — correct skip signal.
// Also checks `requiresEnv` — if any listed env var is missing, skip with a
// clear "set X to test this harness" message rather than running a prompt
// that fails with "Authentication required".
async function isAvailable(h, probeMs = 30_000) {
  if (h.requiresEnv?.length) {
    const missing = h.requiresEnv.filter((v) => !process.env[v]);
    if (missing.length) return { ok: false, why: `missing env: ${missing.join(", ")} (set to test this harness)` };
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok, why) => {
      if (settled) return;
      settled = true;
      try { proc.kill("SIGKILL"); } catch {}
      resolve({ ok, why });
      if (ok) return;
      if (why) process.stderr.write(`  [probe ${h.id}] ${why}\n`);
    };
    let buf = "";
    let stderr = "";
    let proc;
    try {
      proc = spawn(h.command, h.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, npm_config_yes: "true" },
      });
    } catch (e) {
      finish(false, `spawn threw: ${e.message}`);
      return;
    }
    const timer = setTimeout(() => finish(false, `no init response within ${probeMs}ms`), probeMs);
    proc.once("error", (e) => { clearTimeout(timer); finish(false, `spawn error: ${e.message}`); });
    proc.once("exit", (code) => { clearTimeout(timer); finish(false, `exited code=${code}; stderr: ${stderr.trim().slice(-200)}`); });
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (d) => { stderr = (stderr + d).slice(-1000); });
    proc.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
          clearTimeout(timer);
          finish(!!msg.result, `initialize returned error: ${msg.error?.message ?? "(no message)"}`);
          return;
        }
      }
    });
    proc.stdin.write(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: {
        protocolVersion: 1,
        clientInfo: { name: "probe", title: "probe", version: "1" },
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      },
    }) + "\n");
  });
}

// --- model/mode selection — mirrors src/lib/agents.ts:301ff (post-fix) ---
function chooseModelStrategy(ns, harnessId) {
  if (ns.models?.availableModels?.length) {
    const modelId = ns.models.currentModelId ?? ns.models.availableModels[0].modelId;
    return {
      kind: "native-set_model",
      modelId,
      apply: (c, sid) => c.setModel(sid, modelId),
    };
  }
  const opt = ns.configOptions?.find(
    (o) => (o.id === "model" || o.category === "model") && o.type === "select" && o.options?.length
  );
  if (opt) {
    const optionId = opt.id;
    if (harnessId === "opencode") {
      return {
        kind: "config-option-set_model-only",
        optionId,
        currentValue: opt.currentValue,
        apply: (c, sid, modelId) => c.setModel(sid, modelId),
      };
    }
    return {
      kind: "config-option-with-fallback",
      optionId,
      currentValue: opt.currentValue,
      apply: async (c, sid, modelId) => {
        try {
          await c.setModel(sid, modelId);
        } catch (e) {
          if (isMethodNotFound(e)) {
            await c.setConfigOption(sid, optionId, modelId);
            return;
          }
          throw e;
        }
      },
    };
  }
  return { kind: "self-managed" };
}

function chooseModeStrategy(ns) {
  const modes = ns.modes?.availableModes ?? [];
  if (modes.length === 0) return { kind: "no-modes" };
  const preferred = ["ask", "plan"];
  const selected = preferred.find((id) => modes.some((m) => m.id === id));
  if (selected && selected !== ns.modes?.currentModeId) {
    return { kind: "set-mode", modeId: selected, apply: (c, sid) => c.setMode(sid, selected) };
  }
  return { kind: "leave-current", currentModeId: ns.modes?.currentModeId };
}

const SUITE_OPTS = { concurrency: 1, timeout: 120_000 };

const BASELINE_PROMPT = [
  { type: "text", text: "Reply with exactly the single word: pong. No punctuation, no explanation, nothing else." },
];

const PROBED = await Promise.all(HARNESS.map(async (h) => {
  if (SKIP.has(h.id)) return { h, ok: false, why: "skipped via ACP_SKIP_HARNESSES" };
  const r = await isAvailable(h);
  return { h, ok: r.ok, why: r.why };
}));

describe("ACP harnesses — integration", SUITE_OPTS, () => {
  for (const { h, ok, why } of PROBED) {
    describe(h.id, { ...SUITE_OPTS, skip: ok ? false : why ?? "harness not available" }, () => {
      let client;
      let cwd;
      let ns;

      before(async () => {
        cwd = mkdtempSync(join(tmpdir(), `acp-it-${h.id}-`));
        client = new AcpClient(`it-${h.id}`, h.command, h.args, cwd);
        await client.start();
        await client.initialize();
        ns = await client.newSession(cwd);
      });

      after(async () => {
        try { await client?.kill(); } catch {}
        try { rmSync(cwd, { recursive: true, force: true }); } catch {}
      });

      it("session/new exposes a model strategy (native list, model config option, or self-managed)", () => {
        const s = chooseModelStrategy(ns, h.id);
        assert.ok(
          s.kind === "native-set_model" ||
            s.kind === "config-option-with-fallback" ||
            s.kind === "config-option-set_model-only" ||
            s.kind === "self-managed"
        );
        if (s.kind === "native-set_model") {
          assert.ok(ns.models.availableModels.length > 0);
          assert.ok(s.modelId);
        }
        if (s.kind === "config-option-with-fallback" || s.kind === "config-option-set_model-only") {
          assert.ok(s.optionId != null);
          assert.ok(s.currentValue, "config-option picker but no currentValue");
        }
      });

      it("mode selection is applied or skipped per the harness's exposed modes", async () => {
        const ms = chooseModeStrategy(ns);
        if (ms.kind === "set-mode") {
          await ms.apply(client, ns.sessionId);
        } else {
          assert.ok(ms.kind === "no-modes" || ms.kind === "leave-current");
        }
      });

      it("baseline prompt reaches end_turn and the model replies with pong", async () => {
        const s = chooseModelStrategy(ns, h.id);
        // pr-copilot's actual selection path: native -> set_model; config-option -> set_model, with
        // config-option fallback only for non-opencode harnesses whose set_model method is missing.
        if (s.kind === "native-set_model") await s.apply(client, ns.sessionId);
        if (s.kind === "config-option-with-fallback" || s.kind === "config-option-set_model-only") {
          await s.apply(client, ns.sessionId, s.currentValue);
        }
        const result = await client.prompt(ns.sessionId, BASELINE_PROMPT);
        assert.equal(result.stopReason, "end_turn");
        assert.ok(result.messageText.toLowerCase().includes("pong"), `baseline prompt did not produce pong: ${JSON.stringify(result.messageText)}`);
      });

      it("a second prompt on the same session still works (proves session is reusable)", async () => {
        const result = await client.prompt(ns.sessionId, [
          { type: "text", text: "Reply with exactly the single word: ack. Nothing else." },
        ]);
        assert.equal(result.stopReason, "end_turn");
        assert.ok(result.messageText.toLowerCase().includes("ack"), `second prompt did not produce ack: ${JSON.stringify(result.messageText)}`);
      });
    });
  }
});

describe("opencode regression guard — set_config_option('model', …) avoidance is necessary", SUITE_OPTS, () => {
  const opencodeOk = PROBED.find((p) => p.h.id === "opencode")?.ok ?? false;

  describe("when opencode is available", { ...SUITE_OPTS, skip: opencodeOk ? false : "opencode not available" }, () => {
    it("the FIX path (no set_config_option for model) -> prompt succeeds", async () => {
      const cwd = mkdtempSync(join(tmpdir(), "acp-it-opencode-fix-"));
      const client = new AcpClient("it-opencode-fix", "opencode", ["acp"], cwd);
      try {
        await client.start();
        await client.initialize();
        const ns = await client.newSession(cwd);
        const opt = ns.configOptions?.find((o) => o.id === "model" && o.type === "select" && o.options?.length);
        assert.ok(opt, "opencode no longer exposes a model config option — re-evaluate this guard");
        // Deliberately DO NOT call set_config_option for model — this is the fix.
        const result = await client.prompt(ns.sessionId, BASELINE_PROMPT);
        assert.equal(result.stopReason, "end_turn");
        assert.ok(result.messageText.toLowerCase().includes("pong"), `fix path failed: ${JSON.stringify(result.messageText)}`);
      } finally {
        try { await client.kill(); } catch {}
        try { rmSync(cwd, { recursive: true, force: true }); } catch {}
      }
    });

    it("the BUG path (set_config_option to a differing model) -> next prompt fails with -32603/{service:'session'} on opencode 1.15.x; or succeeds on a patched opencode (either outcome passes)", async (t) => {
      const cwd = mkdtempSync(join(tmpdir(), "acp-it-opencode-bug-"));
      const client = new AcpClient("it-opencode-bug", "opencode", ["acp"], cwd);
      try {
        await client.start();
        await client.initialize();
        const ns = await client.newSession(cwd);
        const opt = ns.configOptions?.find((o) => o.id === "model" && o.type === "select" && o.options?.length);
        assert.ok(opt, "opencode no longer exposes a model config option");
        const differing = opt.options.find((o) => o.value !== opt.currentValue);
        assert.ok(differing, "no model option differs from current default");
        await client.setConfigOption(ns.sessionId, "model", differing.value);
        let err;
        try {
          await client.prompt(ns.sessionId, BASELINE_PROMPT);
        } catch (e) { err = e; }
        if (err) {
          assert.ok(err instanceof AcpRpcError, `unexpected error type: ${err?.constructor?.name}`);
          assert.equal(err.rpcCode, -32603, `expected -32603; got ${err.rpcCode}`);
          assert.deepEqual(err.rpcData, { service: "session" });
          assert.equal(err.method, "session/prompt");
          t.diagnostic("opencode bug present — pr-copilot's avoidance is necessary");
        } else {
          t.diagnostic("opencode was patched — pr-copilot's avoidance is now defensive-only");
        }
      } finally {
        try { await client.kill(); } catch {}
        try { rmSync(cwd, { recursive: true, force: true }); } catch {}
      }
    });
  });
});

describe("omp ACP guard — config-option model fallback is necessary", SUITE_OPTS, () => {
  const ompOk = PROBED.find((p) => p.h.id === "omp")?.ok ?? false;

  describe("when omp is available", { ...SUITE_OPTS, skip: ompOk ? false : "omp not available" }, () => {
    it("session/set_model is rejected as method-not-found (documents why the config-option fallback exists)", async () => {
      const cwd = mkdtempSync(join(tmpdir(), "acp-it-omp-set-model-"));
      const client = new AcpClient("it-omp-set-model", "omp", ["acp"], cwd);
      try {
        await client.start();
        await client.initialize();
        const ns = await client.newSession(cwd);
        const opt = ns.configOptions?.find(
          (o) => (o.id === "model" || o.category === "model") && o.type === "select" && o.options?.length
        );
        assert.ok(opt, "omp no longer exposes a model config option — re-evaluate this guard");
        assert.ok(opt.currentValue, "omp model config option has no currentValue");

        await assert.rejects(
          () => client.setModel(ns.sessionId, opt.currentValue),
          (e) => {
            assert.ok(e instanceof AcpRpcError, `expected AcpRpcError, got ${e?.constructor?.name}`);
            assert.ok(isMethodNotFound(e), `expected method-not-found rejection, got ${e.message} ${JSON.stringify(e.rpcData)}`);
            return true;
          }
        );
      } finally {
        try { await client.kill(); } catch {}
        try { rmSync(cwd, { recursive: true, force: true }); } catch {}
      }
    });

    it('session/set_config_option("model") succeeds and thinking axis is exposed', async () => {
      const cwd = mkdtempSync(join(tmpdir(), "acp-it-omp-config-option-"));
      const client = new AcpClient("it-omp-config-option", "omp", ["acp"], cwd);
      try {
        await client.start();
        await client.initialize();
        const ns = await client.newSession(cwd);
        const modelOpt = ns.configOptions?.find(
          (o) => (o.id === "model" || o.category === "model") && o.type === "select" && o.options?.length
        );
        assert.ok(modelOpt, "omp no longer exposes a model config option");
        assert.ok(modelOpt.currentValue, "omp model config option has no currentValue");

        const thinking = ns.configOptions?.find(
          (o) => o.id === "thinking" && o.category === "thought_level" && o.type === "select" && o.options?.length
        );
        assert.ok(thinking, "omp no longer exposes the thinking thought_level select");
        const thinkingValues = thinking.options.map((o) => typeof o === "string" ? o : o.value);
        assert.ok(thinkingValues.includes("auto"), `thinking options missing auto: ${JSON.stringify(thinkingValues)}`);
        assert.ok(thinkingValues.includes("xhigh"), `thinking options missing xhigh: ${JSON.stringify(thinkingValues)}`);

        await assert.doesNotReject(() => client.setConfigOption(ns.sessionId, "model", modelOpt.currentValue));
      } finally {
        try { await client.kill(); } catch {}
        try { rmSync(cwd, { recursive: true, force: true }); } catch {}
      }
    });
  });
});

describe("AcpRpcError surfacing — code/data/method preserved on a real harness rejection", SUITE_OPTS, () => {
  const first = PROBED.find((p) => p.ok)?.h;

  it("rejects with structured AcpRpcError on a JSON-RPC error response (bogus method)", { skip: first ? false : "no harness available" }, async () => {
    const cwd = mkdtempSync(join(tmpdir(), `acp-it-err-${first.id}-`));
    const client = new AcpClient(`it-err-${first.id}`, first.command, first.args, cwd);
    try {
      await client.start();
      await client.initialize();
      let err;
      try { await client._request("session/nonexistent_method", {}); } catch (e) { err = e; }
      assert.ok(err instanceof AcpRpcError, `expected AcpRpcError, got ${err?.constructor?.name}`);
      assert.equal(err.method, "session/nonexistent_method");
      assert.ok(err.rpcCode !== undefined, `rpcCode not preserved: ${err.rpcCode}`);
      assert.ok(err.rpcCode === -32601 || err.rpcCode === -32603 || err.rpcCode < 0, `unexpected rpcCode: ${err.rpcCode}`);
      assert.ok(err.message.length > 0, "empty error message");
    } finally {
      try { await client.kill(); } catch {}
      try { rmSync(cwd, { recursive: true, force: true }); } catch {}
    }
  });
});
