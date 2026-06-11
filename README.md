<p align="center">
  <img src="docs/hero.svg" alt="Charon — human-in-the-loop agents for pull requests" width="100%"/>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-cff24d?style=flat-square&labelColor=15140f" alt="MIT license"/></a>
  <img src="https://img.shields.io/badge/Tauri-2-ff4f00?style=flat-square&labelColor=15140f" alt="Tauri 2"/>
  <img src="https://img.shields.io/badge/React-18-8fb4cc?style=flat-square&labelColor=15140f" alt="React 18"/>
  <img src="https://img.shields.io/badge/TypeScript-strict-e9e4d4?style=flat-square&labelColor=15140f" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/agents-Cursor%20CLI-ffb000?style=flat-square&labelColor=15140f" alt="Cursor CLI"/>
</p>

AI made writing code cheap. It didn't make *merging* it cheap: the PRs got bigger, more numerous,
and more uneven, while review capacity — humans with context and accountability — stayed exactly
the same. That's the new bottleneck, and the popular fix (point another unsupervised bot at the
thread) just moves the noise downstream to the people who have to read it.

**Charon is a desktop control room for that bottleneck.** It watches every PR you own and every
review you owe, fires agents at the work that doesn't need your judgment — failing CI, merge
conflicts, bug-bot triage, first-pass review — and turns what *does* need your judgment into
fast, well-presented decisions: **proposals you edit and approve before anything touches GitHub**.

<p align="center">
  <img src="docs/tour.gif" alt="Charon tour: babysitting PRs, reviewing a teammate's diff, watching agents stream" width="100%"/>
</p>

## Tools for the human in the loop, not a louder bot

You can't fix an AI-volume problem by adding more unsupervised AI output — auto-posted reviews and
auto-replies are how PR threads became unreadable in the first place. Charon spends its
intelligence the other way: agents do the legwork, and the product of every run is a *decision
surface* for you — diffs with anchored findings, severity and confidence on every comment,
one-click apply-or-dismiss — instead of another post in the thread.

- **The app never posts comments, replies, or reviews on its own.** Every GitHub-facing write is a
  proposal card — edit it, regenerate it with a custom prompt, run it through a humanize skill, or
  dismiss it. Nothing ships until you hit *Approve & send*. Your teammates always get *you*, at
  your speed, not a bot wearing your name.
