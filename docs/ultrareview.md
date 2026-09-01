# UltraReview

Status: approved product design.

Date: 2026-08-05.

A file-ordered diff makes the reviewer reconstruct the change before judging it.

UltraReview gives the change a causal reading order.

The model organizes the evidence.

The engineer owns the judgment.

## Product contract

UltraReview is an on-demand dogfood experience before it becomes the default view for teammate pull requests.

The first target is an engineer who reviews another person's pull request.

The initial sweet spot is a product change that spans 5 to 30 files.

Large pull requests use the same outline with systems.

They do not introduce another navigation model.

The review is complete when the engineer can explain the change and defend an `APPROVE`, `COMMENT`, or `REQUEST_CHANGES` verdict.

Finding defects matters.

Comment volume does not define success.

## Interaction contract

UltraReview has two product stages.

Generation is a transient state inside the first stage.

Raw Diff and Closing are modes inside the second stage.

### Stage 1: Review plan

The review plan introduces the pull request before code appears.

It shows the pull request thesis, ordered chapters, risk, coverage, and analysis failures.

Each chapter states its purpose and place in the pull request story.

The plan has one primary action.

`Begin review` opens the review document at the first recommended beat.

`Resume review` returns to the saved beat when a session already has progress.

The interface shows generation milestones in this stage until the plan is ready.

A partial failure stays beside the affected chapter and exposes a focused retry.

The reviewer can inspect the full plan without hunting for a second entry point.

### Stage 2: Review document

The review document keeps one frame for the rest of the review.

The top bar shows pull request identity and the `Review`, `Raw Diff`, and `Closing` modes.

The left outline shows every chapter and beat in causal order.

Review mode renders the full analyzed story as one long document.

Each beat follows the previous beat in the same scrolling surface.

Every beat summary remains in the document and in its scroll geometry. To keep
large pull requests responsive, Charon renders the opening details immediately,
reserves estimated geometry for untouched beats, and materializes nearby beats
one canvas ahead of the reading position. A materialized beat follows its live
content height, so collapsing a diff removes its space. Materialized details
stay cached and offscreen work uses browser containment. An outline jump
materializes the destination directly instead of rendering each intermediate
beat.

The outline jumps to a beat without replacing the document.

As the reviewer scrolls, browser-native intersection tracking highlights the
current beat and keeps that entry visible inside the rail without measuring
every section on each scroll frame.

The outline does not show completion counts, risk badges, or review state.

The header estimates reading progress from a fixed sequence of beat summaries
and owned diff hunks. It remembers the furthest unit crossed by the reading
line. Expanding or collapsing a diff cannot change the denominator or move the
percentage backward.

One `Done reviewing` action at the end of the document, repeated in the header,
records document completion and opens Final Review.

Scrolling and dwell time never record completion.

Raw Diff and Closing replace the document canvas while preserving the same frame and outline.

Notes and evidence expansion persist across modes.

The reviewer never enters a separate beat or chapter page.

### Review mode

Review mode shows every beat and its uniquely owned evidence in causal order.

A beat explains one coherent implementation claim in two to five minutes.

It makes the change, its purpose, and its beat-specific connection to the pull request thesis visible before the diff.

That context uses descriptive plain English instead of quoting code or diff text.

It does not tell the engineer what to inspect or which judgment to reach.

A beat starts with no more than three focal excerpts.

The reviewer can expand surrounding code or the complete file inline.

The code owns most of the canvas.

Chapter and beat context reads as document prose above each diff.

### Raw Diff mode

Raw Diff uses the same document frame and the same note ledger.

The mode remains one action and the `Shift+D` shortcut away.

Switching modes preserves the selected beat, scroll position, notes, and expanded evidence.

Raw Diff scrolling never completes the review document.

UltraReview tracks Viewed locally for each projected beat diff.

Collapsing Viewed code preserves the file header's position in the review
canvas.

GitHub's file-level Viewed state does not enter UltraReview because one file can contribute distinct hunks to several beats.

### Closing mode

Closing uses the same document frame.

The outline stays visible while the reviewer prepares the verdict.

The mode shows coverage, conclusions, notes, promoted concerns, unresolved feedback, exclusions, CI, test gaps, and changes added during review.

The closing model builds an editable review assessment and recommends a verdict from that ledger.

