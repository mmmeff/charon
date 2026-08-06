import { parseUnifiedDiff } from "../../src/lib/diff";
import {
  enumerateUltraReviewDiffChanges,
} from "../../src/lib/ultrareview-diff-audit";
import {
  createUltraReviewArtifact,
  parseUltraReviewAnalysisJson,
} from "../../src/lib/ultraReview";
import type {
  PrSummary,
  UltraReviewArtifact,
  UltraReviewArtifactIdentity,
  UltraReviewMode,
} from "../../src/types";
import { diffText, REPO } from "./fixtures";

export type UltraReviewPreviewVariant =
  | "ready"
  | "resumed"
  | "partial"
  | "complex"
  | "delta"
  | "loading"
  | "progressive"
  | "invalid"
  | "author";

const sourceClaim = (
  id: string,
  kind:
    | "author_stated"
    | "code_observed"
    | "existing_feedback"
    | "ci_observed",
  claim: string,
  evidenceIds: string[],
) => ({
  id,
  kind,
  claim,
  evidenceIds,
});

function identityFor(
  pr: PrSummary,
): UltraReviewArtifactIdentity {
  return {
    repo: REPO,
    prNumber: pr.number,
    baseSha: pr.baseSha,
    headSha: pr.headSha,
  };
}

function analyzedArtifact(
  pr: PrSummary,
  variant: UltraReviewPreviewVariant,
): UltraReviewArtifact {
  const changes = enumerateUltraReviewDiffChanges(
    parseUnifiedDiff(diffText),
  );
  const midpoint = Math.max(1, Math.floor(changes.length / 2));
  const leaseEvidence = changes.slice(0, midpoint);
  const rescueEvidence = changes.slice(midpoint);
  const sourceClaims = [
    sourceClaim(
      "source:author",
      "author_stated",
      "Reject unreachable clone roots before an agent can commit.",
      leaseEvidence.map((change) => change.id),
    ),
    sourceClaim(
      "source:code",
      "code_observed",
      "The lease path now probes the clone root and carries the failure forward.",
      leaseEvidence.map((change) => change.id),
    ),
    sourceClaim(
      "source:feedback",
      "existing_feedback",
      "A reviewer asked whether rejected branches accumulate.",
      rescueEvidence.map((change) => change.id),
    ),
    sourceClaim(
      "source:ci",
      "ci_observed",
      "The moved-clone integration check is still failing.",
      rescueEvidence.map((change) => change.id),
    ),
  ];
  const evidence = changes.map((change) => ({
    id: change.id,
    kind: "changed" as const,
    change: change.change,
    location: change.location,
    fingerprint: change.fingerprint,
    sourceClaimIds: leaseEvidence.some(
      (candidate) => candidate.id === change.id,
    )
      ? ["source:author", "source:code"]
      : ["source:feedback", "source:ci"],
  }));
  const chapterKind = variant === "delta"
    ? "delta" as const
    : "narrative" as const;
  const firstSystem = {
    id: "system:lease",
    title: "Make leasing honest",
    thesis:
      "A missing clone becomes a visible precondition failure before work begins.",
    order: 0,
    risk: "high" as const,
    confidence: 91,
    sourceClaimIds: ["source:author", "source:code"],
    scope: {
      changedLines: leaseEvidence.length,
      files: 1,
    },
    chapters: [
      {
        id: "chapter:probe",
        title: variant === "delta"
          ? "What changed since your review"
          : "Probe before leasing",
        purpose:
          "Move filesystem reachability into the lease boundary.",
        before:
          "A stale localClonePath survived until validation.",
        after:
          "The worktree lease fails at the first unsafe boundary.",
        order: 0,
        risk: "high" as const,
        confidence: 93,
        sourceClaimIds: ["source:author", "source:code"],
        dependencyChapterIds: [],
        kind: chapterKind,
        beats: [
          {
            id: "beat:probe",
            title: "Reject the stale root",
            claim:
              "The clone path is probed before the worktree is leased.",
            objective:
              "Verify that every missing-root path stops before mutation.",
            question:
              "Can a moved clone still pass through a cached lease?",
            order: 0,
            risk: "high" as const,
            confidence: 94,
            evidenceIds: leaseEvidence.map((change) => change.id),
            sourceClaimIds: ["source:author", "source:code"],
          },
        ],
      },
    ],
  };
  const secondSystem = {
    id: "system:rescue",
    title: "Preserve rejected work",
    thesis:
      "A failed validation keeps the commit reachable without pushing it.",
    order: 1,
    risk: "medium" as const,
    confidence: 84,
    sourceClaimIds: ["source:feedback", "source:ci"],
    scope: {
      changedLines: rescueEvidence.length,
      files: 1,
    },
    chapters: [
      {
        id: "chapter:rescue",
        title: "Route rejection to a rescue branch",
        purpose:
          "Keep failed agent work inspectable after the push gate rejects it.",
        before:
          "A rejected commit was difficult to recover.",
        after:
          "The run points to a local pr-copilot/rejected branch.",
        order: 1,
        risk: "medium" as const,
        confidence: 85,
        sourceClaimIds: ["source:feedback", "source:ci"],
        dependencyChapterIds: ["chapter:probe"],
        kind: "narrative" as const,
        beats: [
          {
            id: "beat:rescue",
            title: "Keep the failed commit",
            claim:
              "Validation failure creates a deterministic rescue ref.",
            objective:
              "Inspect the branch naming and prove no remote push occurs.",
            question: null,
            order: 0,
            risk: "medium" as const,
            confidence: 86,
            evidenceIds: rescueEvidence.map((change) => change.id),
            sourceClaimIds: ["source:feedback", "source:ci"],
          },
        ],
      },
    ],
  };
  const systems = variant === "complex"
    ? [firstSystem, secondSystem]
    : [{
        ...firstSystem,
        scope: {
          changedLines: changes.length,
          files: 2,
        },
        chapters: [
          firstSystem.chapters[0],
          secondSystem.chapters[0],
        ],
      }];
  const generationFailure = {
    id: "failure:tests",
    stageId: "stage:tests",
    scope: "chapter" as const,
    systemId: systems[0].id,
    chapterId: systems[0].chapters.at(-1)!.id,
    message:
      "Relevant unchanged test callers could not be indexed.",
    retryable: true,
    evidenceIds: rescueEvidence.slice(0, 1).map(
      (change) => change.id,
    ),
  };
  const analysis = {
    version: 1,
    thesis:
      "Reject unsafe worktree roots early, then preserve any work the validation gate refuses.",
    sourceClaimIds: [
      "source:author",
      "source:code",
      "source:feedback",
      "source:ci",
    ],
    systems,
    evidence,
    coverage: changes.map((change) => ({
      evidenceId: change.id,
      assignment: {
        kind: "beat" as const,
        beatId: leaseEvidence.some(
          (candidate) => candidate.id === change.id,
        )
          ? "beat:probe"
          : "beat:rescue",
      },
    })),
    mechanicalChanges: [],
    sourceClaims,
    concerns: [
      {
        id: "concern:cache",
        beatId: "beat:probe",
        question:
          "Does a poll-window cache retain a clone path after it moves?",
        evidenceIds: leaseEvidence.slice(0, 2).map(
          (change) => change.id,
        ),
        sourceClaimIds: ["source:code"],
        severity: "major" as const,
      },
    ],
    generation: {
      status: variant === "partial"
        ? "partial" as const
        : variant === "progressive"
          ? "running" as const
          : "complete" as const,
      stages: [
        {
          id: "stage:index",
          label: "Indexed trusted diff evidence",
          status: "complete" as const,
          systemId: null,
          error: null,
        },
        {
          id: "stage:story",
          label: "Built causal chapters",
          status: "complete" as const,
          systemId: null,
          error: null,
        },
        {
          id: "stage:tests",
          label: "Traced relevant tests",
          status: variant === "partial"
            ? "failed" as const
            : variant === "progressive"
              ? "running" as const
            : "complete" as const,
          systemId: systems[0].id,
          error: variant === "partial"
            ? "Checkout evidence unavailable"
            : null,
        },
      ],
      failures: variant === "partial"
        ? [generationFailure]
        : [],
    },
  };
  return parseUltraReviewAnalysisJson(
    JSON.stringify(analysis),
    identityFor(pr),
  );
}