- **One automated exception, by design:** during fix flows the agent commits and pushes to *your
  own* PR branches (never forks, never teammates' branches). Code is reviewable after the fact;
  comments that impersonate you are not.
- Agents reviewing teammates' code run **read-only**. Fix agents get an **isolated git worktree**
  scoped to the one PR they're fixing.

## What it does

### Babysits your open PRs

A per-repo poller snapshots checks, mergeability, comments, and reviews, then diffs the snapshots
into **events**: `ci_failed`, `merge_conflict_detected`, `bug_bot_finding`,
`teammate_review_submitted`, and twenty more. Each event runs your prompt against a Cursor agent —
the default playbook fixes CI, resolves conflicts, and triages bot findings before you've finished
your coffee. Self-review findings (severity- and confidence-tagged, with concrete suggestions) land
anchored on the diff, one *Apply* away from a fix agent.

<img src="docs/open-prs.png" alt="Open PRs view: CI status, event feed, pending proposals, inline findings on the diff" width="100%"/>

### Drafts reviews you'd actually send

When a teammate requests your review, an agent reads the full diff and drafts inline comments —
each with severity, confidence, and an editable body — anchored on a native diff view with file
tree, unified/split modes, and resolvable threads. Toggle comments off, rewrite them, change the
verdict, then submit the whole review in one shot.

<img src="docs/review.png" alt="Review view: proposed inline comments with severity and confidence, anchored on the diff" width="100%"/>

### Treats your drafts as a workspace

GitHub-style click-and-drag line selection on your draft PRs. Select lines and *Edit* — an agent
implements the change in a worktree and pushes. Ask a question instead and it answers read-only.
Your draft, no approval gate, full speed.

<img src="docs/drafts.png" alt="Drafts view: line-scoped agent edits on your draft PRs" width="100%"/>

### Shows you everything the agents do

Every run — its prompt, model, working directory, and live streamed output — in one feed. Stop a
runaway agent with one click.

<img src="docs/activity.png" alt="Activity feed: live streaming agent runs" width="100%"/>

### And every behavior is a prompt you own

Every event handler is a toggle plus a prompt template. Don't like how the CI-fix prompt reads?
Edit it. Want conflict resolution off for one repo? Toggle it. Per-repo filters (labels, drafts,
freeform LLM criteria) decide what's worth an agent's attention. New event types are catalog
entries — the engine never changes.

<img src="docs/settings-events.png" alt="Settings: the event catalog — every behavior is a toggle plus an editable prompt" width="100%"/>

> [!NOTE]
> **Cursor is the only supported agent harness today.** Every agent run shells out to the
> [Cursor CLI](https://cursor.com/cli) (`cursor-agent`), so that's the one dependency you need
> wired up right now. The harness is the one piece that's pluggable by design — adapters for
> Claude Code, Codex, or any other CLI that streams output would slot in behind the same
> `event -> { enabled, prompt }` interface. **Contributions for other harnesses are very welcome** —
> open an issue or PR.

## How it works

- **Stack:** Tauri 2 shell (Rust backend for HTTP, git, process spawning) + React/TypeScript front
  end. One window per repo, each with its own poller and locally-stored config.
- **Events:** every handler is `event -> { enabled, prompt }`. Prompts interpolate variables
  (`{pr-number}`, `{check-name}`, `{comment-body}`, …) and `/skill-name` references.
- **Agents:** runs go through `cursor-agent --print --output-format stream-json`. Fix/draft runs
  use `--force` inside a dedicated worktree; review/Q&A/rewrite runs use read-only `--mode ask`.
- **Skills:** imported from `~/.cursor/commands`, `~/.cursor/skills`, and any directories you add.
  `humanize` and `thermonuclear-code-quality-review` ship as built-in fallbacks. Skills are
  selectable per stage (review / fix / draft / rewrite).
- **GitHub:** works against github.com and GitHub Enterprise (`<url>/api/v3`), REST + a dash of
  GraphQL for review-thread resolution. Fine-grained PAT recommended.

## Getting started

**Download:** grab the latest macOS DMG (universal — Apple Silicon + Intel) from
[Releases](../../releases/latest). The app isn't code-signed yet; on first launch right-click →
Open, or clear the quarantine flag with `xattr -cr /Applications/Charon.app`. You'll still need the
[Cursor CLI](https://cursor.com/cli) (`cursor-agent login`) for agent runs.

**Or build from source** — prerequisites: **Node 18+**, **Rust (stable)**, and the Cursor CLI:

```sh
npm install
npm run tauri dev      # development
npm run tauri build    # packaged app
```

Releases are cut by the [release workflow](.github/workflows/release.yml): push a `v*` tag (or run
it manually from the Actions tab) and it builds the universal DMG and publishes it.

<p align="center">
  <img src="docs/onboarding.png" alt="Onboarding: GitHub instance, PAT, cursor-agent binary" width="85%"/>
</p>

On first boot, point it at your GitHub instance (github.com or a GHE URL) and a personal access
token with repo contents + pull-request read/write. Add repos by `owner/name` — each opens in its
own window.

## Trust & limitations

- The GitHub token is stored in the app data dir as plain JSON
  (`~/Library/Application Support/com.prcopilot.app` on macOS). Use a fine-grained token scoped to
  the repos you add.
- Fork-sourced PRs are never pushed to — fix flows refuse them; only same-repo branches count as
  "your own".
- The watcher runs while a repo window is open (poll interval configurable, default 60s).
- Screenshots above show a demo workspace (`boxcar/dispatch`) — fictional repo, real UI.

## License

[MIT](LICENSE) © Matt Frey