The reviewer edits notes inline on their diffs, chooses which line notes ship to GitHub, and reviews the body, verdict, and submission action in one flow.

## Modes of judgment

### Teammate mode

Teammate mode is the canonical UltraReview experience.

It guides an engineer toward a defensible GitHub review.

The model can explain mechanics, identify risk, and ask anchored questions.

The model recommends and preselects a verdict from the human notes.

The engineer can override that recommendation before submission.

### Author mode

Author mode serves pull requests that the signed-in user created.

It reuses the analyzed code story while keeping progress, prompts, notes, and the closing ledger separate.

It asks about intent mismatches, missing tests, accidental complexity, rollout risk, and cleanup.

It ends with `Ready for review` or `Continue working`.

The author can send selected notes to a fix agent through an explicit action.

The author can also opt into a GitHub self-review comment at completion.

Nothing launches or posts automatically.

## User stories

### Orientation

- **UR-01.** As a teammate reviewer, I can enter UltraReview from a pull request and see useful analysis progress immediately.
- **UR-02.** As a teammate reviewer, I can understand the thesis, chapter order, and main risks before I read code.
- **UR-03.** As a returning reviewer, I resume at the exact beat, scroll position, and evidence expansion that I left.
- **UR-04.** As a reviewer, I can switch between Review, Raw Diff, and Closing without losing context or my reading position.

### Evidence

- **UR-05.** As a reviewer, I can read each implementation goal as one ordered document of chapters and small beats.
- **UR-06.** As a reviewer, I can trace every changed line to one primary beat or one mechanical-change classification.
- **UR-07.** As a reviewer, I can expand focused evidence into surrounding or complete file context inside the document.
- **UR-08.** As a reviewer, I can inspect labeled unchanged callers, interfaces, and consumers that explain impact.

### Judgment

- **UR-09.** As a reviewer, the outline follows the current section while I scroll, and one action marks the whole document done.
- **UR-10.** As a reviewer, I can record typed beat notes and multi-line notes with exact anchors.
- **UR-11.** As a reviewer, I can dismiss, verify, or promote a model concern into human feedback.
- **UR-12.** As a reviewer, I can submit early only after UltraReview names the incomplete work.

### Submission

- **UR-13.** As a reviewer, I can edit a review draft that uses all of my notes as context.
- **UR-14.** As a reviewer, I can trace each draft section to its notes, beats, and code evidence.
- **UR-15.** As a reviewer, I can edit line notes on their diffs and choose which ones ship as inline comments.
- **UR-16.** As a reviewer, I edit the review, choose the verdict, and submit it from one workspace.

### Scale and change

- **UR-17.** As a reviewer of a large pull request, I can move through systems and chapters in the same document.
- **UR-18.** As a reviewer, I see a delta chapter when new commits arrive while unchanged work keeps its progress.
- **UR-19.** As a reviewer, I can continue through complete chapters and retry a failed chapter.
- **UR-20.** As a future maintainer, I can reopen a merged UltraReview as a read-only implementation story.

## Narrative hierarchy

The hierarchy groups code by intent.

File order and commit order remain evidence.

They do not control the story.

### Pull request thesis

The thesis states the behavioral change in one compact claim.

It anchors the plan intro and every chapter.

### System

A system groups chapters when a large pull request has several major implementation goals.

Systems appear in the same outline as chapters.

They do not change the document interaction.

### Chapter

A chapter explains one implementation intent that can cross files and commits.

Its plan summary states the purpose, before-and-after behavior, dependencies, risk, and beat path.

The chapter order follows causal dependencies.

High-risk chapters stay directly reachable from the outline.

### Beat

A beat is one small review unit with focused evidence and a clear role in the pull request story.

One changed line has one primary beat.

One physical diff hunk has one causal beat owner.

Other beats retain their narrative link to that evidence instead of rendering the hunk again.

## Analysis inputs

UltraReview can use the unified diff, read-only checkout, pull request description, commits, CI, comments, reviews, and timeline events.

Test changes live beside the behavior that they validate.

The closing ledger carries a test inventory and names behavior without visible proof.

Unchanged code can appear as supporting evidence when it explains callers, interfaces, state consumers, or runtime impact.

Supporting evidence never counts as changed-line coverage.

Every assertion identifies its source class.

