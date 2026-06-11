import { native } from "./tauri";
import type {
  CheckInfo,
  CommentInfo,
  GlobalConfig,
  PrSummary,
  ProposedInlineComment,
  ReviewInfo,
  TimelineEventInfo,
} from "../types";

export type MergeMethod = "squash" | "merge" | "rebase";

export interface ReviewThreadInfo {
  /** GraphQL node id — needed for resolve/unresolve mutations */
  id: string;
  isResolved: boolean;
  /** REST databaseIds of the thread's comments */
  commentIds: number[];
}

/**
 * Minimal GitHub REST v3 client working against github.com and GitHub
 * Enterprise. All requests go through the native HTTP command (no CORS,
 * supports self-signed GHE certs).
 */
export class GitHubClient {
  readonly apiBase: string;
  readonly webBase: string;
  private token: string;
  private insecure: boolean;
  login = "";

  constructor(cfg: Pick<GlobalConfig, "githubUrl" | "token" | "insecureTls" | "login">) {
    const url = cfg.githubUrl.replace(/\/+$/, "");
    this.webBase = url;
    this.apiBase =
      url === "https://github.com" || url === "https://www.github.com"
        ? "https://api.github.com"
        : `${url}/api/v3`;
    this.token = cfg.token;
    this.insecure = cfg.insecureTls;
    this.login = cfg.login;
  }

  private async raw(
    method: string,
    path: string,
    opts: { body?: unknown; accept?: string } = {}
  ): Promise<{ status: number; body: string; headers: [string, string][] }> {
    const url = path.startsWith("http") ? path : this.apiBase + path;
    const headers: [string, string][] = [
      ["Authorization", `Bearer ${this.token}`],
      ["Accept", opts.accept ?? "application/vnd.github+json"],
      ["X-GitHub-Api-Version", "2022-11-28"],
    ];
    if (opts.body !== undefined) headers.push(["Content-Type", "application/json"]);
    const resp = await native.httpRequest({
      method,
      url,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      insecure: this.insecure,
    });
    if (resp.status >= 400) {
      let msg = resp.body;
      try {
        msg = JSON.parse(resp.body).message ?? resp.body;
      } catch {
        /* keep raw */
      }
      throw new Error(`GitHub ${method} ${path} → ${resp.status}: ${msg}`);
    }
    return resp;
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const resp = await this.raw(method, path, { body });
    return resp.body ? (JSON.parse(resp.body) as T) : (undefined as T);
  }

  /** GET with Link-header pagination. Default cap ~500 items. */
  private async paged<T>(path: string, accept?: string, maxPages = 5): Promise<T[]> {
    const out: T[] = [];
    let url: string | null = path + (path.includes("?") ? "&" : "?") + "per_page=100";
    for (let i = 0; i < maxPages && url; i++) {
      const resp = await this.raw("GET", url, { accept });
      out.push(...(JSON.parse(resp.body) as T[]));
      const link = resp.headers.find(([k]) => k.toLowerCase() === "link")?.[1] ?? "";
      const next = /<([^>]+)>;\s*rel="next"/.exec(link);
      url = next ? next[1] : null;
    }
    return out;
  }

  /** Server-rendered bodies: includes body_html with signed asset URLs and
   *  <video> elements for uploaded attachments — required for media to load
   *  outside a github.com browser session. */
  private static FULL = "application/vnd.github.full+json";

  async connect(): Promise<string> {
    const user = await this.json<{ login: string }>("GET", "/user");
    this.login = user.login;
    return user.login;
  }

