/**
 * Split a timeline sentence around the short (7-char) prefix of `sha`, so the
 * activity feed can turn that hash into a clickable commit-diff link. The short
 * sha is embedded verbatim in the sentence (e.g. "pushed abc1234", "merged this
 * PR as 0011223"). Returns null when there is no sha or it isn't present in the
 * text, in which case the caller renders the sentence as-is.
 */
export function splitCommitMention(
  text: string,
  sha: string | undefined
): { before: string; short: string; after: string } | null {
  const short = sha?.slice(0, 7);
  if (!short) return null;
  const idx = text.indexOf(short);
  if (idx < 0) return null;
  return { before: text.slice(0, idx), short, after: text.slice(idx + short.length) };
}