Author-stated intent is different from model-inferred intent.

Observed mechanics are different from predicted behavior.

Existing comments and CI attach to the relevant beat.

Blocking CI and unresolved feedback remain visible in every document mode.

## Generation

Analysis begins when the reviewer explicitly enters UltraReview during dogfood.

The target is a skeleton within two seconds, the first chapter within fifteen seconds, and the complete plan within sixty seconds.

The intro shows indexing and story construction as stable numbered steps.

After the plan arrives, one `Building Review Chapters` step owns the live agent snippet and nests each chapter milestone below it.

Charon gives the selected ACP harness a run-scoped stdio MCP publisher.

The packaged `scripts/ultrareview-publisher-v2.json` contract supplies exact nested JSON Schemas, limits, descriptions, and valid examples for every tool.

The model publishes the stable thesis and system skeleton through `publish_plan`.

It then calls `publish_chapter` as soon as each chapter is complete.

The plan contains grounding plus nested systems and chapters with short semantic keys.

Array position supplies order.

Each chapter call contains purpose, before and after context, beats, optional mechanical changes, and optional dependencies on earlier chapter keys.

It never repeats an accepted chapter.

Changed evidence travels only as trusted manifest IDs.

Unchanged context travels as a repository-root-relative head path, inclusive line range, and reason inside its beat.

Human-facing plan and chapter fields describe behavior and intent in plain English without copying code.

Tests share a beat with the implementation behavior they validate instead of becoming separate test-only beats.

Concerns live inside their beat as a severity and open question.

Charon reads context through the native Git or GitHub path, checks that it does not overlap changed evidence, and computes the supporting fingerprint and evidence ID.

Charon assigns system, chapter, beat, source-claim, concern, mechanical-change, stage, and failure IDs.

It also assigns order, scope, locations, source-claim references, and coverage.

The model never serializes those stored artifact fields.

Successful calls return structured receipts with generated IDs.

Rejected calls return a semantic path, error code, concrete message, and repair instruction instead of an internal artifact-parser error.

`finish_review` accepts only failed chapter keys, messages, and retryability after every other chapter is published.

Charon normalizes failure ownership, performs the final trusted diff audit, and leaves uncovered evidence visible as unmapped work.

Published systems and chapters are append-only.

The plan is limited to 64,000 bytes.

Each semantic chapter call is limited to 512,000 bytes.

Terminal-mode retries retain tagged progress blocks and candidate validation.

Charon writes the trusted evidence manifest to a unique app-data file instead of embedding it in the generation prompt.

Fresh staged generation does not build a terminal candidate.

Charon owns final artifact assembly from accepted semantic plan and chapter calls.

Focused retries can still write a candidate and run Charon's packaged validator before authoritative parsing.

`Begin review` unlocks when the first validated beat exists.

Later accepted chapters append to the review document.

It cannot rewrite evidence that the reviewer already saw.

Settings has a dedicated default model for UltraReview generation.

Until the user changes it, that default inherits the configured review model.

Reasoning encoded in the selected model stays part of that choice.

Harnesses with a separate reasoning axis expose a dedicated UltraReview default.

Until the user changes it, reasoning and speed inherit the Review defaults.

Generation continues to use the Review skills.

UltraReview does not add an inline model picker.

Generation stores one local story for each `baseSha..headSha`.

Reopening an unchanged pull request reuses that story.

Separate Charon installations generate separate local stories.

There is no collaboration backend.

## Coverage

Every changed line maps to one primary beat or one explicit mechanical-change entry.

Generated files, lockfiles, formatting, and mechanical renames collect in a compact mechanical-change chapter.

The chapter explains each classification.

The reviewer must acknowledge the chapter.

Unmapped changes get a visible section.

Unmapped evidence blocks the fully reviewed state.

A partial analysis failure behaves the same way.

It cannot disappear behind a successful summary.

The reviewer completes the review document with one explicit `Done reviewing`
action. Completion means the document was read. It does not choose a verdict or
hide incomplete analysis, unmapped evidence, mechanical changes, CI failures, or
unresolved feedback.

## Notes and concerns

UltraReview collects every human note in one ledger.

There is no private-versus-feedback decision during the review.

Beat notes preserve narrative context.

Line notes preserve file, side, range, and head identity.

