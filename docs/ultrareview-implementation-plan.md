# UltraReview implementation plan

Status: active implementation contract.

Source: [UltraReview product specification](./ultrareview.md).

A review cannot stay coherent when every task opens a new layout.

UltraReview has one introduction and one review document.

Every slice must protect that shape.

## Working rules

Implementation uses a ticket-named feature branch, never `main`.

Each slice must produce a review path through data, persistence, UI, and verification.

No slice can create a second review state that conflicts with the existing diff or GitHub write path.

The native layer remains the only GitHub network boundary.

Every GitHub write requires a direct human action.

UltraReview uses the existing review model, reasoning level, speed, selected skills, and ACP guardrails.

The current proposal entity does not absorb UltraReview.

A separate versioned artifact owns the narrative and session lifecycle.

## Interface architecture

The interface has two stages.

The review plan introduces the thesis, ordered chapters, risk, coverage, and failures.

One `Begin review` or `Resume review` action enters the review document.

The document keeps one frame for `Review`, `Raw Diff`, and `Closing`.

Its top bar owns identity, mode selection, and exit.

Its left outline jumps to chapters and beats, highlights the current section,
and follows the reviewer through the document.

Its center canvas renders every beat in one causal, scrolling document.

Every beat summary remains mounted. Diff-heavy details are windowed around the
current reading position so document cost stays bounded on large changes.

One `Done reviewing` action ends the document and opens Final Review.

The header reports percent scrolled. Scrolling does not complete the review.

Mode changes preserve chapter selection, beat selection, scroll position, notes, and evidence expansion.

Chapter selection scrolls to a beat inside the document.

It does not open a separate chapter page.

Large pull requests add systems to the same outline.

They do not add another interface.

## Architecture path

`src/types.ts` defines the versioned artifact and review session.

`src/lib/ultraReview.ts` owns artifact parsing, identity, coverage, progress, delta, and continuation.

`src/lib/ultrareview-analysis.ts` owns prompts and validated model responses.

`src/lib/ultrareview-flow.ts` collects pull request context and runs read-only agent work.

`src/lib/ultrareview-diff-audit.ts` proves changed-line coverage.

`src/lib/ultrareview-session.ts` owns notes, concern disposition, drafts, resume state, and submission snapshots.

`src/lib/ultrareview-storage.ts` and `src/lib/ultrareview-store.ts` persist artifacts through native blob storage.

`src/lib/ultrareview-submission.ts` builds the exact approval-gated GitHub payload.

`src/components/UltraReviewWorkspace.tsx` joins the plan intro and long-form document.

`src/components/ultrareview/` contains small presentation components for those two stages.

## Slice 1: Establish the artifact and persistence spine

### Build

Add one versioned artifact for a repository, pull request, base SHA, and head SHA.

Keep teammate and author sessions separate inside the artifact.

Reject unknown versions and invalid coverage.

Store artifacts through native per-repository blob storage.

### Completion gates

- A valid artifact survives serialization and restart.
- Invalid data fails visibly and does not crash the repository window.
- Artifact identity prevents reuse across repositories, pull requests, or head versions.
- Resume state includes the beat, scroll position, and expanded evidence.
- Unit tests cover parsing, identity, persistence, and rejected data.

### Stories

UR-01, UR-03, and the persistence part of UR-20.

## Slice 2: Generate an honest review plan

### Build

Start analysis from the existing pull request view.

Use the configured review model and a read-only checkout.

Stream generation milestones in the intro.

Accept cumulative, validated progress snapshots from the analysis run.

Keep published chapters append-only through the terminal artifact.

Show the thesis, ordered chapters, risk, coverage, and failures.

Expose one `Begin review` or `Resume review` action.

### Completion gates

- A teammate pull request has a prominent on-demand UltraReview action.
- The intro shows useful progress before the complete plan exists.
- A validated chapter can enter the document while later analysis continues.
- The terminal artifact cannot rewrite a chapter already exposed for review.
- The configured model, reasoning, speed, and skills drive analysis.
- The primary action enters the first recommended or saved beat.
- A partial failure remains visible and has a focused retry.
- Preview fixtures cover loading, ready, partial, invalid, and resumed plans.

