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

Large pull requests use the same chapter rail with systems.

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

Each chapter states its purpose and review scope.

The plan has one primary action.

`Begin review` opens the first recommended beat.

`Resume review` returns to the saved beat when a session already has progress.

The interface shows generation milestones in this stage until the plan is ready.

A partial failure stays beside the affected chapter and exposes a focused retry.

The reviewer can inspect the full plan without hunting for a second entry point.

### Stage 2: Review workbench

The workbench keeps one frame for the rest of the review.

The top bar shows pull request identity, total progress, and the `Review`, `Raw Diff`, and `Closing` modes.

The left rail shows every chapter and beat in causal order.

The center canvas shows the active mode.

The bottom flow bar holds the sequence controls for review work.

Those controls are `Previous`, `Mark inspected`, and `Next`.

The last beat changes `Next` to `Finish review`.

Chapter selection opens its first incomplete beat, or its first beat when all are complete.

Beat selection changes only the center canvas.

The frame, progress, rail, notes, and global controls stay in place.

The reviewer never enters a separate chapter page.

### Review mode

Review mode shows one beat and its focused evidence.

A beat asks the reviewer to inspect one coherent claim in two to five minutes.

A routine beat has one review objective.

A risky beat turns the objective into one visible question.

A beat starts with no more than three focal excerpts.

The reviewer can expand surrounding code or the complete file inline.

The code owns most of the canvas.

The chapter and beat context stay visible without becoming another navigation panel.

### Raw Diff mode

Raw Diff uses the same workbench frame and the same note ledger.

The mode remains one action and the `Shift+D` shortcut away.

Switching modes preserves the selected beat, review progress, notes, and expanded evidence.

Raw Diff scrolling never completes a beat.

The reviewer must explicitly credit mapped evidence that they inspect in Raw Diff.

GitHub's file-level Viewed state stays visible and separate.

### Closing mode

Closing uses the same workbench frame.

The chapter rail and progress stay visible while the reviewer prepares the verdict.

The mode shows coverage, conclusions, notes, promoted concerns, unresolved feedback, exclusions, CI, test gaps, and changes added during review.

The closing model builds an editable review draft from that ledger.

The reviewer chooses the final verdict and submits the exact payload through one explicit action.

## Modes of judgment

### Teammate mode

Teammate mode is the canonical UltraReview experience.

It guides an engineer toward a defensible GitHub review.

The model can explain mechanics, identify risk, and ask anchored questions.

The model never chooses or preselects the final verdict.

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
- **UR-04.** As a reviewer, I can switch between Review, Raw Diff, and Closing without losing context or progress.

### Evidence

- **UR-05.** As a reviewer, I can inspect each implementation goal as ordered chapters that contain small beats.
- **UR-06.** As a reviewer, I can trace every changed line to one primary beat or one mechanical-change classification.
- **UR-07.** As a reviewer, I can expand focused evidence into surrounding or complete file context inside the workbench.
- **UR-08.** As a reviewer, I can inspect labeled unchanged callers, interfaces, and consumers that explain impact.

### Judgment

- **UR-09.** As a reviewer, I can mark a beat inspected without declaring it correct.
- **UR-10.** As a reviewer, I can record beat notes and line notes with exact anchors.
- **UR-11.** As a reviewer, I can dismiss, verify, or promote a model concern into human feedback.
- **UR-12.** As a reviewer, I can submit early only after UltraReview names the incomplete work.

### Submission

- **UR-13.** As a reviewer, I can edit a review draft that uses all of my notes as context.
- **UR-14.** As a reviewer, I can trace each draft section to its notes, beats, and code evidence.
- **UR-15.** As a reviewer, I can keep line notes as candidate inline comments and overall-review context.
- **UR-16.** As a reviewer, I choose the verdict and explicitly submit the exact GitHub payload.

### Scale and change

- **UR-17.** As a reviewer of a large pull request, I can move through systems and chapters in the same workbench.
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

Systems appear in the same rail as chapters.

They do not change the workbench.

### Chapter

A chapter explains one implementation intent that can cross files and commits.

Its plan summary states the purpose, before-and-after behavior, dependencies, risk, and beat path.

The chapter order follows causal dependencies.

High-risk chapters stay directly reachable from the rail.

### Beat

A beat is one small review unit with focused evidence and one review objective.

One changed line has one primary beat.

Other chapters link to that evidence instead of duplicating review work.

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

