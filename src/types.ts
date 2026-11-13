export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
/** 模式：norma（通用工作 / Cowork）| eva（工程开发 / Code）。与思考强度、Ultracode 各自独立。 */
export type Mode = "norma" | "eva";
export type Approval = "auto" | "ask" | "read-only";
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
  sandbox: Sandbox;
  theme: Theme;
  streaming: boolean;
  boot_animation: boolean;
  workdir: string;
  codex_path: string;
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
  /** 服务商回报的真实用量（本轮结束时才有）。 */
  usage?: { prompt: number; completion: number; total: number };
  /** Permission card payload (kind === "perm"). */
  perm?: {
    command: string;
    decision?: "allow-once" | "allow-session" | "deny" | "批准" | "拒绝" | "稍后处理";
    /** 挂起的后端审批请求 id（有它就是真审批卡，按钮调 resolve_approval）。 */
    requestId?: string;
    /** 审批种类：写文件 / 删除命令。 */
    kind?: "write" | "delete";
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

export interface Task {
  id: string;
  title: string;
  /** 归属的项目 id（指向 Project.id，不再是写死的“默认项目”字符串）。 */
  project: string;
  messages: ChatMsg[];
  createdAt: number;
  archived?: boolean;
  /** Demo seed flag: drives the mockup's seeded conversation. */
  seed?: boolean;
  status?: "running" | "done" | "idle";
  /** Collapsible sub-sessions (EVA) shown under the task. */
  subSessions?: { id: string; title: string; state: string }[];
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

export interface CodexInfo {
  found: boolean;
  path: string;
  version: string;
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
  tools_run: string[];
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
  norma: { effort: "medium", approval: "ask" },
  eva: { effort: "high", approval: "auto" },
};

/** P0-9 问候语：NORMA 办公口吻，EVA 工程口吻（不要只换名字）。 */
export function modeGreeting(mode: Mode, hour: number, displayName: string): string {
  const base = `${greetingForHour(hour)}，${displayName.charAt(0)}专员。`;
  return mode === "eva"
    ? `${base}任务简报已就位，要改哪块代码？`
    : `${base}学院的档案室和任务板都已就绪，今天想处理什么文档/任务？`;
}

/** P0-9 切换后的自我介绍：第一条消息说清"我现在是谁、能做什么、不能做什么"。称呼跟着显示名走（首字 + 专员），不要写死"路专员"。 */
export function modeIntro(mode: Mode, displayName: string): string {
  const title = `${displayName.charAt(0)}专员`;
  return mode === "eva"
    ? `现在我是 EVA，卡塞尔学院的并行执行体，工程开发模式，与诺玛共用同一套记忆。${title}，我能读代码、改代码、跑测试，改动会拿测试和 diff 作证据；写文件默认直接动手，删文件仍会单独问你。不能做的事：不写办公文档、不碰日程邮件——那是诺玛的活。`
    : `现在我是诺玛，卡塞尔学院的中枢 AI，通用工作模式。学院的档案、任务与情报都经我手。${title}，我能帮你写文档、整理资料、查信息、理思路；改文件会先问你。不能做的事：不改代码、不跑终端命令——那是 EVA 的活，需要的话一键切过去。`;
}

export const SANDBOX_LABELS: Record<Sandbox, string> = {
  "read-only": "只读",
  "workspace-write": "工作区可写",
  "danger-full-access": "完全访问",
};

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
