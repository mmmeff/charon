import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { useSkillStore } from "../lib/store";
import type { Skill } from "../types";
import { Badge } from "./common";

/**
 * Prompt input (textarea or single-line) with a `/skill` autocomplete: typing
 * `/` at the start of a word opens a picker over the loaded skills; accepting
 * inserts `/skill-name`, which the prompt pipeline expands to the skill's
 * content. Used by every prompt-shaped input in the app.
 */
export function PromptInput({
  value,
  onChange,
  as = "textarea",
  rows = 3,
  placeholder,
  autoFocus,
  onKeyDown,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  as?: "textarea" | "input";
  rows?: number;
  placeholder?: string;
  autoFocus?: boolean;
  /** Called for keys the autocomplete didn't consume (e.g. Cmd+Enter submit). */
  onKeyDown?: (e: KeyboardEvent) => void;
  style?: CSSProperties;
}) {
  const skills = useSkillStore((s) => s.skills);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const [token, setToken] = useState<{ start: number; query: string } | null>(null);
  const [index, setIndex] = useState(0);

  const matches: Skill[] = token
    ? rankSkills(skills, token.query).slice(0, 8)
    : [];
  const open = token !== null && matches.length > 0;

  // Find an in-progress `/word` token ending at the caret.
  const recompute = () => {
    const el = ref.current;
    if (!el) return setToken(null);
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const m = /(^|[\s({\["'`])\/([a-zA-Z0-9_-]*)$/.exec(before);
    if (m) {
      const start = caret - m[2].length - 1; // position of the "/"
      setToken((prev) => {
        if (prev?.start !== start || prev?.query !== m[2]) setIndex(0);
        return { start, query: m[2] };
      });
    } else {
      setToken(null);
    }
  };

  // caret can move without a change event (click, arrows)
  useEffect(recompute, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const accept = (skill: Skill) => {
    if (!token) return;
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const inserted = `/${skill.name} `;
    const next = value.slice(0, token.start) + inserted + value.slice(caret);
    onChange(next);
    setToken(null);
    const newCaret = token.start + inserted.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(newCaret, newCaret);
    });
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndex((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        accept(matches[Math.min(index, matches.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setToken(null);
        return;
      }
    }
    onKeyDown?.(e);
  };

  const shared = {
    value,
    placeholder,
    autoFocus,
    style,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) =>
      onChange(e.target.value),
    onKeyDown: handleKeyDown,
    onKeyUp: recompute,
    onClick: recompute,
    onBlur: () => setTimeout(() => setToken(null), 150), // let click-to-accept land first
  };

  return (
    <div className="autocomplete">
      {as === "textarea" ? (
        <textarea ref={ref as React.Ref<HTMLTextAreaElement>} rows={rows} {...shared} />
      ) : (
        <input ref={ref as React.Ref<HTMLInputElement>} type="text" {...shared} />
      )}
      {open && (
        <div className="autocomplete-menu">
          {matches.map((s, i) => (
            <div
              key={s.name + s.source}
              className={`autocomplete-item ${i === index ? "active" : ""}`}
              title={s.path}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the input
                accept(s);
              }}
            >
              <span className="mono">/{s.name}</span>
              <Badge color="gray">{s.source}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Prefix matches first, then substring matches, alphabetical within each. */
function rankSkills(skills: Skill[], query: string): Skill[] {
  const q = query.toLowerCase();
  const prefix: Skill[] = [];
  const substr: Skill[] = [];
  for (const s of skills) {
    const n = s.name.toLowerCase();
    if (n.startsWith(q)) prefix.push(s);
    else if (n.includes(q)) substr.push(s);
  }
  return [...prefix, ...substr];
}
