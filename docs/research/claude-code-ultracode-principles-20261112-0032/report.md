# Claude Code "ultracode" — Principles Research
**For:** designing a desktop AI agent product whose "EVA mode" must faithfully mirror ultracode, and whose base mode ("Norma") must remain strong.
**Research date:** 2026-11-12. All official pages below were read live via `browser_open` on that date unless marked "index only".
**Confidence key:** `verified live` = read on the official page in this run; `index` = search-result text only; `second-hand` = reputable technical writeup quoting/citing official docs, not re-read in full.

## Summary — the one-paragraph answer

Ultracode is **not a model, not an effort level, and not a slash command**. It is a Claude Code **setting/toggle** that turns on *automatic* dynamic-workflow orchestration for a session: with it on, Claude plans a workflow for each substantive task instead of waiting to be asked. A dynamic workflow is a **plain-JavaScript orchestration script Claude writes for the task, executed in the background by a runtime**; the script spawns many subagents (`agent()`), fans them out (`parallel()` = run-all-and-wait, `pipeline()` = each item flows through stages independently), groups them into phases, holds intermediate results in script variables (so only the final answer lands in Claude's context), and can apply a repeatable quality pattern — independent agents adversarially reviewing/refuting each other's findings, drafting from several angles, voting on claims — before anything is reported. It shipped **28 May 2026 in Claude Code v2.1.154 alongside Claude Opus 4.8**; since **v2.1.284 (28 Sep 2026)** it is its own toggle independent of effort level (before that it forced `xhigh`). **Agent teams are a different, separate mechanism** (lead + peer Claude Code sessions, shared task list, direct messaging) — ultracode/workflows orchestrate *subagents via a script*, not agent teams. Base Claude Code without ultracode is already a full agentic loop (gather → act → verify) with effort levels, `ultrathink`, skills, MCP, subagents, plan mode, permissions, sandbox, and checkpoints/rewind — ultracode adds *scale, codified orchestration, and systematic verification*, not basic competence.

> **Design implication (inference, not an Anthropic claim):** EVA should mirror ultracode as *a session-level auto-orchestration switch + a per-task keyword*, layered on top of a strong Norma — not as a "smarter model" or a separate agent. The faithful primitives to copy are: (1) LLM-authored orchestration script, (2) `parallel` (barrier) vs `pipeline` (streaming, no barrier) vs sequential `await`, (3) script-variable intermediate state, (4) adversarial verification / voting as a first-class pattern, (5) explicit caps, size guidelines, approval, pause/resume, and per-agent progress — with costs made visible.

---

## 1. What exactly is ultracode (introduction, enabling, toggle/keyword/mode, vs base)

### 1.1 Definition — current wording
- Current official definition (Model configuration docs, quoted verbatim in secondary sources that cite it; workflows docs state the same in prose): **"Ultracode is a Claude Code setting rather than a model effort level: with it on, Claude orchestrates dynamic workflows for substantive tasks, at whichever effort level the session runs at."** — `verified live` (workflows doc) + `second-hand` (exact model-config quote via DigIntoAI / claudefa.st).
- Original (launch) definition, now superseded: "it sends `xhigh` to the model and additionally has Claude orchestrate dynamic workflows for substantive tasks. It applies to the current session only." — `second-hand` (FindSkill / QualityLayer quoting the pre-v2.1.284 docs). The Anthropic launch announcement (28 May 2026) likewise said ultracode "sets the effort level to xhigh, while letting Claude decide automatically when to use a workflow" — `verified live`, but **that sentence describes launch behaviour, not current behaviour**.
- A dynamic workflow itself: "A dynamic workflow is a JavaScript script that orchestrates many subagents at once. Claude writes the script for the task you describe, and a runtime executes it in the background while your session stays responsive." — official workflows docs, `verified live`.

### 1.2 Timeline
| Date / version | Event | Source / confidence |
|---|---|---|
| 5 Feb 2026, Claude Code v2.1.32 | **Agent teams** ship as research preview alongside Opus 4.6 — *separate* from ultracode | `second-hand` (Anthropic Opus 4.6 announcement via mirror; Zircote) |
| **28 May 2026, Claude Code v2.1.154** | **Dynamic workflows + ultracode ship**, alongside Claude Opus 4.8 | `verified live` (Anthropic announcement, published 2026-05-28; workflows docs) |
| 2 Jun 2026, v2.1.160 | Trigger keyword renamed from `workflow` to `ultracode` (breaking change); keyword highlighted in violet in input | `second-hand` (DevelopersDigest, Rabinarayan Patra, GitHub ultimate-guide — multiple agreeing) |
| v2.1.203 | `claude --effort ultracode` launch flag supported | `second-hand` (DigIntoAI) |
| v2.1.269 | `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` env var (1–256) | `verified live` (workflows docs) |
| **28 Sep 2026, v2.1.284** | **Ultracode becomes its own toggle in `/effort` (Tab, or `/effort ultracode [on\|off]`): no longer forces xhigh, stays on at any effort level**; `/effort ultracode off` starts working (previously failed `Invalid argument`) | `verified live` (workflows docs) + `second-hand` (changelog quote in ClaudeWorld / claudefa.st) |
| Later (undated on page) | Announcement page updated: "Dynamic workflows are now generally available" (was research preview at launch) | `verified live` (announcement page; **GA date not stated — unverified**) |

### 1.3 How it is enabled — three distinct entry points (do not conflate)
1. **Per-task keyword:** type the literal word `ultracode` anywhere in a prompt you type yourself. Claude writes a workflow script for *that task only*, without changing the session's effort level. The keyword is highlighted in the input. Dismiss for that prompt with `Option+W` (macOS) / `Alt+W` (Win/Linux) or Backspace right after it; disable the trigger entirely via "Ultracode keyword trigger" in `/config` (`workflowKeywordTriggerEnabled: false`). — `verified live`.
   - Keyword works **only** for human-typed input: interactive prompt, IDE extension panel, Remote Control client, or an Agent SDK app stamping keyboard input `origin: {kind: "human"}`. It does **not** trigger from `-p`, SDK-sent (non-human) prompts, scheduled tasks, or webhook/PR-comment relayed prompts. — `verified live`.
   - Asking in your own words ("use a workflow" / "run a workflow") also works — Claude treats a direct request as the same opt-in. — `verified live`.
2. **Session setting (`/effort ultracode`):** "Ultracode is a Claude Code setting that turns on automatic workflow orchestration for the session, at whichever effort level the session runs at. With it on, Claude plans a workflow for each substantive task instead of waiting for you to ask." Turn on in-session; `/effort ultracode off` turns it off (v2.1.284+). In the `/effort` slider, press `Tab` to flip the **Ultracode** toggle, then `Enter`. In VS Code, an **Ultracode** switch appears under the Effort row (v2.1.284+); while on, the model button shows `· Ultracode`. — `verified live`.
3. **Launch / persistent:** `claude --effort ultracode` starts a session with ultracode on **and** sets effort to `xhigh` (the one remaining route that still couples the two). To have *every* session start with it, set `"ultracode": true` in settings (any settings file; Claude reads it but never writes it; `/effort ultracode` is per-session only). The persisted `effortLevel` setting and `CLAUDE_CODE_EFFORT_LEVEL` env var do **not** accept `ultracode`. — `verified live` (workflows + settings docs via search) / `second-hand` for env-var detail.
- **There is no `/ultracode` slash command in the official docs.** Social-media claims of "/ultracode spins up 100 agents" are promotional and unreliable — see §6 / Could not verify.

### 1.4 Availability gates
- Requires Claude Code v2.1.154+; workflows on by default for Max, Ultra, Team, Enterprise and via API; Pro users enable in `/config`. Available on all paid plans, Anthropic API, Amazon Bedrock, Google Cloud Agent Platform / Vertex AI, Microsoft Foundry; in CLI, Desktop, IDE extensions, `claude -p`, Agent SDK. — `verified live` (announcement + workflows docs).
- Ultracode toggle appears **only when workflows are enabled and the model supports `xhigh`**. Models without `xhigh` (Opus 4.6, Sonnet 4.6, Sonnet 4.5, Haiku 4.5 per secondary model matrix) do not offer it. Turning workflows off (`/config` toggle, `"disableWorkflows": true`, or `CLAUDE_CODE_DISABLE_WORKFLOWS=1`) removes the toggle and disables the keyword; a run already in progress keeps going. An org effort cap below `xhigh` lowers the effort level but does **not** turn ultracode off (post-v2.1.284). — `verified live` (workflows docs) + `second-hand` (model list).
- Effort levels themselves are separate: `low, medium, high, xhigh, max`. `xhigh` = "Deeper reasoning at higher token spend"; `max` = deepest reasoning, session-only, no token cap (per secondary guides). Defaults vary by model (e.g. Opus 5.5/Sonnet 5.5/Haiku 5.5 default `medium`; Opus 4.8 default `high`) — `second-hand`, model matrix not fully re-read in this run.

### 1.5 What it changes versus base Claude Code
| Dimension | Base (no ultracode) | With ultracode on |
|---|---|---|
| Who holds the plan | Claude, turn by turn; every result goes into its context window | **The script** — plan, loop, branching, intermediate results live in script variables; Claude's context holds only the final answer |
| Scale | A few delegated subagents per turn | Dozens to hundreds of agents per run (see caps §4) |
| Repeatability | Worker definition / instructions repeatable | **The orchestration itself is repeatable** — script can be read, diffed, edited, saved as a command (`/<name>`), rerun |
| Quality pattern | Single-pass + loop verify (see §5) | Repeatable verification pattern: independent agents adversarially review each other's findings, or draft a plan from several angles and weigh them |
| Interruption | Restarts the turn | Resumable in the same session (completed agents return cached results) |
| User input mid-run | Conversational, interruptible | **No mid-run user input** — run pauses only for permission prompts / usage-limit waits |
| Cost / time | Baseline | Each request uses more tokens and takes longer; subscription limits reached sooner |
| Safeguards | Large-workflow warning, 20-concurrent-subagent limit, first-launch approval in auto mode | **All three switched off** — turning ultracode on is treated as consent to large runs (§4) |

Sources: official workflows docs comparison table + "A workflow moves the plan into code" + ultracode section, `verified live`.

---

## 2. Task decomposition, parallel vs sequential, dynamic orchestration

### 2.1 The decomposition step — LLM-authored, not a published scheduler
- Launch announcement: "When a workflow kicks off, Claude plans dynamically based on your prompt, breaks it into subtasks, and fans the work out across subagents running in parallel. Results are checked before they're folded in, and you come back to a single, coordinated answer." — `verified live`.
- Workflows docs: "Reach for a workflow when a task needs more agents than one conversation can coordinate, or when you want the orchestration codified as a script you can read and rerun. Examples include a codebase-wide bug sweep, a 500-file migration, a research question that needs sources cross-checked against each other, and a hard plan worth drafting from several independent angles before you commit to one." — `verified live`.
- **No deterministic decomposition algorithm is published.** The docs do not state a rule (e.g. dependency-graph analysis, a threshold, or a classifier) by which Claude decides what is parallelisable. The decision is embodied in the script Claude writes. **Flag for EVA design:** any claim of a specific "parallelism detector" in Claude Code would be invention; the faithful mirror is *LLM-planned decomposition expressed as code*, plus the primitives below. — *assessment based on absence in official docs read in full (workflows page, 540 lines).*

### 2.2 The orchestration primitives (the actual mechanism)
The script is plain JavaScript with top-level `await`, starting with a pure-literal `export const meta = { name, description, phases }`. — `verified live`.

| Primitive | Semantics | Parallel vs sequential implication |
|---|---|---|
| `agent(prompt, opts)` | Spawn **one** subagent. `opts` may include `label`, `phase`, `schema` (JSON Schema → validated object return, checked before start; 5 validation attempts, then error), `model`, `effort`, `agentType`, `isolation: 'worktree'` (own git worktree for parallel file edits), `stallMs`. Resolves to `null` if stopped mid-run or on unrecoverable API error. | The unit of work; sequential if `await`ed directly |
| `parallel([thunks])` | Run a set of agent tasks **at the same time and wait for all of them** — a barrier. Failed thunks resolve to `null`. Up to 4,096 items per call (runtime rejects longer lists). | Use when stage N needs *every* result from stage N−1 at once (e.g. dedup/rank pass) |
| `pipeline(items, stage1, stage2, …)` | Run one agent per item through a sequence of stages; **each item flows through stages independently — no barrier between stages** (item A can be in stage 3 while item B is still in stage 1). Keeps `null`s in results array. | **Default choice for multi-stage work** (per secondary guides synthesising the docs); streaming parallelism |
| `phase(title)` | Group following agents under a title in the progress view (observability only) | — |
| `log(msg)` | Show a message above the phases | — |
| `args` global | Structured input passed to a saved workflow (`args` parameter) | — |

- Determinism for resume: `Date.now()`, `Math.random()`, and no-arg `new Date()` **throw** inside a script, so a relaunched run repeats the same `agent()` calls. No `import()` — a script containing it fails before the run starts; no direct filesystem/shell access from the script itself (agents do that). — `verified live`.
- The runtime executes the script in an **isolated environment, separate from the conversation**; it tracks each agent's result as the run progresses, which is what makes a run resumable. The run's script is written to a file under the session's directory in `~/.claude/projects/`; Claude receives its path, so the user can ask for it, open/read/diff/edit it and ask Claude to relaunch from the edited version. — `verified live`.
- Prompt-cache efficiency in fan-out: agents in the same run sharing model/effort/agent-type/tools/schema/working-directory build the same tools-and-system-prompt prefix, so a later agent reads the sibling's cache on its first request; Claude Code holds all but the first matching agent until the first agent's response begins (cap `CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS`, default 5000 ms; `0` disables). Workflow agents' cache holds 5 min by default (`subagentPromptCacheTtl: 1h` option, API bills 1h writes higher). — `verified live`.

### 2.3 Canonical workflow shapes (official examples)
- **Audit many files:** fan out one agent per file, then collect and verify findings.
- **Keep fixing until a check passes:** run checker → fix failures → repeat until it passes or stops making progress.
- **Migrate many files in parallel:** discover files → transform each in an **isolated copy so edits don't conflict** → verify each result.
- **Review every changed file, write one summary:** reviewer per file → one agent ranks and deduplicates all findings.
- **Research across many sources:** fan out readers across changelogs/issues/docs → synthesize (bundled `/deep-research` does this).
- **Find issues until the list stops growing:** keep searching in rounds, stop when new rounds turn up nothing new.
— `verified live` (workflows docs, "Example workflow prompts").

### 2.4 Chained workflows
"With ultracode on, Claude decides when a task warrants a workflow. A single request can turn into several workflows in a row: one to understand the code, one to make the change, and one to verify it." — `verified live`. This is the closest the docs come to "dynamic" replanning across a request: sequencing is by launching successive workflows, not by the script mutating itself mid-run.

### 2.5 Size guidance (soft control, not a cap)
A size guideline tells Claude how many agents to aim for when it writes a workflow; it is sent as **advice, not a cap**, so a prompt calling for a different scale overrides it: `small` <5, `medium` <10, `large` <50, `unrestricted` no guideline. Default `medium`, or `small` on Pro (v2.1.271+). Set in `/config` (`workflowSizeGuideline`) — a settings-file value takes precedence. Runtime caps still apply regardless. — `verified live`.

---

## 3. Agent teams — and how they differ from ultracode workflows

**Critical distinction for EVA:** the official docs treat these as *different mechanisms in the same comparison table* (§1.5). Ultracode = workflows = **script-orchestrated subagents**. Agent teams = **peer Claude Code sessions coordinated by a lead**. Do not merge them in the product model; a faithful EVA mirrors workflows, and may *optionally* also offer teams as a separate mode.

### 3.1 What agent teams are
- "Agent teams let you coordinate multiple Claude Code instances working together. One session acts as the team lead, coordinating work, assigning tasks, and synthesizing results. Teammates work independently, each in its own context window, and communicate directly with each other. You can also talk to any teammate directly without going through the lead." — `verified live`.
- Introduced **5 Feb 2026, Claude Code v2.1.32, as a research preview alongside Opus 4.6**; still described as experimental in the docs. Disabled by default; enable with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. — `verified live` (docs: disabled by default + flag) + `second-hand` (date/version).
- Enabling changes ordinary delegation: a subagent Claude *names* launches as a teammate while teams are enabled, so teams can form even when not asked for; spawning teammates requires an interactive session (in `-p` / Agent SDK they run as ordinary subagents). — `verified live`.

### 3.2 Architecture / communication
| Component | Role |
|---|---|
| Team lead | Main session; spawns teammates, coordinates work |
| Teammates | Separate Claude Code instances, each on assigned tasks |
| Task list | Shared list of work items teammates claim and complete |
| Mailbox | Messaging system between agents |

- **Mailbox:** each agent's mailbox is a JSON file at `~/.claude/teams/{team-name}/inboxes/{agent-name}.json`. Claude Code validates every entry on read; entries not matching the message format are reported as errors and removed, valid messages still delivered. A message is reported as sent only when the write to the recipient's mailbox succeeds; on write failure (e.g. disk full) the sender gets an error and nothing is sent. — `verified live`.
- **Shared task list:** tasks are pending / in progress / completed, can depend on other tasks (shown blocked until dependencies complete; teammates don't self-claim blocked tasks, but lead/user can assign them). Claiming uses **file locking** to prevent race conditions when multiple teammates claim simultaneously. Dependencies auto-unblock on completion. Lead assigns explicitly or teammates self-claim the next unassigned, unblocked task after finishing one. — `verified live`.
- **Communication:** automatic message delivery (lead doesn't poll); **idle notifications** — a teammate finishing notifies the lead including its final answer; a teammate whose turn ends on an API error notifies the lead it failed, including the error text. Teammates message each other by name (one message per recipient to reach everyone). Each teammate loads the same project context (CLAUDE.md, MCP, skills) but **does not inherit the lead's conversation history** — only the spawn prompt. — `verified live`.
- **Models:** per-teammate model picked in order: model named in spawn prompt → subagent definition's `model` (`inherit` = lead's) → `CLAUDE_CODE_SUBAGENT_MODEL` (if not `inherit`) → lead's current model; org `availableModels` allowlist substitution applies. A teammate on the lead's model inherits the lead's effort level. — `verified live`.
- **Display:** in-process (all teammates inside main terminal; arrow keys select, Enter views/messages, `x` stops, `Ctrl+T` task list) or split panes (own pane each; requires tmux or iTerm2 + `it2` CLI; not supported in VS Code integrated terminal, Windows Terminal, Ghostty). Idle rows hide 30 s after the whole panel goes idle; >3 idle collapse into "`N idle agents`". — `verified live`.

### 3.3 Cross-checking, disagreement, error resolution
- **In workflows (ultracode):** verification is a *script pattern*, not a built-in consensus protocol: "independent agents adversarially review each other's findings before they're reported, or draft a plan from several angles and weigh them against each other, so you get a more trustworthy result than a single pass." The announcement: "Agents address the problem from independent angles, other agents try to refute what they found, and the run keeps iterating until the answers converge." The bundled `/deep-research` workflow "votes on each claim" and filters out claims that didn't survive cross-checking. Loop-until patterns (fix until check passes; search until no new findings) provide convergence by termination condition. — `verified live`.
- **In agent teams:** the mechanism is *discussion + lead synthesis*: strongest use cases are "research and review: multiple teammates can investigate different aspects simultaneously, then share and challenge each other's findings" and "debugging with competing hypotheses: teammates test different theories in parallel and converge on the answer faster" — explicitly adversarial ("each one's job is not only to investigate its own theory but to challenge the others'"), with the note that sequential investigation suffers from anchoring and parallel refutation makes the surviving theory more likely correct. The lead synthesizes findings when finished. — `verified live`.
- **No formal voting / quorum / conflict-resolution algorithm is documented** for either mechanism in general. There is no documented "majority wins" or "lead arbitrates by rule" procedure; convergence is by script logic (filter/dedup/rank, refutation, loop-until-pass) or by the lead's synthesis judgement. **Flag as a gap:** EVA must *choose* an explicit disagreement policy (e.g. refute-and-filter, vote, lead-arbitrates, escalate to user) — Anthropic does not publish one. — *assessment.*
- **Quality gates via hooks (teams):** `TeammateIdle`, `TaskCreated`, `TaskCompleted` hooks can exit code 2 to send feedback / prevent creation / prevent completion. — `verified live`.
- **Plan approval (teams):** a teammate spawned while the lead is in plan mode works in plan mode until its plan is ready, then sends a plan-approval request to the lead; if the teammate's permission mode is unchanged, Claude Code approves it as soon as it arrives *without the lead reviewing it*; if the user put the teammate in plan mode via `Shift+Tab`, the lead reviews it or sends it back for revision. — `verified live`.
- **Trust boundaries (teams):** a teammate cannot approve a permission prompt or supply consent on the user's behalf, and a denied action cannot be relayed to another teammate to bypass the check. In auto mode the classifier treats an approval claim relayed from another agent as untrusted input, reviews each inter-agent message before delivery, and a blocked message never reaches the recipient. Teammate permission prompts appear in the lead session. — `verified live`.
- **Failure handling (teams):** teammates may stop after errors instead of recovering — check output, give instructions directly, or spawn a replacement; a message from the lead/teammate wakes an in-process teammate waiting to retry a failed API request, so it retries immediately; the lead can also stop early, deciding the team is finished before all tasks are complete (tell it to keep going). Task status can lag (teammates fail to mark tasks complete, blocking dependents — update manually or nudge). — `verified live`.
- **Failure handling (workflows):** see §4.3.
- **Teams limitations:** no session resumption with in-process teammates (`/resume`, `/rewind` do not restore them); one team per session; no nested teams (teammates cannot spawn teammates; only the lead manages the team); lead fixed for its lifetime; no per-teammate permission modes at spawn; no background subagents from in-process teammates; shutdown can be slow (teammates finish current request/tool call first). Token cost scales linearly with teammates; start with 3–5 teammates; avoid same-file edits (overwrites — each teammate should own different files). — `verified live`.

---

## 4. Automatic vs on-request engagement, triggers, costs, limits

### 4.1 When it engages
| Trigger | Scope | Source |
|---|---|---|
| Keyword `ultracode` in a typed prompt | That one task | `verified live` |
| "Use/run a workflow" in own words | That one task | `verified live` |
| `/effort ultracode` / toggle / `"ultracode": true` | **Every substantive task in the session** — Claude decides per task whether it warrants a workflow | `verified live` |
| Bundled `/deep-research <question>` | That one invocation only ("runs only when you invoke it") | `verified live` |
| Saved workflow as `/<name>` command | That invocation; same orchestration each time | `verified live` |

- **"Substantive" is not defined with a threshold in the docs.** No token count, file count, or complexity score is published for when Claude judges a task warrants a workflow. **Flag as unverified/vague** — EVA needs its own explicit trigger policy (or must accept the same LLM-judgement opacity).
- With ultracode on, a single request can turn into several workflows in a row (understand → change → verify). — `verified live`.

### 4.2 Approval / consent
- First workflow trigger: Claude Code shows what's about to run and asks to confirm (announcement). Per-run CLI prompt: Yes / Yes-and-don't-ask-again (bundled/saved/plugin workflows only) / View raw script / No; `Ctrl+G` opens script in editor. Auto mode: first launch only; **skipped entirely when ultracode is on**. Manual / accept-edits: every run unless don't-ask-again. Bypass: no prompt. `-p` / Agent SDK: no prompt; permission rules / auto mode / bypass / `PreToolUse` hook / `canUseTool` govern. Desktop: approval card (name, phase list, token-usage caution; Once / Always / Deny). — `verified live`.
- Workflow agents' tool calls receive the **same permission checks and sandboxing** as any other tool call in the session. — `verified live`.

### 4.3 Costs
- Official language is qualitative, **no general multiplier is published**: "A workflow spawns many agents, so a single run can use meaningfully more tokens than working through the same task in conversation. Runs count toward your plan's usage and rate limits." / "Dynamic workflows can consume substantially more tokens than a typical Claude Code session, so we recommend starting on a scoped task." Advice: gauge spend on a small slice first (one directory, narrow question). — `verified live`.
- On subscriptions, ultracode sessions reach session/weekly limits sooner; each request uses more tokens and takes longer. — `verified live`.
- Agent teams likewise "use significantly more tokens than a single session… token usage scales with the number of active teammates" (linearly, per teammate's own context window). — `verified live`.
- **Anecdotal cost figures circulating online are unverified and must not be used as benchmarks:** e.g. "62M tokens in 24h / $2,500 budget in a day" (CodeWithSeb, second-hand report), "160 agents, 3h12m, 11.4M tokens" (EchoFold, single run), "$20,000 for 16 agents building a C compiler" (NxCode, agent teams). See Could not verify.

### 4.4 Limits and failure modes (workflows)
| Limit / behaviour | Value | Source |
|---|---|---|
| Concurrent agents | **16 by default**, fewer with fewer CPUs (incl. CPU-limited containers); `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` 1–256 (v2.1.269+) | `verified live` |
| Total agents per run | **1,000** (runaway-loop backstop) | `verified live` |
| Items per `parallel()`/`pipeline()` call | **4,096** (runtime rejects longer with error, rather than silently dropping work) | `verified live` |
| Size guideline (advice) | small <5, medium <10, large <50, unrestricted | `verified live` |
| Large-workflow warning | >25 agents **or** projected total >1.5M tokens → warning on progress line, advisory only (does not pause/limit); size guideline replaces the 25 threshold; **not shown when ultracode is on** | `verified live` |
| No mid-run user input | Run pauses on its own only for agent permission prompts and usage-limit waits; for sign-off between stages, run each stage as its own workflow | `verified live` |
| Agent failure inside `parallel()`/`pipeline()` | Run carries on with `null` in place of that agent's result | `verified live` |
| Agent failure when awaited directly | Run ends with the error | `verified live` |
| Stalled agent | Auto-restarts from same prompt (new attempt, no stalled transcript; files already changed stay changed; tokens spent stay in total); `(retry N)` suffix; max **5 restarts / 6 attempts**, then `agent()` fails (`agent stalled on all 6 attempts` / `agent lost its reply…` / `agent abandoned after 6 attempts`); per-agent `stallMs`, global `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS` | `verified live` |
| Usage-limit hit | Run **pauses** rather than failing (v2.1.271+; Desktop Code tab v2.1.319+); waiting agents retry shortly after reset, no new agents start; only if subscription without usage-based billing, interactive terminal / local Code-tab session, `autoContinueAtUsageLimit` on, reset within 24 h, and not already waited twice (3rd hit fails). Otherwise the agent fails. | `verified live` |
| Resume after pause/stop | Completed agents return saved results; first agent whose prompt differs (edited script / different earlier result) runs again **plus every agent after it**; still-running-when-stopped starts over; failed runs again plus all after it; stopping one agent alone counts as failing it | `verified live` |
| Leaving the session | Run does **not** continue on its own; Claude must relaunch it via a `Workflow` call replaying saved results (background session / `claude --resume`); if saved results can't be found, relaunch fails `nothing to resume` — start over as a new run | `verified live` |
| Schema validation | Schema checked before subagent starts (provable contradiction fails fast, subagent never starts); output failing validation after 5 attempts fails with last validation error (`MAX_STRUCTURED_OUTPUT_RETRIES`) | `verified live` |
| Wrong tool for the job | Workflows are wrong for narrow/sequential tasks — spawning many agents for a one-file change burns tokens for no benefit | `second-hand` (APIDog, consistent with official "when to use" guidance) |

### 4.5 What turning ultracode on silently disables
Because turning it on is treated as consent to large runs, these checks **don't apply while it's on**: (1) the `Large workflow` warning; (2) the session's concurrent-subagent limit for subagents Claude spawns with the Agent tool; (3) in auto permission mode, being asked to approve the first workflow launch. The runtime's own caps (1,000 agents etc.) still apply. — `verified live`.

---

## 5. What base Claude Code already does well without ultracode

Base is **not** a weak mode. The following all work without ultracode, and ultracode *presupposes* them (workflow agents use the same permissions/sandboxing; the workflow runtime is an addition to, not a replacement for, the loop).

### 5.1 The agentic loop (core)
- Three phases — **gather context, take action, verify results** — blending and repeating; Claude chains dozens of actions, course-corrects from what it learns, and the user can interrupt at any point (Esc stops; queued corrections are read mid-turn). "Claude Code is the layer around the model that provides the tools and manages the context the model sees" (the "agentic harness"). — `verified live` (How Claude Code works).
- Tools: file operations, search (pattern/regex/codebase exploration), execution (shell, servers, tests, git), web (search/fetch docs), code intelligence (type errors after edits, jump to definition — requires plugins), plus spawning subagents and asking the user questions. — `verified live`.

### 5.2 Thinking / effort (without ultracode)
- Effort levels `low / medium / high / xhigh / max` steer adaptive reasoning per step; per-model defaults; `max` is deepest, session-only. — `verified live` + `second-hand` (matrix).
- **`ultrathink` keyword:** one-turn deeper reasoning without changing the session level; since v2.1.311, typing it in the terminal prompt can also raise that turn to `xhigh` on Opus 5.5 / Sonnet 5.5 / Haiku 5.5 / Fable 5.1 via Anthropic's API (rainbow highlight; saved level unchanged). — `second-hand` (DevelopersDigest / ClaudeWorld quoting changelog + model-config docs).
- Fable models (most capable, long autonomous sessions) "investigate before acting, and verify their work more often than smaller models" — a base-model property, not an ultracode property. — `verified live` (model-config, Fable section).

### 5.3 Skills, MCP, hooks, memory
- **Skills:** on-demand playbooks (incl. bundled `/workflow-authoring` skill for editing workflow scripts, v2.1.248+); descriptions visible at start, full content loads only when used (`disable-model-invocation` keeps descriptions out until needed); up to six skills chainable in one message. — `verified live` (how-it-works + workflows docs) / `index` (commands doc snippet for chaining).
- **MCP:** connect external services as tools (`.mcp.json`); tool definitions **deferred by default, loaded on demand via tool search** — only names + server instructions consume context until a tool is used. — `verified live`.
- **Hooks:** automate workflows / enforce rules (incl. `PreToolUse`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`). — `verified live` (workflows + agent-teams docs).
- **Memory:** `CLAUDE.md` project instructions, auto-memory (`MEMORY.md`, first 200 lines / 25 KB loaded per session), sessions saved as plaintext JSONL under `~/.claude/projects/`. — `verified live`.

### 5.4 Subagents (base delegation — the worker primitive workflows orchestrate)
- The `Agent` tool spawns a subagent in a **separate context window**; it works autonomously and returns its result to the parent, which does **not** see its intermediate tool calls/outputs — only the final result. Custom subagents have a custom system prompt, specific tool access, independent permissions, `maxTurns` cap; built-in **Explore** and **Plan** subagents are read-only (Write/Edit denied) and start without CLAUDE.md/git snapshot for speed. Claude delegates based on each subagent's description. — `verified live` (how-it-works) + `index` (subagents/tools docs).
- Base scale: "a few delegated tasks per turn" (workflows comparison table). — `verified live`.

### 5.5 Plan mode / review
- **Plan mode** (permission mode): Claude explores and proposes a plan without editing source files; plan can be reviewed/edited (`Ctrl+G` opens it in `$EDITOR`) before approval into a chosen mode. Teammates spawned in plan mode also plan first (see §3.3). — `verified live`.
- Verification is already in the base loop ("verify results" phase; bug-fix example: run tests → read errors → fix → re-run tests). — `verified live`.

### 5.6 Permissions / sandbox / checkpoints
- **Permission modes** (`Shift+Tab` to cycle): **Auto** — classifier reviews most actions in background, blocks risky ones (built-in starting mode v2.1.283+ for interactive terminal/VS Code; earlier only Pro/Max/Ultra/Team); **Manual** — asks before file edits and shell commands; **Accept edits** — edits + common filesystem commands without asking, still asks for other commands; **Plan** — read-only proposal; plus **Bypass** / `dontAsk` variants. Allow/ask/deny rules in settings, scoped org → personal; read-only commands (e.g. `ls`, `cat`, `git status`) run without asking. — `verified live` (how-it-works) + `index` (security doc snippet).
- **Sandbox:** OS-enforced boundary around **shell commands only** (Bash/PowerShell/Monitor + children); filesystem + network-domain limits; macOS Seatbelt, Linux/WSL2 bubblewrap+socat; off by default (`/sandbox` or `sandbox.enabled: true`); file tools, MCP servers, and hooks run **outside** it; native Windows unsandboxed. A separate **sandbox runtime** (`@anthropic-ai/sandbox-runtime`, beta research preview) wraps the whole process including file tools/MCP/hooks. — `index` (official sandboxing/security docs, search text — *not* full-page verified in this run).
- **Checkpoints / rewind:** "File edits are reversible. Before Claude edits a file, it snapshots the current contents. If something goes wrong, press `Esc` twice to rewind to a previous state, or ask Claude to undo." Checkpoints are separate from git, survive resume, cover **only file changes** (skip symlinked/hard-linked files); remote actions (databases, APIs, deployments) cannot be checkpointed — control those with permission mode/rules. `/rewind` rolls code + conversation back to a checkpoint (or forks/summarises). Sessions can be resumed (`--continue`/`--resume`, same ID) or forked (`--fork-session`/`/branch`, new ID). — `verified live` (how-it-works) + `index` (commands doc for `/rewind` detail).

### 5.7 What stays in base — the "Norma must remain strong" list
For EVA/Norma parity, these must **not** be gated behind EVA: the gather→act→verify loop, effort levels + `ultrathink`, skills, MCP (deferred tool loading), subagents, plan mode, permission modes + allow/ask/deny rules, sandbox, checkpoints/rewind/resume/fork, context management (auto-compaction, `/context`), interrupt-and-steer, CLAUDE.md/memory. Ultracode's *increment* is: automatic workflow planning, script-codified orchestration at 10s–100s of agents, script-variable context isolation, systematic adversarial verification, resumability, and saved/reusable orchestration — all on top of the base. — *synthesis of verified-live facts above.*

---

## 6. User-visible behaviour while ultracode runs

- **Session stays responsive:** workflows run in the background; the user can keep typing while agents work. — `verified live`.
- **Approval first (unless ultracode-on/auto):** per-run prompt showing planned phases (CLI: Yes / Yes-and-don't-ask-again / View raw script / No); Desktop: approval card with workflow name, phase list, token-usage caution (Once / Always / Deny). — `verified live`.
- **`/workflows` progress view:** run `/workflows` any time to list running and completed workflows, select one to open its progress view (skips the list if only one run). The progress view **shows each phase with its agent counts**; the footer lists keys: `↑/↓` select phase/agent, `Enter/→` drill into phase then agent detail, `Esc/←` back out, `j/k` scroll detail, `f` filter agent list by status (cycle), `p` pause/resume, `x` stop selected agent (or whole workflow when focus is on the run), `r` restart selected running agent, `s` save run's script as a command. — `verified live`.
- **Agent detail:** the agent's prompt, recent tool calls, and result; each call shows its state (still running / failed); if the agent keeps its own task list, the detail shows it with each task's status; `Enter` expands to full prompt/result and each call's input + start of result. — `verified live`.
- **Task panel:** the run's progress line appears in the task panel below the input box; expand it there. When a run stops, it stays in the panel while agent processes are still running (stop again to re-signal). While waiting at a usage limit, the progress line and `/workflows` header show when the limit resets (Code tab: e.g. "Paused at usage limit · continues after 3:45 PM if the app stays open"). — `verified live`.
- **Token visibility:** "`/workflows` view shows each agent's token usage as the run progresses, and you can stop the run there at any time, usually without losing completed work." — `verified live`.
- **Large-workflow warning:** progress line shows a `Large workflow` warning when a workflow schedules >25 agents or projected total passes 1.5M tokens, pointing to `/workflows` where the run can be stopped (advisory; doesn't pause/limit). **Not shown when ultracode is on.** — `verified live`.
- **Stall/retry visibility:** a stalled agent's name gains a `(retry 1)` suffix; its detail shows `attempt 2 (stalled)`. Restart is automatic. — `verified live`.
- **Desktop:** progress view appears in the Background tasks side pane. — `verified live`.
- **Agent teams (separate UI):** lead's terminal lists teammates in the agent panel below the prompt input (in-process) or in split panes (tmux/iTerm2); user can select a teammate, open its transcript, message it directly, or stop it (`x`); idle rows hide/collapse as described in §3.2. — `verified live`.
- **What the user gets at the end:** one coordinated answer / report — e.g. `/deep-research` returns a single cited report with claims that didn't survive cross-checking filtered out — instead of a turn-by-turn transcript. — `verified live`.

---

## Could not verify / open questions

1. **"Substantive task" threshold:** no published definition of when Claude decides a task warrants a workflow under ultracode. Unverified — do not invent a threshold for EVA; decide an explicit policy.
2. **Formal disagreement/consensus rule:** no published voting/quorum/arbitration algorithm for workflows in general or agent teams (only the `/deep-research` vote-on-claims pattern and adversarial-refutation / lead-synthesis patterns). Unverified.
3. **Cost multiplier:** Anthropic publishes no general token/time multiplier for ultracode; all circulating figures (62M tokens/day, 11.4M tokens/160 agents, $20k C-compiler) are single anecdotes / second-hand reports. Unverified as typical costs.
4. **"Mid-conversation system messages" as the enabling mechanism:** claimed by APIDog as the trick behind ultracode (xhigh + mid-conversation system messages). This is that author's interpretation; it does **not** appear in the Claude Code docs read here. Flag as unverified/interpretive — do not present as official architecture.
5. **"100 sub-agents" / "/ultracode" claims:** social-media reels claim typing `/ultracode` spins up 100 sub-agents. There is no `/ultracode` command in official docs, and no fixed "100" in docs (caps are 16 concurrent / 1,000 total). Treat as promotional, unverified.
6. **GA date for dynamic workflows:** announcement page now says "generally available" but gives no GA date in the text read. Unverified.
7. **Exact per-model effort defaults matrix and ultrathink v2.1.311 behaviour:** corroborated by multiple secondary guides quoting the docs/changelog, but the model-config page's effort section was not re-read line-by-line in full in this run. Treat as second-hand (high confidence, multiple agreeing sources).
8. **Sandbox details:** taken from official-docs search snippets only, not a full-page read. Treat as index-only (official domain, medium-high confidence).
9. **Agent-teams introduction date (5 Feb 2026, v2.1.32):** corroborated by multiple secondary sources + the Opus 4.6 announcement mirror; the official agent-teams docs page itself does not state the date in the text read. Second-hand.
10. **Keyword rename date (v2.1.160, 2 Jun 2026):** multiple secondary sources agree; not directly verified against the official changelog in this run. Second-hand.

## Sources

### Official — verified live (read 2026-11-12)
1. Claude Code Docs — "Orchestrate subagents at scale with dynamic workflows" — https://code.claude.com/docs/en/workflows — updated 2026-11-10. Primary source for §§1–2, 4, 6.
2. Anthropic — "Introducing dynamic workflows in Claude Code" — https://claude.com/resources/articles/introducing-dynamic-workflows-in-claude-code — published 2026-05-28; now notes GA. Primary for launch, Bun example, "how it works".
3. Claude Code Docs — "Orchestrate teams of Claude Code sessions" (Agent Teams) — https://code.claude.com/docs/en/agent-teams — updated 2026-11-10. Primary for §3.
4. Claude Code Docs — "How Claude Code works" — https://code.claude.com/docs/en/how-claude-code-works — updated 2026-10-30. Primary for §5 (loop, skills/MCP/subagents, checkpoints, permissions).
5. Claude Code Docs — "Model configuration" — https://code.claude.com/docs/en/model-config — read in part (Fable, model aliases, model switching verified live); ultracode/effort definition corroborated via search snippet quoting the same page. Primary for §1.4.
6. Claude Code Docs — "All settings" — https://code.claude.com/docs/en/settings-reference — via search snippet (`ultracode`, `workflowKeywordTriggerEnabled` entries). Index only for §1.3.

### Official — index only (search-result text, official domain)
7. Claude Code Docs — "Configure the sandboxed Bash tool" — https://code.claude.com/docs/en/sandboxing
8. Claude Code Docs — "Security" — https://code.claude.com/docs/en/security
9. Claude Code Docs — "Create custom subagents" — https://code.claude.com/docs/en/sub-Agents ; "Tools reference" — https://code.claude.com/docs/en/tools
10. Claude Code Docs — "Commands" — https://code.claude.com/docs/en/commands (skills chaining, `/rewind`)

### Secondary — reputable, docs-citing (index/search snippets; not full-page reads)
11. DigIntoAI — "What Is Ultracode in Claude Code, and How Is It Different From Max Effort?" — https://digintoai.com/en/articles/claude-code-ultracode
12. DevelopersDigest — "Ultracode Explained: Claude Code Multi-Agent Orchestration" — https://www.developersdigest.tech/blog/ultracode-effort-level-explained
13. BitsMinds — "What Is 'ultracode' Mode in Claude Code? Explained" — https://www.bitsminds.com/news/claude-code-ultra-code-mode-ultracode-explained-2026
14. ToolColumn — "What Is Ultracode in Claude Code? Plans and Usage Cost" — https://www.toolcolumn.com/learn/what-is-ultracode-in-claude-code
15. ClaudeWorld — "Ultracode & Effort Levels" — https://claude-world.com/articles/ultracode-and-effort-levels-guide/ ; "Claude Code 2.1.227 to 2.1.305 Roundup" — https://claude-world.com/articles/claude-code-august-october-2026-roundup/
16. claudefa.st — "What Is Ultracode in Claude Code? Not an Effort Level" — https://claudefa.st/blog/guide/development/ultracode
17. APIDog — "Claude Code Dynamic Workflows" — https://apidog.com/blog/claude-code-dynamic-workflows-opus-4-8/ (mid-conversation-system-messages claim — unverified, see §Could not verify #4)
18. CodeWithSeb — https://www.codewithseb.com/blog/claude-code-dynamic-workflows-parallel-subagents-guide ; EchoFold — https://echofold.ai/articles/claude-code-dynamic-workflows-ultracode-opus-4-8 (anecdotal cost/run figures — unverified)
19. Zircote — "What's New in Claude Code: Opus 4.6 and Agent Teams" — https://zircote.com/blog/2026/02/whats-new-in-claude-code-opus-4-6/ ; NxCode agent-teams guide — https://www.nxcode.ai/resources/news/claude-agent-teams-parallel-ai-development-guide-2026

### Notes files
- `notes/source-01-official-workflows.md`, `notes/source-02-official-announcement-opus48.md`, `notes/source-03-official-agent-teams.md`, `notes/source-04-official-model-config-how-it-works.md`, `notes/source-05-secondary-ultracode-guides.md`, `notes/source-06-secondary-agent-teams-opus46.md`

### Page instructions not followed
None encountered. One attempted `browser_open` to `https://code.claude.com/docs/en/parallel-agents` returned 404; it was not retried (that URL was guessed, not observed) and no equivalent claim depends on it.
