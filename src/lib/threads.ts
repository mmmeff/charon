import type { CommentInfo } from "../types";

/** Group inline review comments into (root, replies) threads. */
export function groupCommentThreads(
  comments: CommentInfo[]
): { root: CommentInfo; replies: CommentInfo[] }[] {
  const inline = comments.filter((c) => c.kind === "review_comment" && c.path && c.line);
  const ids = new Set(inline.map((c) => c.id));
  return inline
    .filter((c) => !c.inReplyTo || !ids.has(c.inReplyTo))
    .map((root) => ({
      root,
      replies: inline
        .filter((c) => c.inReplyTo === root.id)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    }));
}
