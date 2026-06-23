import { useEffect, useRef, useState } from "react";
import { refreshModels } from "../../lib/agents";
import { probeHarness, summarizeProbe } from "../../lib/acp";
import {
  activeHarness,
  EVENT_CATALOG,
  FLOW_MODEL_CATALOG,
  harnessTemplates,
  NOTIFICATION_CATALOG,
  notificationEnabled,
  switchHarness,
} from "../../lib/defaults";
import { eventFlowKind, resolveHandler } from "../../lib/events";
import { loadSkills } from "../../lib/skills";
import {
  bindingsEqual,
  DEFAULT_SHORTCUTS,
  formatShortcut,
  normalizeBinding,
  resolveShortcutMap,
  shortcutConflict,
  SHORTCUT_CATALOG,
} from "../../lib/shortcuts";
import { native } from "../../lib/tauri";
import { useScrollMemory } from "../../lib/ui";
import { useGlobalConfig, useRepoStore, useSkillStore } from "../../lib/store";
import type {
  ClassFilters,
  EventHandlerConfig,
  GlobalConfig,
  KeyBinding,
  RepoConfig,
  ShortcutActionId,
  ShortcutMap,
  SkillSelection,
} from "../../types";
import { Badge, Spinner } from "../common";
import { ModelPicker } from "../ModelPicker";
import { PromptInput } from "../PromptInput";
import { PrReviewFilterBuilder } from "../PrReviewFilterBuilder";
import { ShortcutRecorder } from "../ShortcutRecorder";
import { useFlow } from "../flow";

/**
 * Settings outline: top-level groups, each with its sections in document order.
 * A group whose single section shares its name (Connection/Checks/Automation)
 * renders flat; multi-section groups (Agent/Views) get a header + children.
 */
const NAV_GROUPS: { group: string; items: { id: string; label: string }[] }[] = [
  { group: "Connection", items: [{ id: "s-conn", label: "Connection" }] },
  {
    group: "Agent",
    items: [
      { id: "s-harness", label: "Harness" },
      { id: "s-models", label: "Models" },
      { id: "s-defmodels", label: "Default models" },
      { id: "s-skills", label: "Skills" },
      { id: "s-agent", label: "Behavior" },
      { id: "s-draft-create", label: "Draft creation" },
    ],
  },
  {
    group: "Views",
    items: [
      { id: "s-babysit", label: "My PRs" },
      { id: "s-review", label: "To Review" },
    ],
  },
  { group: "Checks", items: [{ id: "s-ci", label: "Checks" }] },
  { group: "Notifications", items: [{ id: "s-notifications", label: "Notifications" }] },
  { group: "Automation", items: [{ id: "s-events", label: "Automation" }] },
  { group: "Diffs", items: [{ id: "s-diffs", label: "Auto-collapse" }] },
];

