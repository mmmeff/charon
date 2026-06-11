# PR Copilot

A cross-platform desktop app (Tauri 2 + React/TypeScript) that connects to GitHub and helps you review
and manage pull requests with Cursor agents — under strict human-in-the-loop control. **The app never
posts comments, replies, or reviews on its own.** Every GitHub-facing action is a proposal you edit and
explicitly approve. The single automated exception: pushing commits to *your own* PR branches during fix
flows and draft edits.

## Running

Prerequisites: Node 18+, Rust (stable), and the [Cursor CLI](https://cursor.com/cli) (`cursor-agent`)
logged in (`cursor-agent login`).

```sh
npm install
npm run tauri dev      # development
npm run tauri build    # packaged app (run `npx tauri icon <png>` first for full icon sets)
```

On first boot the launcher asks for your GitHub instance (github.com or a GitHub Enterprise URL) and a
personal access token (repo contents + pull request read/write). Add repositories by `owner/name`; each
repo opens in **its own window** with its own locally-stored configuration under the app data dir
(`~/Library/Application Support/com.prcopilot.app` on macOS).

## How it works

- A per-repo poller snapshots your PRs (checks, mergeability, comments, reviews) and diffs snapshots to
  fire **events** (`ci_failed`, `merge_conflict_detected`, `bug_bot_finding`, `review_requested`, …).
- Every event handler is `event -> { enabled, prompt }`. When enabled, the interpolated prompt runs
  against a Cursor agent. Defaults are opinionated (see Settings → Events); everything is editable
  per repo. New event types are just new catalog entries — the engine doesn't change.
- **Fix flows** (your PRs): the agent gets a dedicated git worktree, implements the fix, commits, and
  pushes to the PR branch automatically. Its PR-facing response lands in the proposal queue for your
  approval.
- **Review flows** (teammate PRs): the agent reviews the diff (default skill: thermonuclear code quality
  review) and proposes inline comments with severity & confidence, anchored on a native diff view.
  Tweak each one — edit, regenerate by custom prompt, or run the humanize skill — then submit the final
  review.
- **Drafts**: GitHub-style click/drag line selection on your draft PR diffs. Line-scoped change requests
  trigger an agent immediately (your own draft — no gate); questions/feedback run read-only.
- **Activity Feed**: live view of all agent runs — PR, relation, prompt, and streamed output.

## Skills

Skills are imported from `~/.cursor/commands`, `~/.cursor/skills`, and `~/.cursor/skills-cursor`, plus
any extra directories you configure. `humanize` and `thermonuclear-code-quality-review` ship as built-in
fallbacks when no local skill provides them. Skills are selectable per stage (review / fix / draft /
rewrite) and `/skill-name` references inside event prompts expand to the skill's content.

## Notes & limitations

- The watcher runs while a repo window is open (poll interval configurable, default 60s).
- The GitHub token is stored in the app data dir as plain JSON. Use a fine-grained token scoped to the
  repos you add.
- Fork-sourced PRs are never pushed to (fix flows refuse them); only same-repo branches qualify as
  "your own PR branch".
- Agents run via `cursor-agent --print --output-format stream-json`; fix/draft runs use `--force`,
  review/Q&A/rewrite runs use read-only `--mode ask`.