  // -- GraphQL (thread resolution is not exposed via REST) -------------------

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const url =
      this.apiBase === "https://api.github.com"
        ? "https://api.github.com/graphql"
        : `${this.webBase}/api/graphql`;
    const resp = await native.httpRequest({
      method: "POST",
      url,
      headers: [
        ["Authorization", `Bearer ${this.token}`],
        ["Content-Type", "application/json"],
      ],
      body: JSON.stringify({ query, variables }),
      insecure: this.insecure,
    });
    if (resp.status >= 400) throw new Error(`GitHub GraphQL → ${resp.status}`);
    const data = JSON.parse(resp.body);
    if (data.errors?.length) throw new Error(data.errors[0].message ?? "GraphQL error");
    return data.data as T;
  }

  /** Review threads with resolution state, mapped to REST comment ids. */
  async listReviewThreads(repo: string, number: number): Promise<ReviewThreadInfo[]> {
    const [owner, name] = repo.split("/");
    const data = await this.graphql<any>(
      `query($owner:String!,$name:String!,$number:Int!){
        repository(owner:$owner,name:$name){
          pullRequest(number:$number){
            reviewThreads(first:100){
              nodes{ id isResolved comments(first:100){ nodes{ databaseId } } }
            }
          }
        }
      }`,
      { owner, name, number }
    );
    const nodes = data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
    return nodes.map((n: any) => ({
      id: n.id,
      isResolved: !!n.isResolved,
      commentIds: (n.comments?.nodes ?? []).map((c: any) => c.databaseId).filter(Boolean),
    }));
  }

  async setThreadResolved(threadId: string, resolved: boolean): Promise<void> {
    const mutation = resolved
      ? `mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ id } } }`
      : `mutation($id:ID!){ unresolveReviewThread(input:{threadId:$id}){ thread{ id } } }`;
    await this.graphql(mutation, { id: threadId });
  }

  async searchRepos(query: string): Promise<string[]> {
    const res = await this.json<{ items: { full_name: string }[] }>(
      "GET",
      `/search/repositories?q=${encodeURIComponent(query)}&per_page=10`
    );
    return res.items.map((r) => r.full_name);
  }

  async repoExists(fullName: string): Promise<boolean> {
    try {
      await this.json("GET", `/repos/${fullName}`);
      return true;
    } catch {
      return false;
    }
  }

  // -- Pull requests --------------------------------------------------------

  private mapPull(p: any, requestedFromMe: boolean): PrSummary {
    return {
      number: p.number,
      title: p.title ?? "",
      body: p.body ?? "",
      bodyHtml: p.body_html || undefined,
      author: p.user?.login ?? "",
      authorIsBot: (p.user?.type ?? "") === "Bot" || /\[bot\]$/.test(p.user?.login ?? ""),
      draft: !!p.draft,
      state: p.state,
      merged: !!p.merged_at,
      headRef: p.head?.ref ?? "",
      headSha: p.head?.sha ?? "",
      headRepoFullName: p.head?.repo?.full_name ?? "",
      baseRef: p.base?.ref ?? "",
      baseSha: p.base?.sha ?? "",
      labels: (p.labels ?? []).map((l: any) => l.name),
      url: p.html_url ?? "",
      mergeableState: p.mergeable_state ?? "unknown",
      autoMerge: p.auto_merge != null,
      requestedReviewers: (p.requested_reviewers ?? []).map((u: any) => String(u.login)),
      requestedTeams: (p.requested_teams ?? []).map((t: any) => String(t.slug)),
      requestedFromMe,
      updatedAt: p.updated_at ?? "",
      additions: p.additions ?? 0,
      deletions: p.deletions ?? 0,
      changedFiles: p.changed_files ?? 0,
    };
  }

  /** All open PRs in the repo (list endpoint — no mergeable_state). */
  async listOpenPulls(repo: string): Promise<PrSummary[]> {
    const pulls = await this.paged<any>(`/repos/${repo}/pulls?state=open&sort=updated&direction=desc`);
    return pulls.map((p) => this.mapPull(p, this.isRequestedFromMe(p)));
  }

  private isRequestedFromMe(p: any): boolean {
    const direct = (p.requested_reviewers ?? []).some((u: any) => u.login === this.login);
    return direct; // team requests resolved via search query below
  }

  /**
   * PR numbers where my review is requested — `review-requested:` in the
   * search API includes requests via teams I'm on, which is exactly the
   * "directly or via team, treated identically" semantic we want.
   */
  async reviewRequestedNumbers(repo: string): Promise<Set<number>> {
    const res = await this.json<{ items: { number: number }[] }>(
      "GET",
      `/search/issues?q=${encodeURIComponent(
        `is:pr is:open repo:${repo} review-requested:${this.login}`
      )}&per_page=100`
    );
    return new Set(res.items.map((i) => i.number));
  }

  /** Open PRs the user has already reviewed (beyond outstanding requests). */
  async reviewedByMeNumbers(repo: string): Promise<Set<number>> {
    const res = await this.json<{ items: { number: number }[] }>(
      "GET",
      `/search/issues?q=${encodeURIComponent(
        `is:pr is:open repo:${repo} reviewed-by:${this.login} -author:${this.login}`
      )}&per_page=100`
    );
    return new Set(res.items.map((i) => i.number));
  }

  /** Detail fetch — includes mergeable_state (GitHub computes it lazily). */
  async getPull(repo: string, number: number): Promise<PrSummary> {
    const resp = await this.raw("GET", `/repos/${repo}/pulls/${number}`, {
      accept: GitHubClient.FULL,
    });
    const p = JSON.parse(resp.body);
    return this.mapPull(p, this.isRequestedFromMe(p));
  }

  async getPullDiff(repo: string, number: number): Promise<string> {
    const resp = await this.raw("GET", `/repos/${repo}/pulls/${number}`, {
      accept: "application/vnd.github.v3.diff",
    });
    return resp.body;
  }

  // -- Checks ----------------------------------------------------------------

  async listChecks(repo: string, ref: string): Promise<CheckInfo[]> {
    const out: CheckInfo[] = [];
    try {
      const res = await this.json<{ check_runs: any[] }>(
        "GET",
        `/repos/${repo}/commits/${ref}/check-runs?per_page=100`
      );
      for (const c of res.check_runs ?? []) {
        out.push({
          name: c.name,
          status: c.status,
          conclusion: c.conclusion,
          url: c.html_url ?? "",
          id: c.id,
          startedAt: c.started_at ?? undefined,
          completedAt: c.completed_at ?? undefined,
          outputTitle: c.output?.title ?? undefined,
          outputSummary: c.output?.summary ?? undefined,
        });
      }
    } catch {
      /* checks API may be disabled on older GHE */
    }
    try {
      const res = await this.json<{ statuses: any[] }>(
        "GET",
        `/repos/${repo}/commits/${ref}/status`
      );
      for (const s of res.statuses ?? []) {
        if (out.some((c) => c.name === s.context)) continue;
        out.push({
          name: s.context,
          status: s.state === "pending" ? "in_progress" : "completed",
          conclusion: s.state === "pending" ? null : s.state, // success | failure | error
          url: s.target_url ?? "",
        });
      }
    } catch {
      /* commit statuses are optional too */
    }
    // GitHub's checks UI lists alphabetically (case-insensitive); match it
    return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  /**
   * Best-effort full log for a check. GitHub Actions jobs expose raw logs
   * (job id parsed from the check's html_url); other CI providers fall back
   * to the check-run output summary plus annotations.
   */
  /** Is this check a GitHub Actions job we can re-run via the API? */
  static actionsJobRef(checkUrl: string): { runId: string; jobId: string } | null {
    const m = /\/actions\/runs\/(\d+)\/job\/(\d+)/.exec(checkUrl ?? "");
    return m ? { runId: m[1], jobId: m[2] } : null;
  }

  /**
   * Re-run a failed Actions job. Tries the single-job rerun first; grouped /
   * matrix / reusable-workflow jobs that GitHub refuses to re-run alone fall
   * back to "re-run failed jobs" on the whole run.
   */
  async rerunCheck(repo: string, checkUrl: string): Promise<void> {
    const ref = GitHubClient.actionsJobRef(checkUrl);
    if (!ref) throw new Error("not a re-runnable GitHub Actions job");
    try {
      await this.json("POST", `/repos/${repo}/actions/jobs/${ref.jobId}/rerun`, {});
    } catch {
      await this.json("POST", `/repos/${repo}/actions/runs/${ref.runId}/rerun-failed-jobs`, {});
    }
  }

  async getCheckLog(
    repo: string,
    check: { name: string; url: string; id?: number; outputTitle?: string; outputSummary?: string }
  ): Promise<string> {
    // GitHub Actions: html_url is …/actions/runs/<run>/job/<job-id>
    const m = /\/actions\/runs\/\d+\/job\/(\d+)/.exec(check.url ?? "");
    if (m) {
      try {
        const resp = await this.raw("GET", `/repos/${repo}/actions/jobs/${m[1]}/logs`);
        if (resp.body.trim()) return resp.body;
      } catch {
        /* fall through to output/annotations */
      }
    }
    const parts = [check.outputTitle, check.outputSummary].filter(Boolean) as string[];
    if (check.id) {
      try {
        const anns = await this.json<any[]>(
          "GET",
          `/repos/${repo}/check-runs/${check.id}/annotations?per_page=50`
        );
        if (anns.length) {
          parts.push(
            anns.map((a) => `${a.path}:${a.start_line} [${a.annotation_level}] ${a.message}`).join("\n")
          );
        }
      } catch {
        /* annotations are optional */
      }
    }
    return parts.join("\n\n");
  }

  // -- Comments & reviews ----------------------------------------------------

  private mapComment(c: any, kind: "issue" | "review_comment"): CommentInfo {
    return {
      id: c.id,
      kind,
      author: c.user?.login ?? "",
      authorIsBot: (c.user?.type ?? "") === "Bot" || /\[bot\]$/.test(c.user?.login ?? ""),
      body: c.body ?? "",
      bodyHtml: c.body_html || undefined,
      createdAt: c.created_at ?? "",
      url: c.html_url ?? "",
      path: c.path,
      line: c.line ?? c.original_line ?? undefined,
      side: c.side === "LEFT" ? "LEFT" : c.side === "RIGHT" ? "RIGHT" : undefined,
      inReplyTo: c.in_reply_to_id ?? undefined,
    };
  }

  async listComments(repo: string, number: number): Promise<CommentInfo[]> {
    const [issue, review] = await Promise.all([
      this.paged<any>(`/repos/${repo}/issues/${number}/comments`, GitHubClient.FULL),
      this.paged<any>(`/repos/${repo}/pulls/${number}/comments`, GitHubClient.FULL),
    ]);
    return [
      ...issue.map((c) => this.mapComment(c, "issue" as const)),
      ...review.map((c) => this.mapComment(c, "review_comment" as const)),
    ];
  }

  async listReviews(repo: string, number: number): Promise<ReviewInfo[]> {
    const reviews = await this.paged<any>(`/repos/${repo}/pulls/${number}/reviews`, GitHubClient.FULL);
    return reviews.map((r) => ({
      id: r.id,
      author: r.user?.login ?? "",
      authorIsBot: (r.user?.type ?? "") === "Bot" || /\[bot\]$/.test(r.user?.login ?? ""),
      state: r.state ?? "",
      body: r.body ?? "",
      bodyHtml: r.body_html || undefined,
      submittedAt: r.submitted_at ?? "",
    }));
  }

  /**
   * Non-comment PR timeline: pushes, merge/close, force-pushes, labels,
   * review requests… Comment/review entries are skipped (rendered from their
   * own streams). Curated mapping; unknown event types are ignored, so this
   * degrades gracefully across GitHub versions.
   */
  async listTimeline(repo: string, number: number): Promise<TimelineEventInfo[]> {
    let items: any[] = [];
    try {
      items = await this.paged<any>(`/repos/${repo}/issues/${number}/timeline`);
    } catch {
      return []; // timeline API unavailable (older GHE)
    }
    const out: TimelineEventInfo[] = [];
    const firstLine = (s: string) => (s ?? "").split("\n").find((x) => x.trim()) ?? "";
    for (const e of items) {
      const actor = e.actor?.login ?? e.author?.name ?? "";
      const at =
        Date.parse(e.created_at ?? e.committer?.date ?? e.author?.date ?? "") || 0;
      const push = (
        verb: string,
        color: TimelineEventInfo["color"],
        text: string,
        sub?: string,
        url?: string
      ) =>
        out.push({
          id: `${e.event}-${e.id ?? e.sha ?? at}-${out.length}`,
          at,
          actor,
          verb,
          text,
          sub,
          color,
          url,
        });
      const reviewee = e.requested_reviewer?.login ?? e.requested_team?.name ?? "someone";
      switch (e.event) {
        case "committed":
          push("pushed", "blue", `pushed ${(e.sha ?? "").slice(0, 7)}`, firstLine(e.message), e.html_url);
          break;
        case "merged":
          push("merged", "purple", `merged this PR${e.commit_id ? ` as ${e.commit_id.slice(0, 7)}` : ""}`);
          break;
        case "closed":
          push("closed", "red", "closed this PR");
          break;
        case "reopened":
          push("reopened", "green", "reopened this PR");
          break;
        case "head_ref_force_pushed":
          push("force-push", "yellow", "force-pushed the branch");
          break;
        case "head_ref_deleted":
          push("branch", "gray", "deleted the head branch");
          break;
        case "head_ref_restored":
          push("branch", "gray", "restored the head branch");
          break;
        case "review_requested":
          push("review req", "purple", `requested a review from ${reviewee}`);
          break;
        case "review_request_removed":
          push("review req", "gray", `removed the review request for ${reviewee}`);
          break;
        case "labeled":
          push("label", "gray", `added the “${e.label?.name}” label`);
          break;
        case "unlabeled":
          push("label", "gray", `removed the “${e.label?.name}” label`);
          break;
        case "ready_for_review":
          push("ready", "green", "marked this PR ready for review");
          break;
        case "convert_to_draft":
          push("draft", "gray", "converted this PR to a draft");
          break;
        case "renamed":
          push("renamed", "gray", `renamed this PR to “${e.rename?.to}”`);
          break;
        case "base_ref_changed":
          push("base", "yellow", "changed the base branch");
          break;
        case "assigned":
          push("assigned", "gray", `assigned ${e.assignee?.login ?? "someone"}`);
          break;
        case "unassigned":
          push("assigned", "gray", `unassigned ${e.assignee?.login ?? "someone"}`);
          break;
        default:
          break; // comments/reviews come from their own streams
      }
    }
    return out;
  }

  // -- Writes (only ever called from approved proposals or explicit user action)

  async createIssueComment(repo: string, number: number, body: string): Promise<string> {
    const res = await this.json<any>("POST", `/repos/${repo}/issues/${number}/comments`, { body });
    return res.html_url ?? "";
  }

  /** A standalone inline comment on specific diff lines (user-authored). */
  async createReviewComment(
    repo: string,
    number: number,
    commitSha: string,
    path: string,
    line: number,
    side: "LEFT" | "RIGHT",
    startLine: number | undefined,
    body: string
  ): Promise<string> {
    const res = await this.json<any>("POST", `/repos/${repo}/pulls/${number}/comments`, {
      body,
      commit_id: commitSha,
      path,
      line,
      side,
      ...(startLine && startLine !== line ? { start_line: startLine, start_side: side } : {}),
    });
    return res.html_url ?? "";
  }

  async replyToReviewComment(
    repo: string,
    number: number,
    commentId: number,
    body: string
  ): Promise<string> {
    const res = await this.json<any>(
      "POST",
      `/repos/${repo}/pulls/${number}/comments/${commentId}/replies`,
      { body }
    );
    return res.html_url ?? "";
  }

  /** Edit the description of the user's own PR (direct user-authored write). */
  async updatePullBody(repo: string, number: number, body: string): Promise<void> {
    await this.json("PATCH", `/repos/${repo}/pulls/${number}`, { body });
  }

  /** Rename the user's own PR (direct user-authored write). */
  async updatePullTitle(repo: string, number: number, title: string): Promise<void> {
    await this.json("PATCH", `/repos/${repo}/pulls/${number}`, { title });
  }

  /** Recent PR titles — convention examples for the AI title drafter. */
  async listRecentPullTitles(repo: string, limit = 30): Promise<string[]> {
    const res = await this.json<any[]>(
      "GET",
      `/repos/${repo}/pulls?state=all&sort=created&direction=desc&per_page=${limit}`
    );
    return res.map((p) => String(p.title));
  }

  /** First page of repo collaborators — initial reviewer suggestions. */
  async listCollaborators(repo: string): Promise<string[]> {
    const res = await this.json<any[]>("GET", `/repos/${repo}/collaborators?per_page=100`);
    return res.map((u) => String(u.login));
  }

  /**
   * Reviewer autocomplete: server-side filtered search over the repo's FULL
   * collaborator set via GraphQL. (The REST /search/users API only sees
   * public org membership, so it misses most teammates.)
   */
  async searchCollaborators(repo: string, q: string): Promise<string[]> {
    const [owner, name] = repo.split("/");
    const data = await this.graphql<any>(
      `query($owner:String!,$name:String!,$q:String!){
        repository(owner:$owner,name:$name){
          collaborators(query:$q,first:15){ nodes{ login } }
        }
      }`,
      { owner, name, q }
    );
    return (data.repository?.collaborators?.nodes ?? []).map((n: any) => String(n.login));
  }

  /** Org teams (team review requests); empty for user-owned repos / no scope. */
  async listOrgTeams(repo: string): Promise<{ slug: string; name: string }[]> {
    const org = repo.split("/")[0];
    try {
      const res = await this.paged<any>(`/orgs/${org}/teams`, undefined, 30);
      return res.map((t) => ({ slug: String(t.slug), name: String(t.name) }));
    } catch {
      return [];
    }
  }

  /** Withdraw review requests (direct user-authored action). */
  async removeReviewRequest(
    repo: string,
    number: number,
    reviewers: string[],
    teamReviewers: string[] = []
  ): Promise<void> {
    await this.json("DELETE", `/repos/${repo}/pulls/${number}/requested_reviewers`, {
      reviewers,
      team_reviewers: teamReviewers,
    });
  }

  /** Request reviews from users and/or teams (direct user-authored action). */
  async requestReviewers(
    repo: string,
    number: number,
    reviewers: string[],
    teamReviewers: string[]
  ): Promise<void> {
    await this.json("POST", `/repos/${repo}/pulls/${number}/requested_reviewers`, {
      reviewers,
      team_reviewers: teamReviewers,
    });
  }

  /** Close the user's own PR without merging (direct user-authored action). */
  async closePull(repo: string, number: number): Promise<void> {
    await this.json("PATCH", `/repos/${repo}/pulls/${number}`, { state: "closed" });
  }

  private repoInfoCache: any | null = null;

  /** Cached GET /repos/{repo} — merge settings + the viewer's permissions. */
  private async repoInfo(repo: string): Promise<any> {
    if (!this.repoInfoCache) this.repoInfoCache = await this.json<any>("GET", `/repos/${repo}`);
    return this.repoInfoCache;
  }

  /** Merge methods this repo allows, preferred order: squash > merge > rebase. */
  async repoMergeMethods(repo: string): Promise<MergeMethod[]> {
    const r = await this.repoInfo(repo);
    const out: MergeMethod[] = [];
    if (r.allow_squash_merge) out.push("squash");
    if (r.allow_merge_commit) out.push("merge");
    if (r.allow_rebase_merge) out.push("rebase");
    return out.length ? out : ["merge"];
  }

  /** Can the user merge past branch protection? (repo admin) */
  async canAdminOverride(repo: string): Promise<boolean> {
    const r = await this.repoInfo(repo);
    return !!r.permissions?.admin;
  }

  /** Merge the PR immediately. Method defaults to the repo's preferred one. */
  async mergePull(repo: string, number: number, method?: MergeMethod): Promise<void> {
    const m = method ?? (await this.repoMergeMethods(repo))[0];
    await this.json("PUT", `/repos/${repo}/pulls/${number}/merge`, { merge_method: m });
  }

  /** Arm GitHub auto-merge (GraphQL-only). Method defaults like mergePull. */
  async enableAutoMerge(repo: string, number: number, method?: MergeMethod): Promise<void> {
    const [pull, m] = await Promise.all([
      this.json<{ node_id: string }>("GET", `/repos/${repo}/pulls/${number}`),
      method ? Promise.resolve(method) : this.repoMergeMethods(repo).then((ms) => ms[0]),
    ]);
    await this.graphql(
      `mutation($id:ID!,$m:PullRequestMergeMethod!){
        enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:$m}){ pullRequest{ number } }
      }`,
      { id: pull.node_id, m: m.toUpperCase() }
    );
  }

  /** Disarm GitHub auto-merge. */
  async disableAutoMerge(repo: string, number: number): Promise<void> {
    const pull = await this.json<{ node_id: string }>("GET", `/repos/${repo}/pulls/${number}`);
    await this.graphql(
      `mutation($id:ID!){ disablePullRequestAutoMerge(input:{pullRequestId:$id}){ pullRequest{ number } } }`,
      { id: pull.node_id }
    );
  }

  /** Server-side "Update branch": merge the base branch into the PR head. */
  async updateBranch(repo: string, number: number): Promise<void> {
    await this.json("PUT", `/repos/${repo}/pulls/${number}/update-branch`, {});
  }

  /** Flip a draft PR to "ready for review" — a GraphQL-only operation. */
  async markReadyForReview(repo: string, number: number): Promise<void> {
    const detail = await this.json<{ node_id: string }>("GET", `/repos/${repo}/pulls/${number}`);
    await this.graphql(
      `mutation($id:ID!){ markPullRequestReadyForReview(input:{pullRequestId:$id}){ pullRequest{ isDraft } } }`,
      { id: detail.node_id }
    );
  }

  /** Send an open PR back to draft — also GraphQL-only. */
  async convertToDraft(repo: string, number: number): Promise<void> {
    const detail = await this.json<{ node_id: string }>("GET", `/repos/${repo}/pulls/${number}`);
    await this.graphql(
      `mutation($id:ID!){ convertPullRequestToDraft(input:{pullRequestId:$id}){ pullRequest{ isDraft } } }`,
      { id: detail.node_id }
    );
  }

  /** Edit/delete the user's own comments. `kind` matches CommentInfo.kind. */
  async updateComment(
    repo: string,
    kind: "issue" | "review_comment",
    commentId: number,
    body: string
  ): Promise<void> {
    const path =
      kind === "issue"
        ? `/repos/${repo}/issues/comments/${commentId}`
        : `/repos/${repo}/pulls/comments/${commentId}`;
    await this.json("PATCH", path, { body });
  }

  async deleteComment(
    repo: string,
    kind: "issue" | "review_comment",
    commentId: number
  ): Promise<void> {
    const path =
      kind === "issue"
        ? `/repos/${repo}/issues/comments/${commentId}`
        : `/repos/${repo}/pulls/comments/${commentId}`;
    await this.raw("DELETE", path);
  }

  async submitReview(
    repo: string,
    number: number,
    opts: {
      body: string;
      event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
      comments: ProposedInlineComment[];
    }
  ): Promise<string> {
    const comments = opts.comments
      .filter((c) => c.included)
      .map((c) => ({
        path: c.path,
        line: c.line,
        side: c.side,
        ...(c.startLine && c.startLine !== c.line
          ? { start_line: c.startLine, start_side: c.side }
          : {}),
        body: c.body,
      }));
    const res = await this.json<any>("POST", `/repos/${repo}/pulls/${number}/reviews`, {
      body: opts.body,
      event: opts.event,
      comments,
    });
    return res.html_url ?? "";
  }

  /** Clone URL with embedded token so worktree pushes authenticate. */
  authedCloneUrl(repo: string): string {
    const host = this.webBase.replace(/^https?:\/\//, "");
    return `https://x-access-token:${this.token}@${host}/${repo}.git`;
  }
}
