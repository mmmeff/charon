import type {
  UltraReviewDiagnosticEntry,
  UltraReviewDiagnosticFailureCategory,
} from "../types";

export const ULTRA_REVIEW_DIAGNOSTICS_VERSION = 1 as const;
export const ULTRA_REVIEW_DIAGNOSTICS_ENTRY_LIMIT = 500;

interface UltraReviewDiagnostics {
  version: typeof ULTRA_REVIEW_DIAGNOSTICS_VERSION;
  entries: UltraReviewDiagnosticEntry[];
}

interface ParsedUltraReviewDiagnostics {
  diagnostics: UltraReviewDiagnostics;
  rejectedEntryCount: number;
}

interface AppendUltraReviewDiagnosticOptions {
  entryLimit?: number;
}

const ENTRY_FIELDS = new Set([
  "stageId",
  "elapsedMs",
  "retryCount",
  "outcome",
  "failureCategory",
]);

const ROOT_FIELDS = new Set(["version", "entries"]);

const FAILURE_CATEGORIES =
  new Set<UltraReviewDiagnosticFailureCategory>([
    "cancelled",
    "context",
    "generation",
    "harness",
    "parse",
    "persistence",
    "submission",
    "unknown",
  ]);

const STAGE_ID_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,79}$/;

function recordValue(
  value: unknown,
  description: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyFields(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
  description: string,
): void {
  for (const field of Object.keys(value)) {
    if (!fields.has(field)) {
      throw new Error(`${description} has unsupported field ${field}`);
    }
  }
}

function safeCount(value: unknown, field: string): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function parseEntry(value: unknown): UltraReviewDiagnosticEntry {
  const entry = recordValue(value, "diagnostic entry");
  assertOnlyFields(entry, ENTRY_FIELDS, "diagnostic entry");

  if (
    typeof entry.stageId !== "string"
    || !STAGE_ID_PATTERN.test(entry.stageId)
  ) {
    throw new Error("stageId must be a bounded machine identifier");
  }

  if (entry.outcome !== "success" && entry.outcome !== "failure") {
    throw new Error("outcome must be success or failure");
  }

  const failureCategory = entry.failureCategory;
  if (entry.outcome === "success" && failureCategory !== null) {
    throw new Error("successful stage cannot have a failure category");
  }
  if (
    entry.outcome === "failure"
    && (
      typeof failureCategory !== "string"
      || !FAILURE_CATEGORIES.has(
        failureCategory as UltraReviewDiagnosticFailureCategory,
      )
    )
  ) {
    throw new Error("failed stage requires a failure category");
  }

  return {
    stageId: entry.stageId,
    elapsedMs: safeCount(entry.elapsedMs, "elapsedMs"),
    retryCount: safeCount(entry.retryCount, "retryCount"),
    outcome: entry.outcome,
    failureCategory:
      failureCategory as UltraReviewDiagnosticFailureCategory | null,
  };
}

function parseEntryLimit(value: unknown): number {
  const entryLimit = safeCount(value, "entryLimit");
  if (
    entryLimit === 0
    || entryLimit > ULTRA_REVIEW_DIAGNOSTICS_ENTRY_LIMIT
  ) {
    throw new Error(
      `entryLimit must be between 1 and ${ULTRA_REVIEW_DIAGNOSTICS_ENTRY_LIMIT}`,
    );
  }
  return entryLimit;
}

function validatedDiagnostics(
  value: unknown,
): UltraReviewDiagnostics {
  const diagnostics = recordValue(value, "diagnostics root");
  assertOnlyFields(diagnostics, ROOT_FIELDS, "diagnostics root");
  if (diagnostics.version !== ULTRA_REVIEW_DIAGNOSTICS_VERSION) {
    throw new Error(
      `unsupported diagnostics version ${String(diagnostics.version)}`,
    );
  }
  if (!Array.isArray(diagnostics.entries)) {
    throw new Error("diagnostics entries must be an array");
  }

  return {
    version: ULTRA_REVIEW_DIAGNOSTICS_VERSION,
    entries: diagnostics.entries.map(parseEntry),
  };
}

export function createUltraReviewDiagnostics(): UltraReviewDiagnostics {
  return {
    version: ULTRA_REVIEW_DIAGNOSTICS_VERSION,
    entries: [],
  };
}

export function parseUltraReviewDiagnostics(
  raw: string,
): ParsedUltraReviewDiagnostics {
  const value: unknown = JSON.parse(raw);
  const root = recordValue(value, "diagnostics root");
  if (root.version !== ULTRA_REVIEW_DIAGNOSTICS_VERSION) {
    throw new Error(
      `unsupported diagnostics version ${String(root.version)}`,
    );
  }
  if (!Array.isArray(root.entries)) {
    throw new Error("diagnostics entries must be an array");
  }

  const entries: UltraReviewDiagnosticEntry[] = [];
  let rejectedEntryCount = 0;
  for (const entry of root.entries) {
    try {
      entries.push(parseEntry(entry));
    } catch {
      rejectedEntryCount += 1;
    }
  }

  return {
    diagnostics: {
      version: ULTRA_REVIEW_DIAGNOSTICS_VERSION,
      entries,
    },
    rejectedEntryCount,
  };
}

export function serializeUltraReviewDiagnostics(
  diagnostics: UltraReviewDiagnostics,
): string {
  return JSON.stringify(validatedDiagnostics(diagnostics), null, 2);
}

export function appendUltraReviewDiagnostic(
  diagnostics: UltraReviewDiagnostics,
  entry: UltraReviewDiagnosticEntry,
  options: AppendUltraReviewDiagnosticOptions = {},
): UltraReviewDiagnostics {
  const current = validatedDiagnostics(diagnostics);
  const next = parseEntry(entry);
  const entryLimit = parseEntryLimit(
    options.entryLimit ?? ULTRA_REVIEW_DIAGNOSTICS_ENTRY_LIMIT,
  );

  return {
    version: ULTRA_REVIEW_DIAGNOSTICS_VERSION,
    entries: [...current.entries, next].slice(-entryLimit),
  };
}
