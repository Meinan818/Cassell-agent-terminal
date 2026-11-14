export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
/** 模式：norma（通用工作 / Cowork）| eva（工程开发 / Code）。与思考强度、Ultracode 各自独立。 */
export type Mode = "norma" | "eva";
export type Approval = "always" | "on-demand" | "never";
/** 删除确认： "always" 每次都问（默认）| "never" 不再询问。 */
export type DeleteConfirm = "always" | "never";
/** 运行模式： "execute" 执行（动手改文件/跑命令）| "plan" 计划（只调查、出方案）。 */
export type RunMode = "plan" | "execute";
export type Sandbox = "read-only" | "workspace-write" | "danger-full-access";
export type Theme = "light" | "dark" | "system";
/** 主题偏好在 localStorage 里的镜像 key（只供首绘脚本读，Rust 设置文件仍是唯一事实来源）。 */
export const THEME_KEY = "cassell.theme";
/** 把偏好解析成实际生效的亮/暗主题：system 跟随系统偏好。 */
export function resolveTheme(theme: Theme, systemDark: boolean): "light" | "dark" {
  if (theme === "system") return systemDark ? "dark" : "light";
  return theme;
}

export interface ProviderConfig {
  id: string;
  name: string;
  base_url: string;
  env_key: string;
  models: string[];
  default_model: string;
  /** 接入方式："direct" 官方直连 / "relay" 中转站（P0-3，按这个查模型映射表）。 */
  kind?: string;
}

export interface ExtensionItem {
  id: string;
  name: string;
  kind: "plugin" | "mcp";
  detail: string;
  enabled: boolean;
}

export interface Settings {
  provider_id: string;
  model: string;
  effort: Effort;
  mode: Mode;
  /** Ultracode：高级工程工作流的独立开关（多智能体并行、交叉验证、迭代）。 */
  ultracode: boolean;
  approval: Approval;
  /** 删除确认： "always" 每次都问（默认）| "never" 不再询问。持久化在 Rust 设置文件。 */
  delete_confirm: DeleteConfirm;
  /** 压缩模型：压缩历史时用的模型，和主模型分开配（P0-3）。 */
  compression_model?: string;
  sandbox: Sandbox;
  theme: Theme;
  streaming: boolean;
  boot_animation: boolean;
  workdir: string;
  /** 用户显示名。空 = 界面显示默认“路明非”。 */
  display_name: string;
  providers: ProviderConfig[];
  api_keys: Record<string, string>;
  extensions: ExtensionItem[];
}

export type MsgKind = "text" | "tool" | "error" | "eva" | "perm" | "ask" | "think";

/** Inspector（S6）：按需出现的右侧工作视图，一次只看一个。 */
export type InspectorView =
  | "review"
  | "terminal"
  | "files"
  | "browser"
  | "plugins"
  | "workflow";

export interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  kind?: MsgKind;
  toolLabel?: string;
  /** 工具调用参数：事件里直接带结构化参数，卡片不再反解正文。 */
  toolArgs?: Record<string, unknown>;
  /** 工具调用状态：running / done / error。 */
  toolStatus?: "running" | "done" | "error";
  /** 服务商回报的真实用量（本轮结束时才有）；cached/costUsd/savedUsd
      是 P0-10：缓存命中 tokens、按官方价目估算的花费与缓存省下的钱。 */
  usage?: {
    prompt: number;
    completion: number;
    total: number;
    cached?: number;
    costUsd?: number;
    savedUsd?: number;
  };
  /** 本轮撞到总预算上限或卡住：下方挂一句说明（没有“继续”按钮——
      8 轮只是内部单回合单位，普通对话也会自动续跑到预算；想继续直接发消息）。 */
  limitNotice?: { reason: "budget" | "stalled"; text: string };
  /** Permission card payload (kind === "perm"). */
  perm?: {
    command: string;
    decision?: "allow-once" | "allow-session" | "deny" | "批准" | "拒绝" | "稍后处理";
    /** 挂起的后端审批请求 id（有它就是真审批卡，按钮调 resolve_approval）。 */
    requestId?: string;
    /** 审批种类：写文件 / 删除命令 / 执行命令 / 敏感路径 / 网络出口。 */
    kind?: "write" | "delete" | "shell" | "sensitive" | "network";
  };
  /** 计划模式产出的完整方案：显示在对话里，下方挂"确认执行/修改方案"。 */
  plan?: boolean;
  /** Inquiry card payload (kind === "ask"). */
  ask?: {
    question: string;
    options: string[];
    picked?: number;
  };
  /** Thinking-indicator phase for this assistant turn. */
  thinkPhase?: "thinking" | "exploring" | "drafting" | "done";
  thinkSecs?: number;
}