### Stories

UR-01, UR-02, UR-03, UR-05, and UR-19.

## Slice 3: Keep review work in one frame

### Build

Create the persistent review frame and long-form document.

Keep the top bar, outline, and center canvas stable.

Render all review beats in the center canvas; use the same canvas for `Raw Diff` and `Closing`.

Remove page-level navigation from chapters, beats, and closing.

### Completion gates

- The frame does not change when the reviewer switches modes.
- Every chapter and beat is reachable from one outline.
- Chapter selection scrolls to a beat instead of opening a page.
- Beat sections follow one another without sequence controls.
- Inspection remains one explicit local action at the end of each beat.
- `Shift+D` switches Review and Raw Diff.
- Mode changes preserve reading position, notes, and evidence expansion.
- Keyboard and reduced-motion behavior expose the same actions.
- Narrow preview sizes retain one clear review sequence.

### Stories

UR-02, UR-03, UR-04, UR-05, UR-09, and UR-12.

## Slice 4: Prove changed-line coverage

### Build

Project focused evidence through the existing diff renderer.

Map each changed line to one beat, one mechanical classification, or an unresolved entry.

Show supporting unchanged code without counting it as changed-line coverage.

Use the same evidence identity in Review and Raw Diff.

### Completion gates

- A beat can show disjoint excerpts from several files.
- Context expands inline to surrounding code and the complete file.
- Every changed line has one primary coverage state.
- Mechanical changes show reasons and require acknowledgment.
- Unmapped evidence blocks the fully reviewed state.
- Document completion is one explicit action and never comes from scrolling.
- Raw Diff credit requires an explicit action.
- Projected diff Viewed state remains local to each beat.
- Tests cover additions, deletions, renames, binaries, whitespace, overlap, and stale ranges.

### Stories

UR-04, UR-06, UR-07, UR-08, UR-09, and UR-12.

## Slice 5: Ground the story in live context

### Build

Supply the diff, read-only checkout, pull request description, commits, CI, comments, reviews, and timeline.

Label author intent, observed code, live state, and model inference as different source classes.

Attach comments, CI, tests, and supporting evidence to the relevant beat.

Add cited follow-up questions without changing the story.

### Completion gates

- Every GitHub read uses `FlowContext.gh`.
- Every `GitHubClient` request uses native `http_request`.
- Existing inline comments appear on their evidence.
- Blocking CI and unresolved feedback remain visible in each document mode.
- Test evidence sits beside the behavior that it validates.
- Supporting evidence links to exact repository locations.
- Follow-up answers reject unknown evidence citations.
- An explicit action converts an answer into a human note.
- Failed follow-up work leaves the beat usable and supports retry.

### Stories

UR-02, UR-07, UR-08, UR-10, UR-11, and UR-19.

## Slice 6: Collect notes and close the review

### Build

Store beat notes and line notes in one ledger.

Give model concerns dismiss, verify, and promote actions.

Use all notes as context for an editable draft.

Show draft provenance inside Charon.

Edit the review body, inline comments, and verdict together, then submit through the native client.

### Completion gates

- Review and Raw Diff show the same anchored notes.
- Line notes retain file, side, range, and head identity.
- The draft accounts for incorporated, combined, and omitted notes.
- Draft provenance returns to the exact note, beat, or evidence.
- Editing the draft never changes source notes.
- The submitted body contains no internal provenance markup.
- The user can edit the body and each candidate inline comment.
- The model never preselects a verdict.
- One explicit control submits the edited review.
- Incomplete submission names the missing work and keeps the session incomplete.
- A successful submission freezes an immutable local snapshot.

### Stories

UR-10 through UR-16.

## Slice 7: Continue after commits, failures, and restart

### Build

Compare old and new evidence identities after a head change.

Keep completion for unchanged evidence.

Mark affected beats stale.

Put `What changed since your review` first.

Keep completed chapters usable when another chapter fails.

### Completion gates

- A head change never reuses completion for changed evidence.
- The delta chapter names added, removed, and changed evidence.
- Stale notes and answers retain their prior head identity.
- A focused retry replaces only the failed analysis region.
- Missing stages remain visible coverage blockers.
- Restart restores active, failed, complete, and submitted states.
- Later analysis cannot change submission snapshots.
- Closed and merged pull requests render read-only.

