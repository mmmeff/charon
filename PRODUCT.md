# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Software engineers reviewing pull requests from a macOS desktop app.

They work across active repositories, GitHub checks, human comments, local diffs, and agent runs. They need evidence in one place before they decide what lands.

## Product Purpose

Charon is a code review agent and control room for pull requests.

It watches PR events, gives coding agents bounded review and repair work, preserves the full run log, and turns GitHub-facing writes into proposals the developer can edit, regenerate, approve, or dismiss.

Success means the developer can understand a change, inspect what an agent did, and make the final call without chasing evidence across tools.

## Positioning

You approve what touches GitHub.
Agents investigate.

Charon treats every change as work to review. Generated code, hand-written code, teammate code, dependency churn, and bot fixes meet the same decision surface.

## Operating Context

Charon is a Tauri 2 desktop app built with Rust, React, and TypeScript. It lives beside GitHub, git worktrees, CI, and ACP-speaking coding agents.

The app supports Cursor, Claude Code, Codex, opencode, and configurable ACP commands. Repository windows remain independent. GitHub Enterprise and private certificate authorities are first-class paths.

## Capabilities and Constraints

- Tauri 2 shell with a Rust backend and a React and TypeScript front end.
- Pull request triage, draft work, local review, CI repair, comment addressing, and Q&A.
- Visible prompts, plans, tool calls, validation, streamed output, steering, and cancellation.
- GitHub-facing writes remain proposal cards until the developer approves them.
- Fixes push only to the developer's same-repository PR branches. Teammate reviews stay read-only.
- Free, open source, MIT licensed, and distributed as a universal macOS app.

## Brand Commitments

The product name is Charon.

Charon, Pluto's largest moon, remains the central image.

The voice is blunt, line-broken, and declarative. Japanese and English may mix. One hard truth earns one soft line.

The marketing identity uses saturated coral, cobalt blue, ink black, and warm light. Halftone printing, film grain, optical bloom, and cosmic animation are binding references.

## Evidence on Hand

- Current approved marketing copy in `site/index.html`.
- Canonical Tauri product architecture in `AGENTS.md`.
- Product screenshots and tour media in `site/assets/`.
- Existing Charon logo and app icon assets in `site/assets/`.
- User-supplied visual references in `/Users/mfrey/Pictures/design/`.

No customer logos, testimonials, usage benchmarks, or paid claims are approved.

## Product Principles

- Review is scarce. Spend automation on evidence, not authority.
- Agent work stays visible and interruptible.
- The Rust layer owns network, git, storage, process, window, notification, and update behavior.
- Private infrastructure is normal infrastructure.
- Product truth beats generated spectacle.

## Accessibility & Inclusion

The marketing site must remain usable with keyboard navigation, reduced motion, high zoom, and narrow screens. Decorative imagery must not carry required product meaning.
