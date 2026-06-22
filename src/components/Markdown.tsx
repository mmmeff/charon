import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";

const SANITIZE_OPTS = {
  // GitHub renders uploaded screen recordings as <video>; keep them playable
  ADD_TAGS: ["video", "source"],
  ADD_ATTR: ["controls", "muted", "playsinline", "loop", "autoplay", "poster", "type"],
};

const finalize = (raw: string) =>
  DOMPurify.sanitize(raw, SANITIZE_OPTS).replace(/<a /g, '<a target="_blank" rel="noreferrer" ');

/**
 * Coalesce rapid changes to `value` so a downstream effect (here: markdown
 * parse + innerHTML replace + reflow) fires at most once per `ms` during fast
 * streaming, with a trailing flush so the final value always lands. `ms <= 0`
 * is a pass-through (no throttling, no extra renders) for non-streaming use.
 *
 * This exists because agent streams merge every chunk into one growing entry
 * (store.appendChunk), and Markdown re-parses + reflows the WHOLE accumulated
 * text on every change. At the 1/3-width card grid that reflow is ~3× the line
 * count of a full-width card, so unthrottled streaming reflows a long message
 * block once per chunk (often 50+/sec) — a severe per-chunk layout cost. Capping
 * to ~8/sec keeps the stream visibly live while collapsing the layout cost.
 * Returns the raw `value` when `ms <= 0` so static callers are unaffected.
 */
function useThrottledValue<T>(value: T, ms: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (ms <= 0) return; // pass-through: caller reads `value` directly
    const now = Date.now();
    const remaining = ms - (now - lastRef.current);
    if (remaining <= 0) {
      lastRef.current = now;
      setThrottled(value);
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        lastRef.current = Date.now();
        setThrottled(value);
      }, remaining);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, ms]);

  return ms <= 0 ? value : throttled;
}

/**
 * Sanitized GitHub-flavored markdown. When GitHub's server-rendered HTML is
 * available (`html`), prefer it: it carries signed asset URLs for uploaded
 * screenshots/videos (which 403 when fetched without auth) and proper
 * <video> elements. Falls back to local rendering of the raw markdown.
 * Links open externally instead of navigating the app window.
 *
 * `throttleMs` coalesces rapid `text` changes (agent streaming) so the parse +
 * innerHTML replace + reflow fires at most once per `throttleMs`. Leave unset
 * for static content (proposal cards, comments, …). Only the local-render
 * (`text`) path is throttled; server-rendered `html` is already final.
 */
export function Markdown({
  text,
  html,
  className,
  throttleMs = 0,
}: {
  text: string;
  html?: string;
  className?: string;
  throttleMs?: number;
}) {
  const throttled = useThrottledValue(text ?? "", throttleMs);
  const rendered = useMemo(() => {
    if (html?.trim()) return finalize(html);
    const raw = marked.parse(throttled, { async: false, gfm: true, breaks: true }) as string;
    return finalize(raw);
  }, [throttled, html]);
  return <div className={`md ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: rendered }} />;
}
