import { useEffect, useState } from "react";
import { EVENT_CATALOG } from "../../lib/defaults";
import { resolveHandler } from "../../lib/events";
import { loadSkills } from "../../lib/skills";
import { useGlobalConfig, useRepoStore, useSkillStore } from "../../lib/store";
import type { ClassFilters, RepoConfig, SkillSelection } from "../../types";
import { Badge } from "../common";
import { PromptInput } from "../PromptInput";

const NAV_SECTIONS = [
  { id: "s-agent", label: "Agent" },
  { id: "s-babysit", label: "My PRs · filters" },
  { id: "s-review", label: "Teammate · filters" },
  { id: "s-events", label: "Events" },
  { id: "s-skills", label: "Skills" },
  { id: "s-models", label: "Models" },
  { id: "s-conn", label: "Connection" },
];

const groupId = (g: string) => "g-" + g.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** Sticky outline nav with scroll-spy for the settings sections. */
function SettingsNav() {
  const groups = [...new Set(EVENT_CATALOG.map((e) => e.group))];
  const [active, setActive] = useState("s-agent");

  useEffect(() => {
    const ids = [...NAV_SECTIONS.map((s) => s.id), ...groups.map(groupId)];
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).id;
          if (e.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        const first = ids.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      { rootMargin: "-5% 0px -70% 0px" }
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jump = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <nav className="settings-nav">
      {NAV_SECTIONS.map((s) => (
        <div key={s.id}>
          <button
            className={`settings-nav-item ${active === s.id ? "active" : ""}`}
            onClick={() => jump(s.id)}
          >
            {s.label}
          </button>
          {s.id === "s-events" &&
            groups.map((g) => (
              <button
                key={g}
                className={`settings-nav-item sub ${active === groupId(g) ? "active" : ""}`}
                onClick={() => jump(groupId(g))}
              >
                {g.replace(/^(My PRs|Teammate PRs) — /, "")}
              </button>
            ))}
        </div>
      ))}
    </nav>
  );
}

/**
 * Per-repo configuration: class filters, the event catalog (toggle + editable
 * prompt per event), skills, and agent/connection options. Everything has
 * sane defaults; everything here is stored locally, per repo.
 */
export function SettingsView() {
  const config = useRepoStore((s) => s.config);
  const saveConfig = useRepoStore((s) => s.saveConfig);
  const repo = useRepoStore((s) => s.repo);
  const global = useGlobalConfig((s) => s.config);
  const saveGlobal = useGlobalConfig((s) => s.save);
  const skills = useSkillStore((s) => s.skills);
  const [saved, setSaved] = useState(false);

  if (!global) return null;

  const update = (patch: Partial<RepoConfig>) => {
    void saveConfig({ ...config, ...patch });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="main">
      <div className="settings-layout">
        <SettingsNav />
        <div className="settings-body">
      <div className="row between" style={{ maxWidth: 880 }}>
        <h2 className="viewtitle">Settings — {repo}</h2>
        {saved && <Badge color="green">saved</Badge>}
      </div>

      <div className="settings-section" id="s-agent">
        <h3>Agent</h3>
        <label className="field">
          <span>Default model for this repo</span>
          <select value={config.model} onChange={(e) => update({ model: e.target.value })}>
            <option value="">global default ({global.defaultModel})</option>
            {global.models
              .filter((m) => !(global.disabledModels ?? []).includes(m) || m === config.model)
              .map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Default review prompt</span>
          <PromptInput
            rows={2}
            value={config.reviewPrompt}
            onChange={(reviewPrompt) => update({ reviewPrompt })}
          />
          <small>
            Prefilled in the composer whenever Review mode is picked — tweak it per run before launching.
            Template variables (<code>{"{pr-number}"}</code> …) and <code>/skill</code> references work.
          </small>
        </label>
        <label className="field">
          <span>Fix-flow dependency &amp; validation policy</span>
          <PromptInput
            rows={5}
            value={config.fixPolicy}
            onChange={(fixPolicy) => update({ fixPolicy })}
          />
          <small>
            Injected into every fix/apply agent prompt. The default forbids dependency installs and full
            builds (slow and disk-hungry in monorepos) — loosen it for repos where agents should run tests.
          </small>
        </label>
        <label className="field">
          <span>Poll interval (seconds)</span>
          <input
            type="number"
            min={20}
            value={config.pollIntervalSec}
            onChange={(e) => update({ pollIntervalSec: Math.max(20, Number(e.target.value) || 60) })}
            style={{ width: 120 }}
          />
        </label>
        <label className="field">
          <span>Local clone path (optional)</span>
          <input
            type="text"
            value={config.localClonePath}
            placeholder="leave empty for an app-managed clone"
            onChange={(e) => update({ localClonePath: e.target.value })}
          />
          <small>Worktrees for fix flows and draft edits are created from this clone.</small>
        </label>
        <label className="field">
          <span>Bug-bot author patterns</span>
          <input
            type="text"
            value={config.bugBotPatterns.join(", ")}
            onChange={(e) =>
              update({ bugBotPatterns: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
            }
          />
          <small>Bot logins containing any of these fire <code>bug_bot_finding</code> instead of the generic bot events.</small>
        </label>
        <label className="field">
          <span>Required approvals</span>
          <input
            type="number"
            min={1}
            value={config.requiredApprovals}
            onChange={(e) => update({ requiredApprovals: Math.max(1, Number(e.target.value) || 1) })}
            style={{ width: 120 }}
          />
        </label>
      </div>

      <div className="settings-section" id="s-babysit">
        <h3>My PRs (Babysit) — filters</h3>
        <FilterEditor
          filters={config.babysitFilters}
          onChange={(babysitFilters) => update({ babysitFilters })}
          draftsHint="Also watch your draft PRs (they always show in the Drafts tab regardless)."
        />
      </div>

      <div className="settings-section" id="s-review">
        <h3>Teammate PRs (Review) — filters</h3>
        <FilterEditor
          filters={config.reviewFilters}
          onChange={(reviewFilters) => update({ reviewFilters })}
          draftsHint="Also process teammate drafts you've been asked to review."
        />
      </div>

      <div className="settings-section" id="s-events">
        <h3>Events</h3>
        <p className="subtle">
          Every event is a toggle plus a prompt template. <strong>All automation ships OFF</strong> — opt in
          per event when you're ready for the app to react on its own. When an event fires and is enabled,
          the prompt runs against a Cursor agent — the behavior is whatever the prompt instructs. Variables:{" "}
          <code>{"{pr-number}"}</code> <code>{"{pr-title}"}</code> <code>{"{branch}"}</code>{" "}
          <code>{"{base-branch}"}</code> <code>{"{comment-body}"}</code> <code>{"{author}"}</code>{" "}
          <code>{"{model}"}</code> <code>{"{filter-criteria}"}</code> <code>{"{check-name}"}</code>{" "}
          <code>{"{label}"}</code>. Skill references like <code>/fix-merge-conflicts</code> expand to the
          skill's content when it exists.
        </p>
        <EventCatalogEditor config={config} update={update} />
      </div>

      <div className="settings-section" id="s-skills">
        <h3>Skills</h3>
        <p className="subtle">
          Imported from <code>~/.cursor</code> (commands, skills) plus any extra directories. Select which
          skills apply at each stage; they're appended to the agent prompt for that stage.
        </p>
        {(
          [
            ["review", "Review (teammate PRs)"],
            ["fix", "Fix flows (CI, conflicts, feedback)"],
            ["draft", "Draft edits"],
            ["rewrite", "Rewrites / regeneration"],
          ] as [keyof SkillSelection, string][]
        ).map(([cat, label]) => (
          <div key={cat} className="event-row">
            <strong>{label}</strong>
            <div className="row" style={{ marginTop: 6 }}>
              {skills.map((s) => (
                <label key={s.name + s.source} className="switch" title={`${s.source}: ${s.path}`}>
                  <input
                    type="checkbox"
                    checked={config.skills[cat].includes(s.name)}
                    onChange={(e) => {
                      const cur = config.skills[cat];
                      update({
                        skills: {
                          ...config.skills,
                          [cat]: e.target.checked ? [...cur, s.name] : cur.filter((n) => n !== s.name),
                        },
                      });
                    }}
                  />
                  {s.name} <Badge color="gray">{s.source}</Badge>
                </label>
              ))}
            </div>
          </div>
        ))}
        <label className="field" style={{ marginTop: 10 }}>
          <span>Extra skill directories (global)</span>
          <input
            type="text"
            value={global.extraSkillDirs.join(", ")}
            onChange={(e) => {
              const extraSkillDirs = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
              void saveGlobal({ ...global, extraSkillDirs }).then(() => loadSkills(extraSkillDirs));
            }}
            placeholder="/path/to/my/skills, /another/dir"
          />
          <small>Folders of .md files (or dirs containing SKILL.md) to load as additional skills.</small>
        </label>
      </div>

      <div className="settings-section" id="s-models">
        <h3>Models (global)</h3>
        <p className="subtle" style={{ maxWidth: "72ch" }}>
          Untick a model to hide it from every model picker, in all repos. The list refreshes from{" "}
          <code>cursor-agent models</code> on startup; newly discovered models arrive enabled. Default
          models keep working even if hidden here.
        </p>
        <div className="row" style={{ marginBottom: 8 }}>
          <button
            className="small"
            onClick={() => void saveGlobal({ ...global, disabledModels: [] })}
          >
            Select all
          </button>
          <button
            className="small"
            onClick={() => void saveGlobal({ ...global, disabledModels: [...global.models] })}
          >
            Deselect all
          </button>
          <span className="subtle">
            {global.models.length - (global.disabledModels ?? []).length}/{global.models.length} enabled
          </span>
        </div>
        <div className="model-list">
          {global.models.map((m) => {
            const off = (global.disabledModels ?? []).includes(m);
            return (
              <label key={m} className="switch" style={{ display: "flex", marginBottom: 5 }}>
                <input
                  type="checkbox"
                  checked={!off}
                  onChange={(e) => {
                    const next = new Set(global.disabledModels ?? []);
                    if (e.target.checked) next.delete(m);
                    else next.add(m);
                    void saveGlobal({ ...global, disabledModels: [...next] });
                  }}
                />
                {global.modelLabels[m] ?? m} <span className="subtle">({m})</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="settings-section" id="s-conn">
        <h3>Connection (global)</h3>
        <p className="subtle">
          {global.login} @ {global.githubUrl} · agent binary <code>{global.cursorBinary}</code>. Reconfigure
          from the launcher window.
        </p>
        <label className="field">
          <span>Global default model</span>
          <select
            value={global.defaultModel}
            onChange={(e) => void saveGlobal({ ...global, defaultModel: e.target.value })}
          >
            {global.models
              .filter((m) => !(global.disabledModels ?? []).includes(m) || m === global.defaultModel)
              .map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
          </select>
        </label>
      </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function FilterEditor({
  filters,
  onChange,
  draftsHint,
}: {
  filters: ClassFilters;
  onChange: (f: ClassFilters) => void;
  draftsHint: string;
}) {
  return (
    <>
      <label className="switch" style={{ marginBottom: 10 }}>
        <input
          type="checkbox"
          checked={filters.processDrafts}
          onChange={(e) => onChange({ ...filters, processDrafts: e.target.checked })}
        />
        Process draft PRs <span className="subtle">— {draftsHint}</span>
      </label>
      <label className="field">
        <span>Exclude labels</span>
        <input
          type="text"
          value={filters.excludeLabels.join(", ")}
          onChange={(e) =>
            onChange({
              ...filters,
              excludeLabels: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            })
          }
        />
        <small>PRs with any of these labels are ignored entirely.</small>
      </label>
      <label className="field">
        <span>LLM criteria</span>
        <PromptInput
          rows={3}
          value={filters.criteria}
          onChange={(criteria) => onChange({ ...filters, criteria })}
        />
        <small>
          Fed directly into agent prompts as <code>{"{filter-criteria}"}</code> — e.g. which comments warrant
          a response, what reviews should focus on.
        </small>
      </label>
    </>
  );
}

// ---------------------------------------------------------------------------

function EventCatalogEditor({
  config,
  update,
}: {
  config: RepoConfig;
  update: (patch: Partial<RepoConfig>) => void;
}) {
  const groups = [...new Set(EVENT_CATALOG.map((e) => e.group))];

  const setHandler = (id: string, enabled: boolean, prompt: string) => {
    update({ events: { ...config.events, [id]: { enabled, prompt } } });
  };

  return (
    <>
      {groups.map((g) => (
        <div key={g} id={groupId(g)}>
          <h4>{g}</h4>
          {EVENT_CATALOG.filter((e) => e.group === g).map((def) => {
            const handler = resolveHandler(config.events, def.id);
            const isDefault =
              handler.enabled === def.defaultEnabled && handler.prompt === def.defaultPrompt;
            return (
              <div key={def.id} className="event-row">
                <div className="row between">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={handler.enabled}
                      onChange={(e) => setHandler(def.id, e.target.checked, handler.prompt)}
                    />
                    <strong>{def.label}</strong>
                    <code>{def.id}</code>
                    <Badge color={def.appliesTo === "mine" ? "blue" : def.appliesTo === "teammate" ? "purple" : "gray"}>
                      {def.appliesTo === "mine" ? "my PRs" : def.appliesTo === "teammate" ? "teammate PRs" : "both"}
                    </Badge>
                  </label>
                  {!isDefault && (
                    <button
                      className="link small"
                      onClick={() => {
                        const { [def.id]: _, ...rest } = config.events;
                        update({ events: rest });
                      }}
                    >
                      reset to default
                    </button>
                  )}
                </div>
                <div className="desc">{def.description}</div>
                <PromptInput
                  rows={2}
                  value={handler.prompt}
                  onChange={(prompt) => setHandler(def.id, handler.enabled, prompt)}
                />
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
