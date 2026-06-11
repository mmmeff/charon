import { SHIPPED_SKILLS } from "./defaults";
import { native } from "./tauri";
import { useSkillStore } from "./store";
import type { Skill } from "../types";

/**
 * Load skills from ~/.cursor (commands/, skills/, skills-cursor/) plus any
 * user-added directories. Shipped fallbacks (thermonuclear review, humanize)
 * are appended only when no local skill claims the same name — the user's
 * own files always win.
 */
export async function loadSkills(extraDirs: string[]): Promise<Skill[]> {
  let local: Skill[] = [];
  try {
    const raw = await native.listCursorSkills(extraDirs);
    local = raw.map((s) => ({
      name: s.name,
      source: s.source as Skill["source"],
      path: s.path,
      content: s.content,
    }));
  } catch (e) {
    console.error("skill scan failed", e);
  }
  const names = new Set(local.map((s) => normalizeName(s.name)));
  for (const shipped of SHIPPED_SKILLS) {
    if (!names.has(normalizeName(shipped.name))) {
      local.push({ name: shipped.name, source: "shipped", path: "(built-in)", content: shipped.content });
    }
  }
  local.sort((a, b) => a.name.localeCompare(b.name));
  useSkillStore.getState().setSkills(local);
  return local;
}

function normalizeName(n: string): string {
  return n.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function findSkill(skills: Skill[], name: string): Skill | undefined {
  const norm = normalizeName(name);
  return (
    skills.find((s) => normalizeName(s.name) === norm) ??
    // loose match: "thermonuclear" finds "thermonuclear-code-quality-review"
    skills.find((s) => normalizeName(s.name).includes(norm) || norm.includes(normalizeName(s.name)))
  );
}

/**
 * Expand `/skill-name` references inside a prompt to the skill's content and
 * append any per-category selected skills. This is how event prompts like
 * "run /fix-merge-conflicts for PR {pr-number}" pick up skill instructions
 * when such a skill exists locally; unknown references pass through verbatim
 * (the agent may still resolve them itself).
 */
export function applySkills(
  prompt: string,
  skills: Skill[],
  selectedNames: string[]
): string {
  const used = new Set<string>();
  const sections: string[] = [];

  const expanded = prompt.replace(/(?:^|\s)\/([a-z0-9][a-z0-9-_]+)/gi, (whole, name: string) => {
    const skill = findSkill(skills, name);
    if (skill && !used.has(skill.name)) {
      used.add(skill.name);
      sections.push(`## Skill: ${skill.name}\n\n${skill.content}`);
    }
    return whole; // keep the reference in place for readability
  });

  for (const name of selectedNames) {
    const skill = findSkill(skills, name);
    if (skill && !used.has(skill.name)) {
      used.add(skill.name);
      sections.push(`## Skill: ${skill.name}\n\n${skill.content}`);
    }
  }

  if (sections.length === 0) return expanded;
  return (
    expanded +
    "\n\n---\nThe following skills apply to this task. Follow their instructions:\n\n" +
    sections.join("\n\n")
  );
}