Blocking CI and unresolved feedback remain visible in every workbench mode.

## Generation

Analysis begins when the reviewer explicitly enters UltraReview during dogfood.

The target is a skeleton within two seconds, the first chapter within fifteen seconds, and the complete plan within sixty seconds.

The intro shows concrete milestones such as indexing files, building chapters, and checking coverage.

The model can stream cumulative progress snapshots before the terminal artifact.

Each snapshot contains only complete chapters and final trusted evidence.

UltraReview validates every snapshot against the diff and preserves published chapters append-only.

`Begin review` unlocks when the first validated beat exists.

The terminal artifact can append later chapters.

It cannot rewrite evidence that the reviewer already saw.

The configured review model, reasoning level, speed, and skills control UltraReview.

UltraReview does not add a second model picker.

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

The reviewer can mark a beat inspected only when its focused evidence is available.

Inspected means examined.

It does not mean correct.

## Context tools

Focused actions include `Trace callers`, `Explain this dependency`, and `Find relevant tests`.

The reviewer can also ask a short question.

Every answer cites code or pull request evidence.

Answers stay attached to the beat.

They do not rewrite the generated story.

The reviewer can convert an answer into a human note through an explicit action.

Local diagrams appear only when at least three components have a meaningful relationship.

Every diagram node links to exact supporting evidence.

Simple relationships stay prose and code.

## Notes and concerns

UltraReview collects every human note in one ledger.

There is no private-versus-feedback decision during the review.

Beat notes preserve narrative context.

Line notes preserve file, side, range, and head identity.

Raw Diff and Review write to the same ledger.

A model concern begins as a question.

The reviewer can dismiss it, mark it verified, or promote it into human feedback.

Only human action moves model prose toward the final review.

## Closing ledger

The model synthesizes and deduplicates notes for the proposed GitHub prose.

The complete note ledger stays visible.

Each draft section links to the notes, beats, and evidence that support it.

The submitted GitHub review contains no internal provenance markup.

The draft is separate from the ledger.

Editing the draft never rewrites the source notes.

The closing model can summarize established review evidence.

It cannot introduce a new criticism after the review is complete.

The reviewer can edit the body and each candidate inline comment.

The reviewer then selects the verdict, inspects the exact payload, and submits it.

Incomplete coverage triggers a precise warning.

Submission can continue after that warning, but the local session stays incomplete.

## Lifecycle

The versioned artifact key contains the repository, pull request number, base SHA, and head SHA.

The artifact contains the thesis, systems, chapters, beats, evidence, coverage, generation state, source claims, concerns, notes, progress, and resume position.

It also contains draft and submission snapshots.

New commits start delta analysis.

Unchanged evidence preserves completion.

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

Raw Diff stays inside the workbench after that promotion.

## Success

UltraReview succeeds when a reviewer can explain the goal, implementation path, risks, and evidence behind the verdict.

Coverage and review time are guardrails.

Neither is the objective.

The design must reduce rereading and orientation loss.

It must never create confidence by hiding uncertainty.

## Version-one boundaries

Version one keeps generated chapters and beats fixed.

Users cannot split, merge, move, rename, or rewrite them.

Version one does not generate or preselect a verdict.

Version one does not post model concerns automatically.

Version one does not infer completion from scrolling, dwell time, or GitHub Viewed state.

Version one has no remote telemetry, shared review session, or collaboration backend.

Version one keeps truncation, failed analysis, uncovered evidence, and stale progress visible.

## Domain language

**UltraReview artifact** is the persisted analysis and review session for one pull request version.

**Review plan** is the intro that presents the thesis, ordered chapters, risk, and coverage.

**Workbench** is the persistent frame for Review, Raw Diff, and Closing.

**System** is an optional group of chapters for one major implementation goal.

**Chapter** is one semantic implementation intent in causal order.

**Beat** is one small review unit with focused evidence and one objective.

**Evidence reference** identifies changed or supporting code by path, side, and line range.

**Coverage entry** maps changed evidence to a beat, a mechanical classification, or an unresolved state.

**Concern** is a model-raised question that waits for human disposition.

**Note** is human-authored review context attached to a beat or code range.

**Closing ledger** is the complete local record that supplies context for the final review draft.

**Submission snapshot** is the immutable local record behind one explicit GitHub review.

The diff is evidence.

The story is the path through it.

The verdict belongs to the engineer.
