import { native } from "./tauri";
import type {
  CheckInfo,
  CommentInfo,
  GlobalConfig,
  PrSummary,
  ProposedInlineComment,
  ReviewInfo,
} from "../types";

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

  /** GET with Link-header pagination (max ~500 items). */
  private async paged<T>(path: string, accept?: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | null = path + (path.includes("?") ? "&" : "?") + "per_page=100";
    for (let i = 0; i < 5 && url; i++) {
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
    return out;
  }

  async getCheckLogExcerpt(repo: string, checkUrl: string): Promise<string> {
    // Check-run annotation text is the most portable "what failed" signal.
    try {
      const m = /check-runs\/(\d+)/.exec(checkUrl);
      if (!m) return "";
      const anns = await this.json<any[]>(
        "GET",
        `/repos/${repo}/check-runs/${m[1]}/annotations?per_page=50`
      );
      return anns
        .map((a) => `${a.path}:${a.start_line} [${a.annotation_level}] ${a.message}`)
        .join("\n");
    } catch {
      return "";
    }
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
