/**
 * Prompt template interpolation. Variables use {kebab-case} syntax:
 *   {pr-number} {pr-title} {branch} {base-branch} {comment-body} {author}
 *   {model} {repo} {filter-criteria} ... plus anything the event provides.
 * Unknown variables are left intact so prompts degrade visibly, not silently.
 */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-z0-9-]+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : whole
  );
}

/** Standard variables derived from a PR. */
export function prVars(pr: {
  number: number;
  title: string;
  headRef: string;
  baseRef: string;
  author: string;
  url: string;
  body: string;
}): Record<string, string> {
  return {
    "pr-number": String(pr.number),
    "pr-title": pr.title,
    "pr-body": pr.body ?? "",
    "pr-url": pr.url,
    branch: pr.headRef,
    "base-branch": pr.baseRef,
    author: pr.author,
  };
}

export function uid(prefix = ""): string {
  return (
    prefix +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 8)
  );
}

export function truncate(s: string, max: number, note = "\n…[truncated]"): string {
  return s.length <= max ? s : s.slice(0, max) + note;
}
