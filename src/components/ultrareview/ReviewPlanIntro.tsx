import { useId } from "react";
import {
  storyProgressForChapter,
  storyProgressForSystems,
  storyScopeLabel,
  storyStateLabel,
} from "./story-state";
import type {
  StoryRisk,
  StorySystem,
  StoryThesis,
} from "../../types";

export type ReviewPlanFailure = {
  id: string;
  message: string;
  retryable?: boolean;
  systemId?: string | null;
  chapterId?: string | null;
};

export type ReviewPlanGenerationStage = {
  id: string;
  label: string;
  status: "pending" | "running" | "complete" | "failed";
  error?: string | null;
};

export type ReviewPlanGeneration = {
  status: "idle" | "running" | "partial" | "complete" | "failed";
  stages: readonly ReviewPlanGenerationStage[];
};

export type ReviewPlanCoverage = {
  mapped: number;
  total: number;
  unmapped: number;
};

export type ReviewPlanIntroProps = {
  thesis: StoryThesis;
  systems: readonly StorySystem[];
  coverage?: ReviewPlanCoverage;
  failures?: readonly ReviewPlanFailure[];
  generation?: ReviewPlanGeneration;
  beginLabel?: string;
  beginDisabled?: boolean;
  retrying?: boolean;
  retryingFailureId?: string;
  className?: string;
  ariaLabel?: string;
  onBeginReview: () => void;
  onOpenRawDiff?: () => void;
  onLeave?: () => void;
  onRetryFailures?: () => void;
  onRetryFailure?: (failureId: string) => void;
};

const RISK_WEIGHT: Record<StoryRisk, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function highestRisk(
  thesis: StoryThesis,
  systems: readonly StorySystem[],
): StoryRisk {
  return [thesis.risk, ...systems.map((system) => system.risk)]
    .reduce<StoryRisk>((highest, risk) => {
      const candidate = risk ?? "none";
      return RISK_WEIGHT[candidate] > RISK_WEIGHT[highest]
        ? candidate
        : highest;
    }, "none");
}

function countUnresolved(systems: readonly StorySystem[]): number {
  return systems.reduce(
    (systemTotal, system) =>
      systemTotal
      + system.chapters.reduce(
        (chapterTotal, chapter) =>
          chapterTotal
          + chapter.beats.reduce(
            (beatTotal, beat) =>
              beatTotal + (beat.unresolvedFeedback ?? 0),
            0,
          ),
        0,
      ),
    0,
  );
}

function chapterCount(systems: readonly StorySystem[]): number {
  return systems.reduce(
    (total, system) => total + system.chapters.length,
    0,
  );
}

function stateMark(state: StorySystem["state"]): string {
  switch (state) {
    case "active":
      return "●";
    case "reviewed":
      return "✓";
    case "stale":
      return "↺";
    case "failed":
      return "!";
    case "pending":
    case undefined:
      return "○";
  }
}

