import { motion } from "motion/react";
import { useId } from "react";
import {
  storyScopeLabel,
} from "./story-state";
import type {
  StoryRisk,
  StorySystem,
  StoryThesis,
} from "../../types";
import { AetherField } from "../AetherField";
import { Spinner } from "../common";

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
  systemId?: string | null;
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
  reasoningActivity?: string;
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

type GenerationQueue = {
  setup: ReviewPlanGenerationStage[];
  chapters: ReviewPlanGenerationStage[];
};

const CHAPTER_GROUP_ID = "building-review-chapters";

function latestReasoningParagraph(
  activity?: string,
  limit = 180,
): string {
  const paragraph = activity
    ?.split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1) ?? "";
  if (paragraph.length <= limit) return paragraph;
  return `${paragraph.slice(0, limit - 1).trimEnd()}…`;
}

function generationQueue(
  generation: ReviewPlanGeneration,
): GenerationQueue {
  const indexing = generation.stages.find(
    (stage) =>
      stage.id.includes("index")
      || /index/i.test(stage.label),
  );
  const story = generation.stages.find(
    (stage) =>
      stage.id.includes("story")
      || /stor(y|ies)|causal chapter/i.test(stage.label),
  );
  const plannedChapters = generation.stages
    .filter(
      (stage) =>
        stage.systemId != null
        || /^chapter:\s*/i.test(stage.label),
    )
    .map((stage) => ({
      ...stage,
      label: stage.label.replace(/^chapter:\s*/i, ""),
    }));
  const initialStatus = generation.status === "failed"
    ? "failed" as const
    : "running" as const;

  return {
    setup: [
      {
        id: "indexing-files",
        label: "Indexing files",
        status: indexing?.status ?? initialStatus,
        error: indexing?.error,
      },
      {
        id: "building-story",
        label: "Building story",
        status: story?.status ?? "pending",
        error: story?.error,
      },
    ],
    chapters: plannedChapters,
  };
}

function visibleStageStatus(
  generation: ReviewPlanGeneration,
  stage: ReviewPlanGenerationStage,
): ReviewPlanGenerationStage["status"] {
  if (
    generation.status === "failed"
    && stage.status === "running"
  ) {
    return "failed";
  }
  return stage.status;
}

function chapterGroupStage(
  generation: ReviewPlanGeneration,
  chapters: readonly ReviewPlanGenerationStage[],
): ReviewPlanGenerationStage | null {
  if (chapters.length === 0) return null;
  const statuses = chapters.map(
    (stage) => visibleStageStatus(generation, stage),
  );
  const status = generation.status === "running"
    ? "running" as const
    : statuses.every((candidate) => candidate === "complete")
      ? "complete" as const
      : generation.status === "failed"
        || generation.status === "partial"
        ? "failed" as const
        : statuses.some((candidate) => candidate === "running")
          ? "running" as const
          : statuses.some((candidate) => candidate === "failed")
            ? "failed" as const
            : "pending" as const;
  return {
    id: CHAPTER_GROUP_ID,
    label: "Building Review Chapters",
    status,
  };
}

