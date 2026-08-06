import type { PrSummary } from "../types";

export function prVersionKey(
  pr: Pick<PrSummary, "number" | "headSha">
): string {
  return `${pr.number}:${pr.headSha}`;
}

export function currentPrVersionValue<Value>(
  versioned: {
    key: string;
    value: Value;
  } | null,
  pr: Pick<PrSummary, "number" | "headSha"> | null
): Value | null {
  if (!versioned || !pr) return null;
  return versioned.key === prVersionKey(pr)
    ? versioned.value
    : null;
}