A line range may cite several adjacent trusted evidence records.

Each note is a note, nitpick, request, suggestion, or praise.

Raw Diff and Review write to the same ledger.

A model concern begins as a question.

The reviewer can dismiss it, mark it verified, or promote it into human feedback.

Only human action moves model prose toward the final review.

## Closing ledger

The model synthesizes and deduplicates all notes for the proposed GitHub prose.

Repository settings hold the configurable final-assessment prompt.

The complete note ledger stays visible.

Each draft section links to the notes, beats, and evidence that support it.

The submitted GitHub review contains no internal provenance markup.

The draft is separate from the ledger.

Editing the draft never rewrites the source notes.

The closing model can summarize established review evidence.

It cannot introduce a new criticism after the review is complete.

The reviewer edits source notes in place and explicitly marks line notes that should ship as GitHub inline comments.

Selected line notes keep their human-authored body and trusted range. The closing model cannot create or move inline comments.

The closing model recommends `COMMENT`, `APPROVE`, or `REQUEST_CHANGES` from the notes and pre-fills that choice.

The reviewer can override the body or verdict and submits from the same section.

Incomplete coverage triggers a precise warning.

Submission can continue after that warning, but the local session stays incomplete.

## Lifecycle

The versioned artifact key contains the repository, pull request number, base SHA, and head SHA.

The artifact contains the thesis, systems, chapters, beats, evidence, coverage, generation state, source claims, concerns, notes, document completion, and resume position.

It also contains draft and submission snapshots.

New commits start delta analysis.

New commits reopen document completion while preserving unchanged notes and reading context.

Affected beats become stale.

The delta appears first as `What changed since your review`.

A submitted GitHub review freezes an immutable local snapshot.

Later commits create a continuation instead of changing that snapshot.

Merged or closed stories remain readable.

Stories generated after merge remain opt-in.

## Persistence and privacy

All UltraReview artifacts live in native per-repository blob storage.

The webview never calls GitHub directly.

UltraReview reads GitHub through `FlowContext.gh`.

`GitHubClient` sends each request through the native `http_request` command.

Every GitHub write also uses the native client and an explicit human action.

Local diagnostics contain timing, stage failure, and retry metadata.

They contain no pull request body, diff, comment text, note text, or model prose.

Nothing reports product usage to a remote service.

Model data handling follows the configured ACP harness.

## Rollout

Version one exposes a prominent UltraReview entry from the existing pull request view.

Dogfood uses real pull requests and deterministic preview fixtures.

Promotion to the default view remains a product decision after dogfood.

Raw Diff stays inside the document frame after that promotion.

## Success

UltraReview succeeds when a reviewer can explain the goal, implementation path, risks, and evidence behind the verdict.

Coverage and review time are guardrails.

Neither is the objective.

The design must reduce rereading and orientation loss.

It must never create confidence by hiding uncertainty.

## Version-one boundaries

Version one keeps generated chapters and beats fixed.

Users cannot split, merge, move, rename, or rewrite them.

Version one recommends and preselects a verdict but never submits it.

Version one does not post model concerns automatically.

Version one does not infer completion from scroll percentage, dwell time, or GitHub Viewed state.

Version one has no remote telemetry, shared review session, or collaboration backend.

Version one keeps truncation, failed analysis, uncovered evidence, and stale progress visible.

## Domain language

**UltraReview artifact** is the persisted analysis and review session for one pull request version.

**Review plan** is the intro that presents the thesis, ordered chapters, risk, and coverage.

**Review document** is the persistent frame and long-form reading surface for Review, Raw Diff, and Closing.

**System** is an optional group of chapters for one major implementation goal.

**Chapter** is one semantic implementation intent in causal order.

**Beat** is one small review unit with focused evidence and a clear role in the pull request story.

**Evidence reference** identifies changed or supporting code by path, side, and line range.

**Coverage entry** maps changed evidence to a beat, a mechanical classification, or an unresolved state.

**Concern** is a model-raised question that waits for human disposition.

**Note** is human-authored review context attached to a beat or code range.

**Closing ledger** is the complete local record that supplies context for the final review draft.

**Submission snapshot** is the immutable local record behind one explicit GitHub review.

The diff is evidence.

The story is the path through it.

The verdict belongs to the engineer.