export function ultraReviewPreviewArtifact(
  pr: PrSummary,
  variant: UltraReviewPreviewVariant,
): UltraReviewArtifact {
  if (variant === "loading" || variant === "invalid") {
    const artifact = createUltraReviewArtifact(
      identityFor(pr),
    );
    artifact.generation.stages = [
      {
        id: "indexing-files",
        label: "Indexing 7 changed files",
        status: "complete",
        systemId: null,
        error: null,
      },
      {
        id: "building-story",
        label: "Building causal chapters",
        status: "running",
        systemId: null,
        error: null,
      },
      {
        id: "checking-coverage",
        label: "Checking changed-line coverage",
        status: "pending",
        systemId: null,
        error: null,
      },
    ];
    return artifact;
  }
  const artifact = analyzedArtifact(pr, variant);
  if (variant === "resumed" || variant === "author") {
    const mode: UltraReviewMode =
      variant === "author" ? "author" : "teammate";
    artifact.sessions[mode].beatStates["beat:probe"] =
      "reviewed";
    artifact.sessions[mode].resume = {
      systemId: "system:lease",
      chapterId: "chapter:probe",
      beatId: "beat:rescue",
      scrollTop: 420,
      expandedEvidenceIds: [],
    };
    artifact.sessions[mode].notes = [
      {
        id: "note:cache",
        body:
          "The cache key needs the resolved clone identity, not only the configured path.",
        anchor: {
          kind: "beat",
          beatId: "beat:probe",
        },
        createdAt: Date.now() - 90_000,
        stale: false,
      },
    ];
  }
  return artifact;
}
