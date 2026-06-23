# AGENTS.md — Charon (pr-copilot)

## INTENT (<200 words)

Charon is a macOS desktop app (Tauri 2 + React/TypeScript, MIT licensed) that turns every code change into a review decision surface. AI made generation cheap; review is scarce. Whether hand-written, agent-generated, dependency churn, or bot-fixes — all diffs flow through the same lens: diff, CI status, comments, context, agent log, proposed fix.

Charon babysits PRs (auto-triage + fix CI failures), reviews incoming diffs with optional local checkouts, and launches/monitors agent harnesses (Cursor, Claude Code, Codex, opencode) over ACP. You approve what touches GitHub; agents investigate. The native Rust layer owns all network I/O so worktrees can reach any GitHub Enterprise behind self-signed certs — the webview never calls GitHub directly.

## CODEBASE STRUCTURE (<800 words)

**`src/types.ts`** — All shared types. `GlobalConfig`: minimal (GitHub URL/token, harness list). `RepoConfig`: per-repo state (handler configs, event filters, clone path, skills). Flow and agent run types live here too.

**`src/lib/defaults.ts`** — `EVENT_CATALOG` + default configs/migrations. The catalog is the extension point for new triggers: each entry maps an event shape to handler behavior. Configs are forward-compatible; migrations bridge old persisted state.

**`src/lib/store.ts`** — Zustand stores. `useGlobalConfig`/`useRepoStore`: persisted config, writes flow through native blob storage. `useAgentStore`: run lifecycle and streaming output. `useSkillStore`: reads `.charon/skills/` per repo.

**`src/lib/events.ts`** — Poller loop: fetches PRs/checks/comments from GitHub, detects transitions (new review requested, CI red/green, comment posted), fires events against the catalog + handler configs to trigger flows.

**`src/lib/github.ts`** — REST v3 client for github.com and GHE. All HTTP goes through native commands only; this module builds requests and parses responses.

**`src/lib/flows.ts`** — Three fixed flow types: review, fix, analysis. Each assembles context (diffs, checks, comments), spawns an agent run via the harness layer, then takes post-run actions (post comment, push branch). `FlowContext` threads state across steps; flows are the core work engine.

**`src/lib/agents.ts` + `src/lib/acp.ts`** — Harness spawn/lifecycle and ACP sessions. Agents run as child processes with JSON-RPC over stdout; tool calls and reasoning chunks parse into structured events. Runs persist through app restarts via native blob storage.

**`src/lib/worktree.ts`** — Isolated per-PR Git worktrees: read-only trees for reviews (fall back to diff-only if checkout fails), mutable fix/draft trees that mutate and push. Preserve/prune policy keeps disk use bounded.

**`src-tauri/src/lib.rs`** — Native commands: `spawn_agent` (piped stdin/stdout), `agent_send`, HTTP proxy (reqwest/rustls), blob storage for config/run persistence. The only I/O boundary to the outside world.

**`src/components/RepoApp.tsx` + views** — Per-repo shell with Drafts/Open/Review/Activity/Settings tabs, command palette, keyboard shortcuts, flow context provider. Launcher window lists recent repos and opens them into RepoApp instances.

## WORKING CONVENTIONS

- **Commands**: `npm run tauri dev` (full app), `cargo check --manifest-path=src-tauri/Cargo.toml` (native layer). No secrets in commits; tokens live in persisted config only.
- **Stores**: Config writes always route through native blob storage — never write persisted state directly from the webview. Agent store owns run streaming; skill store reads `.charon/skills/`.
- **Prompt templating**: Flows assemble context into prompts before spawning agents; new triggers extend `EVENT_CATALOG` in defaults, not flow logic. Keep flows fixed to review/fix/analysis — add behavior via handlers and templates, not new flow types.
- **Network rule**: Webview code never makes GitHub requests. All HTTP (including GHE with custom CAs) goes through native commands; the proxy command is the only path out.

## MAINTENANCE NOTE FOR AGENTS

This file has hard size guards: INTENT <200 words, CODEBASE STRUCTURE <800 words. Future agents must keep it current when architecture changes — add new modules, note removed ones, update conventions — while staying within those limits. Trim prose to make room; prefer dense bullets over explanation. If a change is structural (new store, new I/O path, new flow type), this file gets updated in the same commit.