### Stories

UR-03, UR-18, UR-19, and UR-20.

## Slice 8: Prepare an author's pull request

### Build

Project the same analysis into a separate author session.

Use readiness objectives for intent, tests, complexity, rollout, and cleanup.

Send selected notes to the existing fix-agent path only after direct action.

Close with `Ready for review` or `Continue working`.

### Completion gates

- Pull requests from the signed-in user enter author mode.
- Author progress and notes stay separate from teammate state.
- Selected notes can start one explicit fix-agent run.
- Fix runs keep the worktree, validation, push, and rescue-branch protections.
- `Continue working` keeps all state local.
- A self-review comment is a separate completion option.
- No author-mode model output posts or launches work automatically.

### Stories

UR-03, UR-10, UR-18, UR-19, and the author-mode contract.

## Slice 9: Scale the same document

### Build

Group chapters into systems when a pull request needs another hierarchy level.

Render those systems in the existing outline.

Give shared evidence one primary beat with backlinks from dependent chapters.

Keep one closing ledger and one human verdict.

### Completion gates

- Systems follow implementation goals instead of directories or commit order.
- Every changed line keeps one primary review location.
- Backlinks preserve notes and completion without duplicate coverage.
- The outline exposes only the causal hierarchy and jump targets.
- Failures and unmapped evidence stay in the document and closing ledger.
- Completed systems remain usable while later analysis continues.
- Partial failure never hides uncovered evidence.
- Preview fixtures cover systems, shared evidence, partial failure, and resumed states.

### Stories

UR-02, UR-05, UR-06, UR-12, UR-17, and UR-19.

## Slice 10: Dogfood one coherent product

### Build

Join every path into the on-demand dogfood release.

Keep Raw Diff as an internal document mode.

Store bounded diagnostic metadata on the device.

Document the review contract and GitHub write boundary.

### Completion gates

- Every teammate pull request can enter UltraReview on demand.
- An existing session resumes instead of regenerating.
- Local diagnostics contain no pull request or model prose.
- No diagnostic event leaves the device.
- Deterministic previews cover teammate, author, delta, failure, systems, Raw Diff, and Closing states.
- Typecheck, lint, unit tests, build, Cargo, and browser checks pass.
- README and architecture guidance describe the artifact and two-stage interface.
- The release leaves one clear path toward making UltraReview the default.

### Stories

UR-01 through UR-20.

## Dependency order

1. Slice 1 establishes artifact identity and persistence.
2. Slice 2 adds analysis and the review plan.
3. Slice 3 establishes the document frame.
4. Slice 4 joins evidence coverage to that frame.
5. Slice 5 adds live context and cited investigation.
6. Slice 6 joins notes, Closing, and explicit submission.
7. Slice 7 hardens continuation and failure behavior.
8. Slice 8 adds the author session.
9. Slice 9 scales the existing outline.
10. Slice 10 completes dogfood verification.

Slices 3 and 4 can run beside the context work in Slice 5 after the artifact schema is stable.

Slices 7 and 8 can run in parallel after submission snapshots exist.

No branch can invent another navigation frame.

## Verification

Run `npm run typecheck`.

Run `npm run lint`.

Run `npm test`.

Run `npm run build` for a release candidate.

Run `cargo check --manifest-path=src-tauri/Cargo.toml` for the native layer.

Verify the deterministic preview in a browser at each supported width.

`tests/unit/ultrareview-native-boundary.test.mjs` is a static architecture smoke test.

It rejects browser network APIs in UltraReview code.

It also traces GitHub reads through `FlowContext.gh`, `GitHubClient`, `native.httpRequest`, and the Rust `http_request` command.

The test traces artifact persistence through the native blob commands.

This smoke test does not prove live credentials, custom TLS, or a packaged Tauri process.

An automated end-to-end native test needs a Tauri app runtime and a controlled GitHub-compatible server.

The current private command handlers expose no test seam for that process without a product-code change.

Until that seam exists, `cargo check` plus a signed-in app smoke covers the runtime boundary.