/** P0-6 目标清单的一项（模型首轮列出，之后更新；没有就不显示，不编假的）。 */
export interface GoalCheckItem {
  text: string;
  done: boolean;
}

/** P0-6 目标摘要（后端每次进度事件与每轮返回都带一份）。 */
export interface GoalSummary {
  id: string;
  text: string;
  status: "running" | "paused" | "done" | "stuck" | "budget";
  status_label: string;
  rounds_used: number;
  rounds_budget: number;
  turns_used: number;
  files_changed: string[];
  checklist: GoalCheckItem[];
  unverified_writes: string[];
}

/** P0-7 检查点（每回合一个消息快照 + 写前备份）。 */
export interface CheckpointInfo {
  turn: number;
  summary: string;
  files_changed: string[];
  rounds_used: number;
  created_at: number;
}

/** P0-6 一个任务上的目标状态（存在 Task 里，随任务列表持久化）。 */
export interface GoalState extends GoalSummary {
  checkpoints: CheckpointInfo[];
  /** 倒带后的一句回执（恢复了哪些文件），看过即清。 */
  rewindNote?: string;
}

export interface Task {
  id: string;
  title: string;
  /** 归属的项目 id（指向 Project.id，不再是写死的“默认项目”字符串）。 */
  project: string;
  /** 0.1.9：任务绑定模式——一个任务只用一个模式，不中途切换。
      缺省（旧任务）按 norma 算；切模式 = 开新任务。 */
  mode?: Mode;
  messages: ChatMsg[];
  createdAt: number;
  archived?: boolean;
  /** Demo seed flag: drives the mockup's seeded conversation. */
  seed?: boolean;
  status?: "running" | "done" | "idle";
  /** Collapsible sub-sessions (EVA) shown under the task. */
  subSessions?: { id: string; title: string; state: string }[];
  /** P0-6：这个任务上的目标（有它就是目标模式；没有就是普通对话）。 */
  goal?: GoalState;
}

export interface ReviewFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  state?: "pending" | "approved" | "rejected";
}

/**
 * 项目（P0-1）：一个项目 = 电脑里的一个文件夹。
 * id 是本地唯一标识（uid）；name 默认取文件夹名、用户可改；
 * path 是该项目的工作区目录——任务、审查、终端、文件页都跟着它走。
 */
export interface Project {
  id: string;
  name: string;
  path: string;
}

/** 取路径的最后一段作默认项目名（同时兼容 / 与 \ 分隔符；空路径返回空串）。 */
export function folderName(path: string): string {
  const clean = path.replace(/[/\\]+$/, "");
  const last = clean.split(/[/\\]/).pop() ?? "";
  return last || path;
}

export interface ReviewState {
  is_git: boolean;
  files: ReviewFile[];
  additions: number;
  deletions: number;
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  /** 文件字节数；目录为 null（P0-11：list_files 直接返回，列表行不用先预览才知道大小）。 */
  size?: number | null;
}

export interface RunResult {
  thread_id: string | null;
  exit_code: number | null;
  success: boolean;
}

/** 原生引擎一轮的返回（run_agent_native）。token 数是服务商真实回报，不估算。 */
export interface AgentResult {
  success: boolean;
  cancelled: boolean;
  text: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  /** P0-10：缓存命中 tokens（服务商没报时为 null）；花费与节省是按 DeepSeek
      官方价目估算的 USD，模型没收录价目时为 null（面板显示“—”）。 */
  cached_tokens?: number | null;
  cost_usd?: number | null;
  saved_usd?: number | null;
  tools_run: string[];
  /** 本轮为什么停下："finished"（正常收尾）| "budget"（到总预算上限）
      | "stalled"（连续多轮无进展，确实卡住了）| "cancelled"（用户叫停）。
      8 轮只是内部单回合单位，对外不可见。 */
  stop_reason: "finished" | "budget" | "stalled" | "cancelled";
  /** 停下时的补充说明（到预算/卡住时写清原因；正常收尾为空）。 */
  stop_detail: string;
  /** P0-6 目标摘要（目标模式才有）。 */
  goal?: GoalSummary | null;
}