const groupId = (g: string) => "g-" + g.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** Sticky outline nav with scroll-spy for the settings sections. */
function SettingsNav() {
  const eventGroups = [...new Set(EVENT_CATALOG.map((e) => e.group))];
  const allIds = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));
  const [active, setActive] = useState(allIds[0]);

  useEffect(() => {
    const ids = [...allIds, ...eventGroups.map(groupId)];
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
      {NAV_GROUPS.map(({ group, items }) => {
        const flat = items.length === 1 && items[0].label === group;
        return (
          <div key={group} className="settings-nav-group">
            {flat ? (
              <button
                className={`settings-nav-item ${active === items[0].id ? "active" : ""}`}
                onClick={() => jump(items[0].id)}
              >
                {group}
              </button>
            ) : (
              <div className="settings-nav-header">{group}</div>
            )}
            {!flat &&
              items.map((it) => (
                <button
                  key={it.id}
                  className={`settings-nav-item sub ${active === it.id ? "active" : ""}`}
                  onClick={() => jump(it.id)}
                >
                  {it.label}
                </button>
              ))}
            {/* Automation expands to the event-catalog groups */}
            {group === "Automation" &&
              eventGroups.map((g) => (
                <button
                  key={g}
                  className={`settings-nav-item sub ${active === groupId(g) ? "active" : ""}`}
                  onClick={() => jump(groupId(g))}
                >
                  {g.replace(/^(My PRs|Teammate PRs) — /, "")}
                </button>
              ))}
          </div>
        );
      })}
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
  const { ctx } = useFlow();
  const global = useGlobalConfig((s) => s.config);
  const saveGlobal = useGlobalConfig((s) => s.save);
  const skills = useSkillStore((s) => s.skills);
  const [saved, setSaved] = useState(false);
  const [settingsTab, setSettingsTabState] = useState<"general" | "shortcuts">(() =>
    localStorage.getItem("prc-settings-tab") === "shortcuts" ? "shortcuts" : "general"
  );
  const [branches, setBranches] = useState<string[]>([]);
  const [defaultBranch, setDefaultBranch] = useState("");
  const [branchErr, setBranchErr] = useState("");
  const mainRef = useRef<HTMLDivElement>(null);
  useScrollMemory(mainRef, `settings:${repo}`);

  useEffect(() => {
    let cancelled = false;
    setBranchErr("");
    void Promise.all([ctx.gh.defaultBranch(repo), ctx.gh.listBranches(repo)])
      .then(([def, list]) => {
        if (cancelled) return;
        setDefaultBranch(def);
        setBranches(Array.from(new Set([def, ...list].filter(Boolean))));
      })
      .catch((e) => {
        if (!cancelled) setBranchErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.gh, repo]);

  if (!global) return null;

  const markSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  const setSettingsTab = (next: "general" | "shortcuts") => {
    localStorage.setItem("prc-settings-tab", next);
    setSettingsTabState(next);
  };
  const update = (patch: Partial<RepoConfig>) => {
    void saveConfig({ ...config, ...patch });
    markSaved();
  };
  const updateDraftCreate = (patch: Partial<RepoConfig["draftCreate"]>) => {
    update({ draftCreate: { ...config.draftCreate, ...patch } });
  };
  const useDefaultBranch = !config.draftCreate.baseBranch.trim();

  return (
    <div className="main" ref={mainRef}>
      <div className="settings-head">
        <div>
          <div className="settings-eyebrow">{repo}</div>
          <h2>Settings</h2>
        </div>
        <div className="settings-head-actions">
          <div className="seg">
            <button
              className={`small ${settingsTab === "general" ? "primary" : ""}`}
              onClick={() => setSettingsTab("general")}
            >
              General
            </button>
            <button
              className={`small ${settingsTab === "shortcuts" ? "primary" : ""}`}
              onClick={() => setSettingsTab("shortcuts")}
            >
              Keyboard
            </button>
          </div>
          {saved && <Badge color="green">saved</Badge>}
        </div>
      </div>

      {settingsTab === "general" ? (
        <div className="settings-layout">
        <SettingsNav />
        <div className="settings-body">
      <div className="settings-section" id="s-conn">
        <h3>Connection (global)</h3>
        <p className="subtle">
          {global.login} @ {global.githubUrl}. Reconfigure the GitHub connection from the launcher window.
        </p>
        <div className="field">
          <span>Default base branch for new drafts</span>
          <label className="switch" style={{ marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={useDefaultBranch}
              onChange={(e) => {
                if (e.target.checked) {
                  updateDraftCreate({ baseBranch: "" });
                } else {
                  const firstOverride =
                    branches.find((b) => b !== defaultBranch) || defaultBranch || branches[0] || "";
                  if (firstOverride) updateDraftCreate({ baseBranch: firstOverride });
                }
              }}
            />
            Use GitHub default branch{" "}
            <span className="subtle">
              — {defaultBranch ? <code>{defaultBranch}</code> : branchErr ? "could not load" : "loading"}
            </span>
          </label>
          {!useDefaultBranch && (
            <select
              value={config.draftCreate.baseBranch}
              onChange={(e) => updateDraftCreate({ baseBranch: e.target.value })}
              disabled={branches.length === 0}
            >
              {branches.length === 0 && <option value="">Loading branches…</option>}
              {!branches.includes(config.draftCreate.baseBranch) && config.draftCreate.baseBranch && (
                <option value={config.draftCreate.baseBranch}>
                  {config.draftCreate.baseBranch} (not found)
                </option>
              )}
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          )}
          <small>
            New draft work starts from the GitHub default branch unless you choose another real remote
            branch here. The agent still creates a fresh branch for the PR.
            {branchErr && (
              <>
                {" "}Branch lookup failed: <code>{branchErr}</code>
              </>
            )}
          </small>
        </div>
      </div>
      <div className="settings-section" id="s-harness">
        <h3>Harness (global)</h3>
        <HarnessSettings global={global} save={saveGlobal} />
      </div>
      <div className="settings-section" id="s-models">
        <h3>Models (global)</h3>
        <p className="subtle" style={{ maxWidth: "72ch" }}>
          Untick a model to hide it from every model picker, in all repos. The list is sourced from the
          active harness over ACP on startup; newly discovered models arrive enabled. Default models keep
          working even if hidden here.
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
                {global.modelLabels[m] ?? m}
              </label>
            );
          })}
        </div>
      </div>
      <div className="settings-section" id="s-defmodels">
        <h3>Default models (global)</h3>
        {(() => {
          const hasReasoning = global.reasoningOptions.length > 0;
          const reasoningSelect = (value: string, onChange: (v: string) => void, inheritLabel: string) =>
            hasReasoning ? (
              <select value={value} title="Reasoning effort" onChange={(e) => onChange(e.target.value)}>
                <option value="">{inheritLabel}</option>
                {global.reasoningOptions.map((r) => (
                  <option key={r} value={r}>
                    reasoning: {global.reasoningLabels[r] ?? r}
                  </option>
                ))}
              </select>
            ) : null;
          const globalReasoningLabel = global.reasoningEffort
            ? global.reasoningLabels[global.reasoningEffort] ?? global.reasoningEffort
            : "harness default";
          return (
            <>
              <label className="field">
                <span>Global default {hasReasoning ? "model + reasoning" : "model"}</span>
                <div className="row" style={{ gap: 6 }}>
                  <select
                    value={global.defaultModel}
                    onChange={(e) => void saveGlobal({ ...global, defaultModel: e.target.value })}
                  >
                    {global.models
                      .filter((m) => !(global.disabledModels ?? []).includes(m) || m === global.defaultModel)
                      .map((m) => (
                        <option key={m} value={m}>
                          {global.modelLabels[m] ?? m}
                        </option>
                      ))}
                  </select>
                  {reasoningSelect(
                    global.reasoningEffort,
                    (v) => void saveGlobal({ ...global, reasoningEffort: v }),
                    "reasoning: harness default"
                  )}
                </div>
                <small>
                  Applies to every flow in every repo unless overridden — by a per-flow default
                  below or an explicit pick in a launch form.
                  {hasReasoning && " Reasoning is a separate axis on harnesses that expose it (e.g. Codex)."}
                </small>
              </label>
              <p className="subtle" style={{ maxWidth: "76ch" }}>
                Every AI-driven flow, with what you can steer at launch. Set a per-flow default to
                route a flow to a different model{hasReasoning ? " or reasoning effort" : ""} without
                touching the launch forms.
              </p>
              {FLOW_MODEL_CATALOG.map((f) => {
                const current = global.modelOverrides?.[f.kind] ?? "";
                const options = global.models.filter(
                  (m) => !(global.disabledModels ?? []).includes(m) || m === current
                );
                // keep a configured id listed even when the harness doesn't list
                // it (install defaults / pre-refresh) so the select reports truthfully
                if (current && !options.includes(current)) options.push(current);
                return (
                  <label key={f.kind} className="field flow-model-row">
                    <span>
                      {f.label} <em className="flow-cap">{f.capability}</em>
                    </span>
                    <div className="row" style={{ gap: 6 }}>
                      <select
                        value={current}
                        onChange={(e) => {
                          const next = { ...(global.modelOverrides ?? {}) };
                          if (e.target.value) next[f.kind] = e.target.value;
                          else delete next[f.kind];
                          void saveGlobal({ ...global, modelOverrides: next });
                        }}
                      >
                        <option value="">
                          model: {global.modelLabels[global.defaultModel] ?? global.defaultModel} (default)
                        </option>
                        {options.map((m) => (
                          <option key={m} value={m}>
                            {global.modelLabels[m] ?? m}
                          </option>
                        ))}
                      </select>
                      {reasoningSelect(
                        global.reasoningOverrides?.[f.kind] ?? "",
                        (v) => {
                          const next = { ...(global.reasoningOverrides ?? {}) };
                          if (v) next[f.kind] = v;
                          else delete next[f.kind];
                          void saveGlobal({ ...global, reasoningOverrides: next });
                        },
                        `reasoning: ${globalReasoningLabel} (default)`
                      )}
                    </div>
                  </label>
                );
              })}
            </>
          );
        })()}
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
            ["draftCreate", "Create draft PRs"],
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
      <div className="settings-section" id="s-agent">
        <h3>Behavior</h3>
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
          <small>
            Worktrees for fix flows, draft edits, and new draft creation are created from this clone.
            Leave empty to let Charon maintain an app-managed local clone under its app data directory.
          </small>
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
      <div className="settings-section" id="s-draft-create">
        <h3>Draft creation</h3>
        <p className="subtle" style={{ maxWidth: "76ch" }}>
          These instructions are injected into the new-draft agent and metadata generation. The launch
          form stays prompt-first; tune repository conventions here instead of adding required fields
          before every run.
        </p>
        <label className="field">
          <span>Branch naming instructions</span>
          <PromptInput
            rows={2}
            value={config.draftCreate.branchNameInstructions}
            onChange={(branchNameInstructions) => updateDraftCreate({ branchNameInstructions })}
          />
          <small>
            Default is <code>{"<user>/<short-slug>"}</code>. The branch is generated automatically from
            the prompt before work starts.
          </small>
        </label>
        <label className="field">
          <span>PR title instructions</span>
          <PromptInput
            rows={2}
            value={config.draftCreate.titleInstructions}
            onChange={(titleInstructions) => updateDraftCreate({ titleInstructions })}
          />
        </label>
        <label className="field">
          <span>PR description instructions</span>
          <PromptInput
            rows={3}
            value={config.draftCreate.descriptionInstructions}
            onChange={(descriptionInstructions) => updateDraftCreate({ descriptionInstructions })}
          />
        </label>
        <label className="field">
          <span>Implementation instructions</span>
          <PromptInput
            rows={4}
            value={config.draftCreate.implementationInstructions}
            onChange={(implementationInstructions) => updateDraftCreate({ implementationInstructions })}
          />
          <small>
            Used only for brand-new draft PRs. Existing draft PR edits continue to use the regular
            draft-edit flow and skill bucket.
          </small>
        </label>
      </div>
      <div className="settings-section" id="s-babysit">
        <h3>My PRs</h3>
        <FilterEditor
          filters={config.babysitFilters}
          onChange={(babysitFilters) => update({ babysitFilters })}
          draftsHint="Also watch your draft PRs (they always show in the Drafts tab regardless)."
        />
      </div>
      <div className="settings-section" id="s-review">
        <h3>To Review</h3>
        <p className="subtle">
          These are any open PRs on this repository that are not created by you. Review filters narrow
          that repo-wide set.
        </p>
        <PrReviewFilterBuilder
          filters={config.reviewFilters}
          onChange={(reviewFilters) => update({ reviewFilters })}
        />
      </div>
      <div className="settings-section" id="s-ci">
        <h3>Checks</h3>
        <label className="switch" style={{ marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={config.ciAutoAnalysis !== false}
            onChange={(e) => update({ ciAutoAnalysis: e.target.checked })}
          />
          Auto-analyze failed checks{" "}
          <span className="subtle">
            — a fast read-only agent summarizes each failure in one or two sentences
          </span>
        </label>
        {config.ciAutoAnalysis !== false && (
          <label className="field">
            <span>Analysis model</span>
            <ModelPicker
              value={global.modelOverrides?.["ci_analysis"] ?? ""}
              onChange={(m) => {
                const next = { ...(global.modelOverrides ?? {}) };
                if (m) next["ci_analysis"] = m;
                else delete next["ci_analysis"];
                void saveGlobal({ ...global, modelOverrides: next });
              }}
              flowKind="ci_analysis"
            />
            <small>
              The model behind each failure summary. A fast, cheap model is usually right here —
              leave it on the default to inherit your global default. (Also editable in Agent →
              Default models.)
            </small>
          </label>
        )}
        <label className="field">
          <span>Ignored checks</span>
          {(config.ignoredChecks ?? []).length === 0 ? (
            <small>
              None. Use <em>✕ ignore</em> on a failing check's analysis strip to mute it here.
            </small>
          ) : (
            <>
              {(config.ignoredChecks ?? []).map((name) => (
                <div className="row" key={name} style={{ marginBottom: 4 }}>
                  <code>{name}</code>
                  <button
                    className="link small"
                    onClick={() =>
                      update({ ignoredChecks: (config.ignoredChecks ?? []).filter((n) => n !== name) })
                    }
                  >
                    remove
                  </button>
                </div>
              ))}
              <small>Ignored checks never trigger auto-analysis (status display is unaffected).</small>
            </>
          )}
        </label>
      </div>
      <div className="settings-section" id="s-notifications">
        <h3>Notifications (global)</h3>
        <p className="subtle" style={{ maxWidth: "76ch" }}>
          Which desktop notifications Charon raises. Every notification in the app is gated here, so
          turning one off silences it everywhere — across all repos and windows.
        </p>
        {NOTIFICATION_CATALOG.map((n) => (
          <div key={n.id} className="event-row">
            <label className="switch">
              <input
                type="checkbox"
                checked={notificationEnabled(global.notifications, n.id)}
                onChange={(e) =>
                  void saveGlobal({
                    ...global,
                    notifications: { ...(global.notifications ?? {}), [n.id]: e.target.checked },
                  })
                }
              />
              <strong>{n.label}</strong>
            </label>
            <div className="desc">{n.description}</div>
          </div>
        ))}
      </div>
      <div className="settings-section" id="s-events">
        <h3>Automation</h3>
        <p className="subtle">
          Every event is a toggle, a prompt template, and the model it runs on. <strong>All automation
          ships OFF</strong> — opt in per event when you're ready for the app to react on its own. When an
          event fires and is enabled, the prompt runs against your agent (leave the model on its default
          to inherit the per-flow/repo/global setting) — the behavior is whatever the prompt instructs.
          Variables:{" "}
          <code>{"{pr-number}"}</code> <code>{"{pr-title}"}</code> <code>{"{branch}"}</code>{" "}
          <code>{"{base-branch}"}</code> <code>{"{comment-body}"}</code> <code>{"{author}"}</code>{" "}
          <code>{"{model}"}</code> <code>{"{check-name}"}</code>{" "}
          <code>{"{label}"}</code>. Skill references like <code>/fix-merge-conflicts</code> expand to the
          skill's content when it exists.
        </p>
        <EventCatalogEditor config={config} update={update} />
      </div>
      <div className="settings-section" id="s-diffs">
        <h3>Auto-collapse (global)</h3>
        <p className="subtle" style={{ maxWidth: "76ch" }}>
          Diffs whose file names match any pattern here start collapsed on load — "yarn.lock"
          collapses it at any depth, "*.test.ts" catches test diffs anywhere. Patterns are
          glob-style (<code>*</code> and <code>?</code> wildcards), one per line; empty lines are
          ignored. Matches run against the file name only, not the directory path.
        </p>
        <label className="field">
          <span>Collapse patterns</span>
          <textarea
            rows={6}
            defaultValue={(global.diffAutoCollapsePatterns ?? []).join("\n")}
            onBlur={(e) => {
              const patterns = e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean);
              void saveGlobal({ ...global, diffAutoCollapsePatterns: patterns });
              markSaved();
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const ta = e.currentTarget;
              const patterns = ta.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean);
              void saveGlobal({ ...global, diffAutoCollapsePatterns: patterns });
              markSaved();
            }}
            placeholder={"*.lock\npackage-lock.json\n*.snap"}
            spellCheck={false}
          />
          <small>
            Write one pattern per line. Saved on blur or Enter. Empty lines are ignored.
          </small>
        </label>
        <div className="field">
          <span>Active patterns</span>
          {(global.diffAutoCollapsePatterns ?? []).length === 0 ? (
            <small className="subtle">None — all diffs start expanded.</small>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {(global.diffAutoCollapsePatterns ?? []).map((p) => (
                <li key={p}>
                  <code>{p}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
         </div>
        </div>
      ) : (
        <ShortcutSettings global={global} save={saveGlobal} onSaved={markSaved} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ShortcutSettings({
  global,
  save,
  onSaved,
}: {
  global: GlobalConfig;
  save: (cfg: GlobalConfig) => Promise<void>;
  onSaved: () => void;
}) {
  const effective = resolveShortcutMap(global.shortcuts);
  const overrides = global.shortcuts ?? {};
  const groups = [...new Set(SHORTCUT_CATALOG.map((s) => s.group))];

  const saveShortcuts = (shortcuts: ShortcutMap) => {
    void save({ ...global, shortcuts }).then(onSaved);
  };

  const assign = (id: ShortcutActionId, binding: KeyBinding | null) => {
    const next: ShortcutMap = { ...overrides };
    if (!binding) {
      next[id] = null;
      saveShortcuts(next);
      return;
    }

    const normalized = normalizeBinding(binding);
    for (const def of SHORTCUT_CATALOG) {
      if (def.id !== id && bindingsEqual(effective[def.id], normalized)) next[def.id] = null;
    }
    next[id] = normalized;
    saveShortcuts(next);
  };

  const reset = (id: ShortcutActionId) => {
    const next: ShortcutMap = { ...overrides };
    delete next[id];
    saveShortcuts(next);
  };

  return (
    <div className="settings-shortcuts">
      <div className="settings-section">
        <h3>Keyboard Shortcuts</h3>
        <p className="subtle">
          Click a shortcut, press the new key combination, or press Delete to clear it. Reusing a
          shortcut moves it to the new action.
        </p>
        <div className="row" style={{ marginBottom: 14 }}>
          <button className="small" onClick={() => saveShortcuts({})}>
            Reset all
          </button>
        </div>

        {groups.map((group) => (
          <div key={group} className="shortcut-group">
            <h4>{group}</h4>
            <div className="shortcut-list">
              {SHORTCUT_CATALOG.filter((s) => s.group === group).map((action) => {
                const binding = effective[action.id];
                const customized = Object.hasOwn(overrides, action.id);
                const defaultBinding = DEFAULT_SHORTCUTS[action.id];
                const conflict = shortcutConflict(action.id, binding, effective);
                return (
                  <div key={action.id} className="shortcut-row">
                    <div className="shortcut-copy">
                      <div className="row" style={{ gap: 6 }}>
                        <strong>{action.label}</strong>
                        {customized && <Badge color="gray">custom</Badge>}
                      </div>
                      <div className="desc">{action.description}</div>
                    </div>
                    <ShortcutRecorder
                      action={action}
                      binding={binding}
                      conflict={conflict}
                      onChange={(next) => assign(action.id, next)}
                      onReset={() => reset(action.id)}
                    />
                    <div className="shortcut-default">
                      default: <code>{formatShortcut(defaultBinding)}</code>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Switch / reconfigure the active ACP harness; verify and re-source models. */
function HarnessSettings({
  global,
  save,
}: {
  global: GlobalConfig;
  save: (cfg: GlobalConfig) => Promise<void>;
}) {
  const cur = activeHarness(global);
  const templates = harnessTemplates(global.cursorBinary);
  const [id, setId] = useState(cur.id);
  const [command, setCommand] = useState(cur.command);
  const [args, setArgs] = useState(cur.args.join(" "));
  const [state, setState] = useState<null | "verifying" | "saving" | { ok: boolean; msg: string }>(null);
  const picked = templates.find((t) => t.id === id);

  const select = (tid: string) => {
    setId(tid);
    const t = templates.find((x) => x.id === tid);
    if (t) {
      setCommand(t.command);
      setArgs(t.args.join(" "));
    }
    setState(null);
  };
  const harness = () => ({
    id,
    name: picked?.name ?? id,
    command: command.trim(),
    args: args.trim() ? args.trim().split(/\s+/) : [],
    note: picked?.note,
  });

  const verify = async () => {
    setState("verifying");
    const h = harness();
    const r = await probeHarness(h.command, h.args, await native.appDataDir());
    setState({ ok: r.ok, msg: summarizeProbe(r) });
  };
  const apply = async () => {
    setState("saving");
    const h = harness();
    // snapshot the current harness's selections and restore this one's (or a
    // clean seed); refreshModels then sources the live list and reconciles
    // the remembered default against it
    await save(switchHarness(global, h));
    await refreshModels(useGlobalConfig.getState().config!, save);
    setState({ ok: true, msg: "saved — models refreshed from this harness" });
  };

  return (
    <>
      <p className="subtle" style={{ maxWidth: "76ch" }}>
        Charon drives a coding agent over Agent Client Protocol. cursor and opencode are verified;
        Claude Code uses Zed's adapter; Codex needs an ACP bridge. Switch agents without touching
        the rest of the app.
      </p>
      <div className="seg" style={{ marginBottom: 8, flexWrap: "wrap" }}>
        {templates.map((t) => (
          <button key={t.id} className={`small ${id === t.id ? "primary" : ""}`} onClick={() => select(t.id)}>
            {t.name}
            {t.verified ? " ✓" : ""}
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <input
          type="text"
          value={command}
          onChange={(e) => { setCommand(e.target.value); setState(null); }}
          placeholder="command"
          style={{ flex: "0 0 38%" }}
        />
        <input
          type="text"
          value={args}
          onChange={(e) => { setArgs(e.target.value); setState(null); }}
          placeholder="args"
          style={{ flex: 1 }}
        />
      </div>
      {picked?.note && <small style={{ display: "block", color: "var(--fg-subtle)", marginTop: 5 }}>{picked.note}</small>}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="small" disabled={state === "verifying" || !command.trim()} onClick={() => void verify()}>
          {state === "verifying" ? <Spinner /> : null} Verify
        </button>
        <button className="small primary" disabled={state === "saving" || !command.trim()} onClick={() => void apply()}>
          {state === "saving" ? <Spinner /> : null} Save &amp; use
        </button>
        {state && typeof state === "object" && (
          <span style={{ color: state.ok ? "var(--acid)" : "var(--red)", fontSize: 12 }}>
            {state.ok ? "✓ " : "✗ "}
            {state.msg}
          </span>
        )}
      </div>
    </>
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

  // merge a partial onto the resolved handler so toggling one field (model,
  // enabled, prompt) doesn't drop the others; this pins the event to an override
  const setHandler = (id: string, patch: Partial<EventHandlerConfig>) => {
    const current = resolveHandler(config.events, id);
    update({ events: { ...config.events, [id]: { ...current, ...patch } } });
  };

  return (
    <>
      {groups.map((g) => (
        <div key={g} id={groupId(g)}>
          <h4>{g}</h4>
          {EVENT_CATALOG.filter((e) => e.group === g).map((def) => {
            const handler = resolveHandler(config.events, def.id);
            const isDefault =
              handler.enabled === def.defaultEnabled &&
              handler.prompt === def.defaultPrompt &&
              !handler.model;
            return (
              <div key={def.id} className="event-row">
                <div className="row between">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={handler.enabled}
                      onChange={(e) => setHandler(def.id, { enabled: e.target.checked })}
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
                  onChange={(prompt) => setHandler(def.id, { prompt })}
                />
                <div className="row" style={{ marginTop: 6 }}>
                  <span className="subtle" style={{ fontSize: 12 }}>
                    runs with
                  </span>
                  <ModelPicker
                    value={handler.model ?? ""}
                    onChange={(model) => setHandler(def.id, { model })}
                    flowKind={eventFlowKind(def.id)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