function GenerationStageActivity({
  status,
  generating,
  showReasoning,
  reasoningSnippet,
}: {
  status: ReviewPlanGenerationStage["status"];
  generating: boolean;
  showReasoning: boolean;
  reasoningSnippet: string;
}) {
  return (
    <div
      className="ultra-review-plan-stage-activity"
      role={showReasoning ? "status" : undefined}
      aria-atomic={showReasoning ? "true" : undefined}
    >
      <span className="ultra-review-plan-stage-state">
        {generating
          ? <Spinner size={11} />
          : (
              <span aria-hidden>
                {status === "complete"
                  ? "✓"
                  : status === "failed"
                    ? "!"
                    : "○"}
              </span>
            )}
        <small>{generating ? "Generating" : status}</small>
      </span>
      {showReasoning && (
        <span className="ultra-review-plan-stage-reasoning">
          {reasoningSnippet || "Starting analysis…"}
        </span>
      )}
    </div>
  );
}

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
                : failure.systemId == null
                  && failure.chapterId == null
                  ? "Restart analysis"
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
  reasoningActivity,
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
  const risk = highestRisk(thesis, systems);
  const unresolved = countUnresolved(systems);
  const chapters = chapterCount(systems);
  const beats = systems.reduce(
    (total, system) =>
      total + system.chapters.reduce(
        (chapterTotal, chapter) =>
          chapterTotal + chapter.beats.length,
        0,
      ),
    0,
  );
  const scope = storyScopeLabel(thesis);
  const showSystemGroups = systems.length > 1;
  const queue = generation === undefined
    ? { setup: [], chapters: [] }
    : generationQueue(generation);
  const chapterGroup = generation === undefined
    ? null
    : chapterGroupStage(generation, queue.chapters);
  const topLevelStages = chapterGroup === null
    ? queue.setup
    : [...queue.setup, chapterGroup];
  const completedGenerationStages = topLevelStages.filter(
    (stage) => stage.status === "complete",
  ).length;
  const activeGenerationStageId = generation?.status === "running"
    ? topLevelStages.find((stage) => stage.status === "running")?.id
      ?? topLevelStages.find((stage) => stage.status === "pending")?.id
    : undefined;
  const reasoningStageId = generation?.status === "running"
    ? chapterGroup === null
      ? "building-story"
      : CHAPTER_GROUP_ID
    : undefined;
  const reasoningSnippet = latestReasoningParagraph(reasoningActivity);
  const summary =
    generation?.status === "failed"
      ? "UltraReview could not build this review plan."
      : thesis.summary;
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
        <AetherField
          seed={73}
          active={generation?.status === "running"}
        />
        <div className="ultra-review-plan-thesis">
          <div className="ultra-review-plan-kicker">
            <span>UltraReview / review plan</span>
          </div>
          <h1 id={titleId}>{thesis.title}</h1>
          {summary !== undefined && <p>{summary}</p>}
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
              {beats} beat{beats === 1 ? "" : "s"}
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
        >
          <header>
            <div>
              <span>Analysis</span>
              <h2>
                {generation.status === "running"
                  ? "Building the review plan."
                  : generation.status === "partial"
                    ? "Analysis incomplete."
                    : generation.status === "failed"
                      ? "UltraReview could not build this review plan."
                      : "Preparing analysis."}
              </h2>
            </div>
            <strong>
              {generation.status === "failed"
                ? "failed"
                : topLevelStages.length > 0
                ? `${completedGenerationStages} of ${topLevelStages.length} complete`
                : generation.status}
            </strong>
          </header>
          <ol>
            {topLevelStages.map((stage, index) => {
              const stageStatus = visibleStageStatus(
                generation,
                stage,
              );
              const generating = generation.status === "running"
                && (
                  stageStatus === "running"
                  || stageStatus === "pending"
                );
              return (
                <motion.li
                  key={stage.id}
                  layout
                  initial={stage.id === CHAPTER_GROUP_ID
                    ? { opacity: 0, y: 8 }
                    : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.22,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  data-status={stageStatus}
                  data-stage-group={
                    stage.id === CHAPTER_GROUP_ID ? "chapters" : undefined
                  }
                  aria-current={
                    stage.id === activeGenerationStageId
                      ? "step"
                      : undefined
                  }
                >
                  <span>{index + 1}</span>
                  <div className="ultra-review-plan-stage-copy">
                    <strong>{stage.label}</strong>
                    <GenerationStageActivity
                      status={stageStatus}
                      generating={generating}
                      showReasoning={stage.id === reasoningStageId}
                      reasoningSnippet={reasoningSnippet}
                    />
                    {stage.error && <p>{stage.error}</p>}
                    {stage.id === CHAPTER_GROUP_ID && (
                      <ol className="ultra-review-plan-chapter-stages">
                        {queue.chapters.map((chapter, chapterIndex) => {
                          const chapterStatus = visibleStageStatus(
                            generation,
                            chapter,
                          );
                          const chapterGenerating =
                            generation.status === "running"
                            && (
                              chapterStatus === "running"
                              || chapterStatus === "pending"
                            );
                          return (
                            <motion.li
                              key={chapter.id}
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{
                                duration: 0.2,
                                delay: Math.min(
                                  chapterIndex * 0.035,
                                  0.18,
                                ),
                                ease: [0.16, 1, 0.3, 1],
                              }}
                              data-status={chapterStatus}
                            >
                              <span aria-hidden>{chapterIndex + 1}</span>
                              <div className="ultra-review-plan-stage-copy">
                                <strong>{chapter.label}</strong>
                                <GenerationStageActivity
                                  status={chapterStatus}
                                  generating={chapterGenerating}
                                  showReasoning={false}
                                  reasoningSnippet=""
                                />
                                {chapter.error && <p>{chapter.error}</p>}
                              </div>
                            </motion.li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                </motion.li>
              );
            })}
          </ol>
        </section>
      )}

      {globalFailures.length > 0 && (
        <section
          className="ultra-review-plan-failures"
          aria-labelledby={`${titleId}-failures`}
        >
          <div>
            <h2 id={`${titleId}-failures`}>Analysis incomplete.</h2>
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

      {systems.length === 0
        && generation?.status !== "failed"
        && generation?.status !== "running" ? (
        <section className="ultra-review-plan-empty" role="status">
          <h2>No review plan yet.</h2>
        </section>
      ) : systems.length > 0
        && generation?.status !== "running" ? (
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
                    <li key={chapter.id}>
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
                      {(chapterRisk !== "none"
                        || unresolvedFeedback > 0) && (
                        <div className="ultra-review-plan-chapter-signal">
                          {chapterRisk !== "none" && (
                            <span data-risk={chapterRisk}>
                              {chapterRisk} risk
                            </span>
                          )}
                          {unresolvedFeedback > 0 && (
                            <span>{unresolvedFeedback} open</span>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      ) : null}
    </main>
  );
}