export const EFFORT_LABELS: Record<Effort, string> = {
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "Max",
};

export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export const MODE_LABELS: Record<Mode, string> = {
  norma: "诺玛",
  eva: "EVA",
};

/** 状态栏模式标识：NORMA 办公 · Cowork / EVA 工程 · Code。 */
export const MODE_TAG: Record<Mode, string> = {
  norma: "办公 · Cowork",
  eva: "工程 · Code",
};

/** P0-9 切换 = 换工位：切模式时自动带过去的默认配置（用户随后可改）。 */
export const MODE_DEFAULTS: Record<Mode, { effort: Effort; approval: Approval }> = {
  norma: { effort: "medium", approval: "always" },
  eva: { effort: "high", approval: "on-demand" },
};

/** P0-9 问候语：NORMA 办公口吻，EVA 工程口吻（不要只换名字）。 */
export function modeGreeting(mode: Mode, hour: number, displayName: string): string {
  const base = `${greetingForHour(hour)}，${displayName.charAt(0)}专员。`;
  return mode === "eva"
    ? `${base}任务简报已就位，要改哪块代码？`
    : `${base}学院的档案室和任务板都已就绪，今天想处理什么文档/任务？`;
}

/** P0-9 切换后的自我介绍：第一条消息说清"我现在是谁、能做什么、不能做什么"。称呼跟着显示名走（首字 + 专员），不要写死"路专员"。
    0.1.9：不说"不能做 XXX"——两个模式是各专精一项、另一项也能做，不是能力墙。
    诺玛能改代码文件（写文件在行），只是没终端、跑不了测试；EVA 能写办公文档，只是不如诺玛顺手。 */
export function modeIntro(mode: Mode, displayName: string): string {
  const title = `${displayName.charAt(0)}专员`;
  return mode === "eva"
    ? `现在我是 EVA，卡塞尔学院的并行执行体，工程开发模式，与诺玛共用同一套记忆。${title}，我专精工程：读代码、改代码、跑测试，改动会拿测试和 diff 作证据；写文件默认直接动手，删文件仍会单独问你。办公文档我也能写，但日常办公是诺玛的强项，切回去更顺手。`
    : `现在我是诺玛，卡塞尔学院的中枢 AI，通用工作模式。学院的档案、任务与情报都经我手。${title}，我专精办公：写文档、整理资料、查信息、理思路；改文件会先问你。代码文件我也能改，但跑测试、跑命令要切到 EVA——终端是它的工具，我手头没有。`;
}

export const SANDBOX_LABELS: Record<Sandbox, string> = {
  "read-only": "只读",
  "workspace-write": "工作区可写",
  "danger-full-access": "无边界",
};

/** P0-10 用量总览（get_usage_stats）：台账里的今日/7天/30天 + 本次启动累计。
    cost_usd/saved_usd 为 null = 模型没收录官方价目，花费未知，只显示 token 数。 */
export interface UsageStats {
  prompt: number;
  completion: number;
  cached: number;
  requests: number;
  cost_usd: number | null;
  saved_usd: number | null;
}

export interface UsageOverview {
  today: UsageStats;
  last7d: UsageStats;
  last30d: UsageStats;
  session: UsageStats;
}

export const GREETING_TASKS = [
  "先把今天的文档列个提纲？",
  "先整理一份项目资料？",
  "先检查一下最近的代码变更？",
  "先把待办清单过一遍？",
  "先看看今天的日程安排？",
  "先从最紧急的那个任务开始？",
];

export function greetingForHour(hour: number): string {
  if (hour < 5) return "夜深了";
  if (hour < 9) return "早安";
  if (hour < 12) return "上午好";
  if (hour < 14) return "午安";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