function FailureRows({
  failures,
  retryingFailureId,
  onRetryFailure,
}: {
  failures: readonly ReviewPlanFailure[];
  retryingFailureId?: string;
  onRetryFailure?: (failureId: string) => void;
}) {
  if (failures.length === 0) return null;
  return (
    <ul className="ultra-review-plan-failure-rows">
      {failures.map((failure) => (
        <li key={failure.id}>
          <span>{failure.message}</span>
          {failure.retryable !== false
            && onRetryFailure !== undefined && (
            <button
              type="button"
              disabled={retryingFailureId !== undefined}
              onClick={() => onRetryFailure(failure.id)}
            >
              {retryingFailureId === failure.id
                ? "Retrying…"
                : "Retry this region"}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ReviewPlanIntro({
  thesis,
  systems,
  coverage,
  failures = [],
  generation,
  beginLabel = "Begin review",
  beginDisabled = false,
  retrying = false,
  retryingFailureId,
  className,
  ariaLabel,
  onBeginReview,
  onOpenRawDiff,
  onLeave,
  onRetryFailures,
  onRetryFailure,
}: ReviewPlanIntroProps) {
  const titleId = useId();
  const progress = storyProgressForSystems(systems);
  const risk = highestRisk(thesis, systems);
  const unresolved = countUnresolved(systems);
  const chapters = chapterCount(systems);
  const scope = storyScopeLabel(thesis);
  const showSystemGroups = systems.length > 1;
  const chapterLabels = new Map<string, string>(
    systems.flatMap((system) =>
      system.chapters.map((chapter, index) => [
        chapter.id,
        `${index + 1}. ${chapter.title}`,
      ] as const)
    ),
  );
  const globalFailures = failures.filter(
    (failure) =>
      failure.systemId == null && failure.chapterId == null,
  );
  const classes = ["ultra-review-plan", className]
    .filter((value): value is string => value !== undefined)
    .join(" ");

  return (
    <main
      className={classes}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel === undefined ? titleId : undefined}
    >
      <header className="ultra-review-plan-head">
        <div className="ultra-review-plan-thesis">
          <span>UltraReview / review plan</span>
          <h1 id={titleId}>{thesis.title}</h1>
          {thesis.summary !== undefined && <p>{thesis.summary}</p>}
        </div>

        <dl className="ultra-review-plan-summary">
          <div>
            <dt>Scope</dt>
            <dd>{scope ?? "Not available"}</dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd>
              {chapters} chapter{chapters === 1 ? "" : "s"}
              <span aria-hidden> / </span>
              {progress.total} beat{progress.total === 1 ? "" : "s"}
            </dd>
          </div>
          {coverage !== undefined && (
            <div>
              <dt>Coverage</dt>
              <dd data-state={coverage.unmapped > 0 ? "failed" : "complete"}>
                {coverage.mapped}/{coverage.total} mapped
                {coverage.unmapped > 0
                  ? ` / ${coverage.unmapped} unmapped`
                  : ""}
              </dd>
            </div>
          )}
          <div>
            <dt>Risk</dt>
            <dd data-risk={risk}>
              {risk === "none" ? "No elevated risk" : `${risk} risk`}
            </dd>
          </div>
          <div>
            <dt>Progress</dt>
            <dd>
              {progress.reviewed} of {progress.total} inspected
            </dd>
          </div>
          {unresolved > 0 && (
            <div>
              <dt>Open notes</dt>
              <dd>{unresolved} unresolved</dd>
            </div>
          )}
        </dl>

        <div className="ultra-review-plan-actions">
          <div className="ultra-review-plan-utilities">
            {onLeave !== undefined && (
              <button type="button" className="link" onClick={onLeave}>
                Back to PR
              </button>
            )}
            {onOpenRawDiff !== undefined && (
              <button
                type="button"
                className="link"
                onClick={onOpenRawDiff}
              >
                Raw diff
              </button>
            )}
          </div>
          <button
            type="button"
            className="primary ultra-review-plan-begin"
            disabled={beginDisabled}
            onClick={onBeginReview}
          >
            {beginLabel}
            <span aria-hidden>→</span>
          </button>
        </div>
      </header>

      {generation !== undefined
        && generation.status !== "complete" && (
        <section
          className="ultra-review-plan-generation"
          data-status={generation.status}
          aria-live="polite"
        >
          <header>
            <div>
              <span>Analysis</span>
              <h2>
                {generation.status === "running"
                  ? "Building the review plan."
                  : generation.status === "partial"
                    ? "The usable plan is still partial."
                    : generation.status === "failed"
                      ? "The plan needs another pass."
                      : "Preparing analysis."}
              </h2>
            </div>
            <strong>{generation.status}</strong>
          </header>
          <ol>
            {generation.stages.map((stage, index) => (
              <li key={stage.id} data-status={stage.status}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{stage.label}</strong>
                  <small>
                    {stage.status === "running"
                      ? "Working now"
                      : stage.status}
                  </small>
                  {stage.error && <p>{stage.error}</p>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {globalFailures.length > 0 && (
        <section
          className="ultra-review-plan-failures"
          aria-labelledby={`${titleId}-failures`}
        >
          <div>
            <h2 id={`${titleId}-failures`}>Analysis is incomplete.</h2>
            <p>
              Completed chapters remain reviewable.
              Failed regions stay visible.
            </p>
          </div>
          <FailureRows
            failures={globalFailures}
            retryingFailureId={retryingFailureId}
            onRetryFailure={onRetryFailure}
          />
          {onRetryFailure === undefined
            && onRetryFailures !== undefined
            && globalFailures.some(
              (failure) => failure.retryable !== false,
            ) && (
            <button
              type="button"
              disabled={retrying}
              onClick={onRetryFailures}
            >
              {retrying ? "Retrying…" : "Retry failed analysis"}
            </button>
          )}
        </section>
      )}

      {systems.length === 0 ? (
        <section className="ultra-review-plan-empty" role="status">
          <h2>
            {generation?.status === "running"
              ? "The first chapter will appear here."
              : "No review plan exists yet."}
          </h2>
          <p>
            The raw diff stays available while analysis
            {" "}
            {generation?.status === "running"
              ? "organizes the change."
              : "recovers."}
          </p>
        </section>
      ) : (
        <div className="ultra-review-plan-systems">
          {systems.map((system, systemIndex) => (
            <section
              key={system.id}
              className="ultra-review-plan-system"
              data-grouped={showSystemGroups ? "true" : "false"}
              aria-labelledby={
                showSystemGroups
                  ? `${titleId}-system-${system.id}`
                  : undefined
              }
              aria-label={
                showSystemGroups ? undefined : "Review chapters"
              }
            >
              {showSystemGroups && (
                <header>
                  <div>
                    <span>
                      System {String(systemIndex + 1).padStart(2, "0")}
                    </span>
                    <h2 id={`${titleId}-system-${system.id}`}>
                      {system.title}
                    </h2>
                    {system.thesis !== undefined && <p>{system.thesis}</p>}
                  </div>
                  <span
                    className="ultra-review-plan-system-state"
                    data-state={system.state ?? "pending"}
                  >
                    <span aria-hidden>{stateMark(system.state)}</span>
                    {storyStateLabel(system.state)}
                  </span>
                </header>
              )}

              <FailureRows
                failures={failures.filter(
                  (failure) =>
                    failure.systemId === system.id
                    && failure.chapterId == null,
                )}
                retryingFailureId={retryingFailureId}
                onRetryFailure={onRetryFailure}
              />

              <ol className="ultra-review-plan-chapters">
                {system.chapters.map((chapter, chapterIndex) => {
                  const chapterProgress =
                    storyProgressForChapter(chapter);
                  const chapterState = chapter.state ?? "pending";
                  const chapterRisk = chapter.risk ?? "none";
                  const unresolvedFeedback =
                    chapter.unresolvedFeedback ?? 0;
                  const dependencies =
                    chapter.dependencyChapterIds
                      ?.map((id) => chapterLabels.get(id))
                      .filter(
                        (label): label is string =>
                          label !== undefined,
                      )
                    ?? [];
                  const chapterFailures = failures.filter(
                    (failure) =>
                      failure.chapterId === chapter.id,
                  );
                  return (
                    <li key={chapter.id} data-state={chapterState}>
                      <span
                        className="ultra-review-plan-chapter-number"
                        aria-hidden
                      >
                        {chapterIndex + 1}
                      </span>
                      <div className="ultra-review-plan-chapter-copy">
                        <h3>{chapter.title}</h3>
                        {chapter.purpose !== undefined && (
                          <p>{chapter.purpose}</p>
                        )}
                        {(chapter.before !== undefined
                          || chapter.after !== undefined) && (
                          <dl className="ultra-review-plan-change">
                            {chapter.before !== undefined && (
                              <div>
                                <dt>Before</dt>
                                <dd>{chapter.before}</dd>
                              </div>
                            )}
                            {chapter.after !== undefined && (
                              <div>
                                <dt>After</dt>
                                <dd>{chapter.after}</dd>
                              </div>
                            )}
                          </dl>
                        )}
                        {dependencies.length > 0 && (
                          <p className="ultra-review-plan-dependencies">
                            Depends on {dependencies.join(", ")}
                          </p>
                        )}
                        <FailureRows
                          failures={chapterFailures}
                          retryingFailureId={retryingFailureId}
                          onRetryFailure={onRetryFailure}
                        />
                      </div>
                      <div className="ultra-review-plan-chapter-signal">
                        <span>
                          {chapterProgress.reviewed}/
                          {chapterProgress.total} inspected
                        </span>
                        {chapterRisk !== "none" && (
                          <span data-risk={chapterRisk}>
                            {chapterRisk} risk
                          </span>
                        )}
                        {unresolvedFeedback > 0 && (
                          <span>{unresolvedFeedback} open</span>
                        )}
                        <span
                          className="ultra-review-plan-state-mark"
                          data-state={chapterState}
                          aria-label={storyStateLabel(chapterState)}
                          title={storyStateLabel(chapterState)}
                        >
                          {stateMark(chapterState)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
