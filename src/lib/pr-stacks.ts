import type { PrStackEntry, PrStackIndex, PrSummary } from "../types";
import { sortPrs, type SortKey } from "./ui";

export interface PrStackListItem {
  pr: PrSummary;
  stack: PrStackEntry;
  depth: number;
  parentVisible: boolean;
  hasVisibleChildren: boolean;
}

export type PrStackRenderItem = PrStackListItem;

export const EMPTY_PR_STACK_INDEX: PrStackIndex = {
  byNumber: {},
  rootPrNumbers: [],
  branchToPrNumber: {},
  maxDepth: 0,
};

const emptyEntry = (pr: PrSummary): PrStackEntry => ({
  prNumber: pr.number,
  headRef: pr.headRef,
  baseRef: pr.baseRef,
  parentPrNumber: null,
  childPrNumbers: [],
  depth: 0,
  rootPrNumber: pr.number,
  stackPrNumbers: [pr.number],
  targetsMain: pr.baseRef === "main",
});

export function buildPrStackIndex(prs: PrSummary[]): PrStackIndex {
  if (prs.length === 0) return EMPTY_PR_STACK_INDEX;

  const byNumber: Record<number, PrStackEntry> = {};
  const branchToPrNumberMap = new Map<string, number>();
  const duplicateBranches = new Set<string>();

  for (const pr of prs) {
    byNumber[pr.number] = emptyEntry(pr);
    if (!pr.headRef) continue;
    if (branchToPrNumberMap.has(pr.headRef)) {
      duplicateBranches.add(pr.headRef);
    } else {
      branchToPrNumberMap.set(pr.headRef, pr.number);
    }
  }

  for (const branch of duplicateBranches) branchToPrNumberMap.delete(branch);

  for (const pr of prs) {
    const parent = branchToPrNumberMap.get(pr.baseRef);
    if (parent === undefined || parent === pr.number) continue;
    byNumber[pr.number].parentPrNumber = parent;
    byNumber[parent].childPrNumbers.push(pr.number);
  }

  const visiting = new Set<number>();
  const resolved = new Set<number>();

  const resolve = (number: number): PrStackEntry => {
    const entry = byNumber[number];
    if (!entry) throw new Error(`Unknown PR in stack: ${number}`);
    if (resolved.has(number)) return entry;
    if (visiting.has(number)) {
      entry.parentPrNumber = null;
      entry.depth = 0;
      entry.rootPrNumber = number;
      entry.stackPrNumbers = [number];
      resolved.add(number);
      return entry;
    }

    visiting.add(number);
    const parent = entry.parentPrNumber ? byNumber[entry.parentPrNumber] : null;
    if (!parent) {
      entry.depth = 0;
      entry.rootPrNumber = number;
      entry.stackPrNumbers = [number];
    } else {
      const parentEntry = resolve(parent.prNumber);
      entry.depth = parentEntry.depth + 1;
      entry.rootPrNumber = parentEntry.rootPrNumber;
      entry.stackPrNumbers = [...parentEntry.stackPrNumbers, number];
    }
    visiting.delete(number);
    resolved.add(number);
    return entry;
  };

  for (const pr of prs) resolve(pr.number);

  return {
    byNumber,
    rootPrNumbers: prs
      .filter((pr) => byNumber[pr.number].parentPrNumber === null)
      .map((pr) => pr.number),
    branchToPrNumber: Object.fromEntries(branchToPrNumberMap),
    maxDepth: Math.max(0, ...Object.values(byNumber).map((entry) => entry.depth)),
  };
}

export function flattenPrStack(
  orderedPrs: PrSummary[],
  stackIndex: PrStackIndex
): PrStackListItem[] {
  const visibleByNumber = new Map(orderedPrs.map((pr) => [pr.number, pr]));
  const rank = new Map(orderedPrs.map((pr, index) => [pr.number, index]));
  const visited = new Set<number>();
  const out: PrStackListItem[] = [];

  const visibleChildren = (number: number) =>
    (stackIndex.byNumber[number]?.childPrNumbers ?? [])
      .filter((child) => visibleByNumber.has(child))
      .sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));

  const emit = (pr: PrSummary, depth: number, parentVisible: boolean) => {
    if (visited.has(pr.number)) return;
    visited.add(pr.number);
    const stack = stackIndex.byNumber[pr.number] ?? emptyEntry(pr);
    const children = visibleChildren(pr.number);
    out.push({
      pr,
      stack,
      depth,
      parentVisible,
      hasVisibleChildren: children.length > 0,
    });
    for (const childNumber of children) {
      const child = visibleByNumber.get(childNumber);
      if (child) emit(child, depth + 1, true);
    }
  };

  for (const pr of orderedPrs) {
    const stack = stackIndex.byNumber[pr.number];
    const parentVisible = stack?.parentPrNumber ? visibleByNumber.has(stack.parentPrNumber) : false;
    if (!parentVisible) emit(pr, 0, false);
  }

  for (const pr of orderedPrs) emit(pr, 0, false);
  return out;
}

export function stackedPrList(
  prs: PrSummary[],
  stackIndex: PrStackIndex,
  sort: SortKey
): PrStackRenderItem[] {
  return flattenPrStack(sortPrs(prs, sort), stackIndex);
}
