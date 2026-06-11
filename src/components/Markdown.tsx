import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo } from "react";

/**
 * Sanitized GitHub-flavored markdown. Links open externally (the webview's
 * new-window handler routes them to the system browser) instead of navigating
 * the app window.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(text ?? "", { async: false, gfm: true, breaks: true }) as string;
    return DOMPurify.sanitize(raw).replace(/<a /g, '<a target="_blank" rel="noreferrer" ');
  }, [text]);
  return <div className={`md ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
