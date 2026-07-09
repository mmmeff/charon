# AGENTS.md — Charon (pr-copilot)

## VOICE

All human-facing writing operates in the agent's voice — chat, commits, comments, docs, PR bodies.
See `PROSE.md` for the analysis, rules, and examples.

Blunt. Line-broken. Declarative.
Japanese and English, mixed.
One hard-truth line, then one earned soft line.
No hedging. Emoji only in `【】` banners.

The codebase is the culture worth protecting.
Every diff is a tradition weighed before it lands.

Do not overlay this on code itself — identifiers, error messages to machines, JSON keys stay technical. Only human-facing prose is in voice.

## INTENT (<200 words)

AI made generation cheap.
Review is scarce.
Every diff — hand-written, agent-spawned, dependency churn, bot fix — meets the same lens: diff, CI, comments, context, agent log, proposed fix.

Charon is a macOS desktop app. Tauri 2, React, TypeScript, MIT. It babysits PRs: auto-triage, fix CI when it breaks, review incoming diffs with optional local checkouts. It launches and watches agent harnesses — Cursor, Claude Code, Codex, opencode — over ACP.

You approve what touches GitHub.
Agents investigate.

The native Rust layer owns every byte of network I/O. Worktrees reach any GitHub Enterprise behind self-signed certs. The webview never calls GitHub. That boundary is the point.

## CODEBASE STRUCTURE (<800 words)

Where each thing lives. Touch it here, change it here.

**`src/types.ts`** — All shared types. `GlobalConfig`: minimal (GitHub URL/token, harness list). `RepoConfig`: per-repo state (handler configs, event filters, clone path, skills). Flow and agent run types live here too.

**`src/lib/defaults.ts`** — `EVENT_CATALOG` + default configs/migrations. The catalog is the extension point for new triggers: each entry maps an event shape to handler behavior. Configs are forward-compatible; migrations bridge old persisted state.

**`src/lib/store.ts`** — Zustand stores. `useGlobalConfig`/`useRepoStore`: persisted config, writes flow through native blob storage (`loadBlob`/`saveBlob`). `useAgentStore`: run lifecycle and streaming output. Skill store is just a container; skills load via native scan of cursor skill dirs plus shipped fallbacks appended when no local skill claims the same name.

**`src/lib/events.ts`** — Poller loop: fetches PRs/checks/comments from GitHub, detects transitions (new review requested, CI red/green, comment posted), fires events against the catalog + handler configs to trigger flows.

**`src/lib/github.ts`** — REST v3 client for github.com and GHE. All HTTP goes through native commands only; this module builds requests and parses responses.

**`src/lib/flows.ts`** — Three fixed flow types: review, fix, analysis. Each assembles context (diffs, checks, comments), spawns an agent run via the harness layer, then takes post-run actions (post comment, push branch). `FlowContext` threads state across steps; flows are the core work engine.
Fix-flow pushes are app-owned: agents commit but never push; `validateAndPush` runs the per-repo `validationCommand` in the worktree and pushes only on success (rejected commits land on a `pr-copilot/rejected/<runId>` rescue branch). Prompt-level "do not push" is not enforcement — an agent-side push is detected post-hoc and fails the run.

**`src/lib/agents.ts` + `src/lib/acp.ts`** — Harness spawn/lifecycle and ACP sessions. Agents run as child processes with JSON-RPC over stdout; tool calls and reasoning chunks parse into structured events. Runs persist through app restarts via native blob storage.

**`src/lib/worktree.ts`** — Isolated per-PR Git worktrees: read-only trees for reviews (fall back to diff-only if checkout fails), mutable fix/draft trees that mutate and push. Preserve/prune policy keeps disk use bounded.

**`src-tauri/src/lib.rs`** — Native commands: `spawn_agent` (piped stdin/stdout), `agent_send`, `opencode_session_errors` (tails opencode's own log for session-matched provider errors the harness swallows), HTTP proxy (reqwest/rustls), blob storage for config/run persistence. The only I/O boundary to the outside world.

**`src/lib/template.ts`** — Prompt interpolation: `{kebab-case}` variables, unknown vars left intact so prompts degrade visibly. `prVars()` derives standard variables from a PR shape.

**`src/components/RepoApp.tsx` + views** — Per-repo shell with Drafts/Open/Review/Activity/Settings tabs, command palette, keyboard shortcuts, flow context provider. Launcher window lists recent repos and opens them into RepoApp instances.

## WORKING CONVENTIONS

- **Commands**: `npm run tauri dev` (full app), `cargo check --manifest-path=src-tauri/Cargo.toml` (native layer). No formatter — verification is `npm run typecheck` plus `npm run lint` (ESLint flat config in `eslint.config.js`). The single enforced rule is `react-hooks/rules-of-hooks` (`error`): it fails any build that calls a hook after an early return — the bug that crashed `RunResults` when `swarmActive` flipped. `exhaustive-deps` is off; re-enable as `warn` for a sweep when warranted. Build chain: `npm run build` runs `tsc && vite build`; `prebuild` generates icons from `app-icon.png`, so icon files in `src-tauri/icons/` are not committed.
- **Stores**: Config writes always route through native blob storage — never write persisted state directly from the webview. Agent store owns run streaming; skill store is just a container for skills loaded via native scan plus shipped fallbacks.
- **Prompt templating**: Flows assemble context into prompts before spawning agents; new triggers extend `EVENT_CATALOG` in defaults, not flow logic. Keep flows fixed to review/fix/analysis — add behavior via handlers and templates, not new flow types. Template syntax is `{kebab-case}` (see template.ts).
- **Network rule**: Webview code never makes GitHub requests. All HTTP (including GHE with custom CAs) goes through native commands; the proxy command is the only path out. Git operations also go through native `runGit`.
- **Regression guard in agents.ts:316ff** — pr-copilot calls ACP `session/set_model` (the native method) on any harness that exposes a model list, including opencode (verified on 1.17.9; the 1.15.13 SQLite corruption bug is fixed). It deliberately still avoids `session/set_config_option` for model — that was the actual corrupting call on 1.15.x. opencode also swallows provider errors (rate limit, billing) silently over ACP — the `promptWithStallDiagnostic` helper + `opencode_session_errors` native command tail opencode's own log and fail the run with the real message instead of hanging. Do not refactor agents.ts model selection or the stall diagnostic without understanding this guard.

## MAINTENANCE NOTE FOR AGENTS

This file has hard size guards.
INTENT stays under 200 words.
CODEBASE STRUCTURE stays under 800.
When the architecture changes, this file changes in the same commit — new modules added, removed ones noted, conventions updated.

Trim prose to make room.
Dense bullets beat explanation.

A structural change left undocumented is a tradition broken.
