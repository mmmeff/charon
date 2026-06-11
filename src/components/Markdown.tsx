import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo } from "react";

const SANITIZE_OPTS = {
  // GitHub renders uploaded screen recordings as <video>; keep them playable
  ADD_TAGS: ["video", "source"],
  ADD_ATTR: ["controls", "muted", "playsinline", "loop", "autoplay", "poster", "type"],
};

const finalize = (raw: string) =>
  DOMPurify.sanitize(raw, SANITIZE_OPTS).replace(/<a /g, '<a target="_blank" rel="noreferrer" ');

/**
 * Sanitized GitHub-flavored markdown. When GitHub's server-rendered HTML is
 * available (`html`), prefer it: it carries signed asset URLs for uploaded
 * screenshots/videos (which 403 when fetched without auth) and proper
 * <video> elements. Falls back to local rendering of the raw markdown.
 * Links open externally instead of navigating the app window.
 */
export function Markdown({
  text,
  html,
  className,
}: {
  text: string;
  html?: string;
  className?: string;
}) {
  const rendered = useMemo(() => {
    if (html?.trim()) return finalize(html);
    const raw = marked.parse(text ?? "", { async: false, gfm: true, breaks: true }) as string;
    return finalize(raw);
  }, [text, html]);
  return <div className={`md ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: rendered }} />;
}
