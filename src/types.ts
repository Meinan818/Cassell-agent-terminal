export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
/** 模式：norma（通用工作 / Cowork）| eva（工程开发 / Code）。与思考强度、Ultracode 各自独立。 */
export type Mode = "norma" | "eva";
export type Approval = "auto" | "read-only";
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
    decision?: "allow-once" | "allow-session" | "deny";
  };
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
