import type { PrReviewFilter, PrReviewFilters, PrReviewStatusFilter, PrSummary, ReviewInfo } from "../types";

export const REVIEW_STATUS_VALUES: { value: PrReviewStatusFilter; label: string }[] = [
  { value: "none", label: "Not reviewed" },
  { value: "required", label: "Review required" },
  { value: "approved", label: "Approved review" },
  { value: "changes_requested", label: "Changes requested" },
];

export const REVIEW_FILTER_QUALIFIERS: {
  value: PrReviewFilter["qualifier"];
  label: string;
  placeholder: string;
}[] = [
  { value: "review", label: "Review status", placeholder: "approved" },
  { value: "reviewed-by", label: "Reviewed by", placeholder: "@me or login" },
  { value: "review-requested", label: "Review requested", placeholder: "@me or login" },
  { value: "user-review-requested", label: "User review requested", placeholder: "@me or login" },
  { value: "team-review-requested", label: "Team review requested", placeholder: "org/team or team" },
];

export function makeReviewFilter(
  qualifier: PrReviewFilter["qualifier"] = "review-requested",
  value = "@me"
): PrReviewFilter {
  return {
    id: `${qualifier}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    qualifier,
    value,
  };
}

export function reviewFiltersToQuery(filters: PrReviewFilters): string {
  return reviewFilterRows(filters).map((f) => `${f.qualifier}:${quoteFilterValue(f.value)}`).join(" ");
}

export function reviewFilterRows(filters: PrReviewFilters | undefined): PrReviewFilter[] {
  return Array.isArray(filters?.filters) ? filters.filters : [];
}

function quoteFilterValue(value: string): string {
  const v = value.trim();
  return /\s/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

function normalizeUser(value: string, login: string): string {
  const v = value.trim();
  if (v === "@me") return login;
  return v.replace(/^@/, "");
}

function normalizeTeam(value: string, repo: string): string {
  const v = value.trim().replace(/^@/, "");
  const [owner] = repo.split("/");
  const slash = v.includes("/") ? v : `${owner}/${v}`;
  return slash.toLowerCase();
}

/** Whether the user has an OUTSTANDING request (direct or via a team). Used for
 *  the `review_requested` event — intentionally NOT including already-submitted
 *  reviews, so the event doesn't re-fire for PRs the user already reviewed. */
export function isReviewRequestedFromUser(
  pr: Pick<PrSummary, "requestedReviewers" | "requestedTeams">,
  login: string,
  myTeamSlugs: Set<string>
): boolean {
  if (pr.requestedReviewers.some((u) => u.toLowerCase() === login.toLowerCase())) return true;
  return pr.requestedTeams.some((team) => myTeamSlugs.has(team.toLowerCase()));
}

/** Whether `login` is a reviewer on the PR at all — requested (direct or team)
 *  OR has already submitted a review. GitHub drops a user from requested
 *  reviewers the moment they review, so the review-queue filter keys on this to
 *  keep showing PRs the user is responsible for regardless of review status. */
export function isReviewerOf(
  pr: Pick<PrSummary, "requestedReviewers" | "requestedTeams" | "reviewers">,
  login: string,
  myTeamSlugs: Set<string>
): boolean {
  if (isReviewRequestedFromUser(pr, login, myTeamSlugs)) return true;
  return (pr.reviewers ?? []).some((u) => u.toLowerCase() === login.toLowerCase());
}

export function reviewFilterNeedsReviews(filters: PrReviewFilters): boolean {
  return reviewFilterRows(filters).some((f) => f.qualifier === "review" || f.qualifier === "reviewed-by");
}

/** Filters that need the batched GraphQL review meta (decision + submitted-review
 *  authors). The review-requested family needs it so already-reviewed PRs stay
 *  in the queue; the status family needs the review decision. */
export function reviewFilterNeedsReviewMeta(filters: PrReviewFilters): boolean {
  return reviewFilterRows(filters).some(
    (f) =>
      f.qualifier === "review" ||
      f.qualifier === "reviewed-by" ||
      f.qualifier === "review-requested" ||
      f.qualifier === "user-review-requested"
  );
}

export function matchesPrReviewFilters(
  pr: PrSummary,
  filters: PrReviewFilters,
  ctx: {
    login: string;
    repo: string;
    myTeamSlugs: Set<string>;
    reviews?: ReviewInfo[];
  }
): boolean {
  return reviewFilterRows(filters).every((filter) => matchesOne(pr, filter, ctx));
}

function matchesOne(
  pr: PrSummary,
  filter: PrReviewFilter,
  ctx: {
    login: string;
    repo: string;
    myTeamSlugs: Set<string>;
    reviews?: ReviewInfo[];
  }
): boolean {
  const reviews = (ctx.reviews ?? []).filter((r) => r.state !== "DISMISSED");
  switch (filter.qualifier) {
    case "review":
      return matchesReviewStatus(pr, reviews, filter.value as PrReviewStatusFilter);
    case "reviewed-by": {
      const user = normalizeUser(filter.value, ctx.login).toLowerCase();
      return reviews.some((r) => r.author.toLowerCase() === user);
    }
    case "review-requested": {
      // "is a reviewer regardless of review status": requested (direct/team) or
      // has already submitted a review. The self case also honors team requests.
      const user = normalizeUser(filter.value, ctx.login);
      if (user.toLowerCase() === ctx.login.toLowerCase()) {
        return isReviewerOf(pr, ctx.login, ctx.myTeamSlugs);
      }
      const u = user.toLowerCase();
      return (
        pr.requestedReviewers.some((r) => r.toLowerCase() === u) ||
        (pr.reviewers ?? []).some((r) => r.toLowerCase() === u)
      );
    }
    case "user-review-requested": {
      const user = normalizeUser(filter.value, ctx.login).toLowerCase();
      return (
        pr.requestedReviewers.some((r) => r.toLowerCase() === user) ||
        (pr.reviewers ?? []).some((r) => r.toLowerCase() === user)
      );
    }
    case "team-review-requested": {
      const target = normalizeTeam(filter.value, ctx.repo);
      const [, targetSlug] = target.split("/");
      return pr.requestedTeams.some((slug) => {
        const full = normalizeTeam(slug, ctx.repo);
        return full === target || slug.toLowerCase() === targetSlug;
      });
    }
    default:
      return true;
  }
}

function matchesReviewStatus(pr: PrSummary, reviews: ReviewInfo[], status: PrReviewStatusFilter): boolean {
  const states = new Set(reviews.map((r) => r.state));
  switch (status) {
    case "none":
      return reviews.length === 0;
    case "required":
      return pr.reviewDecision === "REVIEW_REQUIRED";
    case "approved":
      return pr.reviewDecision === "APPROVED" || states.has("APPROVED");
    case "changes_requested":
      return pr.reviewDecision === "CHANGES_REQUESTED" || states.has("CHANGES_REQUESTED");
    default:
      return true;
  }
}
