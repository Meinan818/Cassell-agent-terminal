import type { Effort, InspectorView, Mode, Project, Task, Theme } from "../types";
import { EFFORTS, EFFORT_LABELS } from "../types";

/**
 * S7 命令注册表：Cmd-K 命令面板与 `/` 命令面板共用的同一套命令
 *（frontend-redesign-plan.md §7.3：两者共用同一套注册表，`/` 输入框内触发、
 * Cmd-K 全局触发）。本文件只注册“命令是什么、怎么过滤、执行什么动作”——
 * 具体的动作由 App 传入的 context 提供，每条命令都执行真实动作，不摆假命令。
 */

/** 设置 modal 的左导航四组（§3.6）：专员 / 模型 / 权限 / 外观。 */
export type SettingsNav =
  | "specialist"
  | "model"
  | "workstyle"
  | "permissions"
  | "appearance";

export interface CommandContext {
  mode: Mode;
  theme: Theme;
  effort: Effort;
  providerName: string;
  model: string;
  hasActiveTask: boolean;
  activeTaskTitle: string | null;
  pendingReviewCount: number;
  running: boolean;
  tasks: Task[];
  activeTaskId: string | null;
  inspectorView: InspectorView | null;
  /** P0-1：真项目——新建与切换都走这里。 */
  projects: Project[];
  activeProjectId: string | null;
  newProject: () => void;
  switchProject: (id: string) => void;
  newTask: () => void;
  setMode: (mode: Mode) => void;
  openSettings: (nav: SettingsNav) => void;
  openInspector: (view: InspectorView) => void;
  setTheme: (theme: Theme) => void;
  setEffort: (effort: Effort) => void;
  openArchive: () => void;
  openHelp: () => void;
  archiveCurrentTask: () => void;
  clearChat: () => void;
  showUsage: () => void;
  acceptAllReview: () => void;
  jumpToTask: (id: string) => void;
  /** P1-17：打开上下文仪表盘抽屉。 */
  openContextDrawer: () => void;
  /** P1-13：立即压缩并归档（普通对话手动压）。 */
  runCompact: () => void;
  /** P1-17：生成摘要，不压缩。 */
  runRecap: () => void;
}

export interface CommandItem {
  id: string;
  group: string;
  title: string;
  /** 右侧小字提示（快捷键、当前值、数量等）。 */
  hint?: string;
  /** 匹配用关键词（中文 + 英文都写，边打字边过滤时一起查）。 */
  keywords: string[];
  run: () => void;
}

const THEME_LABELS: Record<Theme, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};

/**
 * 静态命令清单（§4.3 的第一批 + 本波任务清单，一项不许少）。
 *
 * 位置纪律（2026-11-13 用户定）：顺序按使用频率 + 流程排，分组体现层级，
 * 不要按字母表随手排——
 * - 分组顺序：任务（新建任务是最高频动作）→ 项目（切换项目 = 换工作现场，
 *   先定“在哪干活”，再定“怎么干活”）→ 模式（切换人格是第二高频）
 *   → 设置（打开设置是第三高频，模型与强度都挂在设置下面）→ 审查
 *   （工作中的检查动作）→ 外观（主题偶尔换）→ 系统（档案库/帮助最少用）
 *   → 危险操作（批量接受并合并单独垫底，不跟导航命令混在一起）。
 * - 每组内部按流程排：先是入口（打开设置 / 打开 Inspector），再是该组
 *   最常用的房间（切换模型 / 打开审查），然后是跟随的动作（思考强度 /
 *   全部接受并合并），最后是收尾检查（查看状态与用量）。
 * - 模式组里“对方模式”排在前面：面板打开时，你最可能点的就是切过去。
 * - 项目组里“新建项目…”排在最前（最高频的项目操作），再是逐个切换；
 *   当前项目带“当前”标记，不重复列在切换里。
 * - 下架的命令：无。“压缩上下文”曾在 P1-7 下架（等引擎支持）；P1-1/13/17
 *   已接上引擎，重新上架为“立即压缩并归档”（/compact）、“生成摘要”
 *   （/recap）、“查看上下文状态”（/status）。
 */
function staticCommands(ctx: CommandContext): CommandItem[] {
  // 模式组：对方模式在前（最可能点的切换），当前模式在后（带“当前”标记）。
  const modes: Mode[] =
    ctx.mode === "eva" ? ["norma", "eva"] : ["eva", "norma"];
  const modeItems: CommandItem[] = modes.map((m) => ({
    id: `mode-${m}`,
    group: "模式",
    title: m === "norma" ? "切换到诺玛" : "切换到 EVA",
    hint: ctx.mode === m ? "当前" : m === "norma" ? "通用工作" : "工程开发",
    keywords:
      m === "norma"
        ? ["norma", "诺玛", "mode", "模式", "通用"]
        : ["eva", "模式", "工程", "mode"],
    run: () => ctx.setMode(m),
  }));

  const reviewOrder: InspectorView[] = [
    "review",
    "terminal",
    "files",
    "workflow",
    "browser",
    "plugins",
  ];
  const reviewLabels: Record<InspectorView, string> = {
    review: "审查",
    terminal: "终端",
    files: "文件",
    browser: "浏览器",
    plugins: "插件",
    workflow: "工作流",
  };
  const reviewKeywords: Record<InspectorView, string> = {
    review: "review 审查 变更 diff 合并",
    terminal: "terminal 终端 shell 命令行",
    files: "files 文件 目录 浏览",
    browser: "browser 浏览器 网页",
    plugins: "plugins 插件 mcp 扩展",
    workflow: "workflow 工作流 并行 ultracode",
  };

  const list: CommandItem[] = [
    // ---- 任务：最高频在前。新建（开始）→ 归档（收尾）→ 清空（重置）→ 压缩（维护） ----
    {
      id: "new-task",
      group: "任务",
      title: "新建任务",
      hint: "⌘N",
      keywords: ["new task", "新建", "新任务", "新对话", "new-task"],
      run: ctx.newTask,
    },
    {
      id: "archive-current",
      group: "任务",
      title: "归档当前任务",
      hint: ctx.activeTaskTitle ?? undefined,
      keywords: ["archive", "归档", "存档"],
      run: ctx.archiveCurrentTask,
    },
    {
      id: "clear-chat",
      group: "任务",
      title: "清空对话",
      hint: ctx.hasActiveTask ? "清空当前对话的消息" : "当前没有对话",
      keywords: ["clear", "清空", "清除", "删除对话"],
      run: ctx.clearChat,
    },
    // ---- 任务维护：压缩（P1-13/17，引擎已接上才上架）。 ----
    {
      id: "compact-now",
      group: "任务",
      title: "立即压缩并归档",
      hint: "先归档原文，再压成摘要",
      keywords: ["compact", "压缩", "压缩上下文", "归档", "上下文"],
      run: ctx.runCompact,
    },
    {
      id: "recap",
      group: "任务",
      title: "生成摘要（不压缩）",
      hint: "只看摘要，历史不动",
      keywords: ["recap", "摘要", "总结", "回顾"],
      run: ctx.runRecap,
    },
    {
      id: "context-status",
      group: "任务",
      title: "查看上下文状态",
      hint: "剩余上下文 / 缓存命中 / 归档",
      keywords: ["status", "上下文", "context", "状态", "仪表盘", "剩余"],
      run: ctx.openContextDrawer,
    },
    // ---- 项目：先定“在哪干活”。新建在前（最高频的项目操作），再逐个切换。 ----
    {
      id: "new-project",
      group: "项目",
      title: "新建项目…",
      hint: "打开文件夹自己选",
      keywords: ["new project", "新建项目", "打开项目", "项目", "文件夹", "new-project"],
      run: ctx.newProject,
    },
    ...ctx.projects.map(
      (p): CommandItem => ({
        id: `switch-project-${p.id}`,
        group: "项目",
        title: `切换到项目：${p.name}`,
        hint: p.id === ctx.activeProjectId ? "当前" : p.path || "未选文件夹",
        keywords: ["project", "切换项目", "项目", p.name, p.path],
        run: () => ctx.switchProject(p.id),
      }),
    ),
    // ---- 模式：第二高频。对方模式在前。 ----
    ...modeItems,
    // ---- 设置：第三高频。先入口（打开设置，落在最常用的模型组），再切换模型，再思考强度。 ----
    {
      id: "open-settings",
      group: "设置",
      title: "打开设置",
      hint: "⌘,",
      keywords: ["settings", "设置", "配置", "偏好"],
      run: () => ctx.openSettings("model"),
    },
    {
      id: "switch-model",
      group: "设置",
      title: "切换模型…",
      hint: `${ctx.providerName} · ${ctx.model || "未选模型"}`,
      keywords: ["model", "模型", "切换模型", "服务商", "provider"],
      run: () => ctx.openSettings("model"),
    },
    ...EFFORTS.map(
      (e): CommandItem => ({
        id: `effort-${e}`,
        group: "设置",
        title: `思考强度：${EFFORT_LABELS[e]}`,
        hint: ctx.effort === e ? "当前" : undefined,
        keywords: ["effort", "思考强度", "思考", "thinking", EFFORT_LABELS[e]],
        run: () => ctx.setEffort(e),
      }),
    ),
    // ---- 审查：工作中的检查动作。先入口（打开 Inspector），再最常用的审查视图与合并动作，
    // 再按频率排其余视图（终端 > 文件 > 工作流 > 浏览器 > 插件），最后收尾查状态与用量。 ----
    {
      id: "open-inspector",
      group: "审查",
      title: "打开 Inspector",
      hint: "审查 / 终端 / 文件 / 工作流",
      keywords: ["inspector", "检查器", "工作视图", "面板", "打开"],
      run: () => ctx.openInspector(ctx.inspectorView ?? "review"),
    },
    {
      id: "inspector-review",
      group: "审查",
      title: "打开审查",
      hint: "在 Inspector 中查看",
      keywords: ["inspector", "打开", reviewKeywords.review],
      run: () => ctx.openInspector("review"),
    },
    ...reviewOrder
      .filter((v) => v !== "review")
      .map(
        (v): CommandItem => ({
          id: `inspector-${v}`,
          group: "审查",
          title: `打开${reviewLabels[v]}`,
          hint: "在 Inspector 中查看",
          keywords: ["inspector", "打开", reviewKeywords[v]],
          run: () => ctx.openInspector(v),
        }),
      ),
    {
      id: "show-usage",
      group: "审查",
      title: "查看状态与用量",
      hint: "本对话累计 token",
      keywords: ["usage", "用量", "状态", "token", "统计"],
      run: ctx.showUsage,
    },
    // ---- 外观：偶尔换主题，按标题栏三态循环的顺序排（浅色 → 深色 → 跟随系统）。 ----
    ...(["light", "dark", "system"] as Theme[]).map(
      (t): CommandItem => ({
        id: `theme-${t}`,
        group: "外观",
        title: `切换主题：${THEME_LABELS[t]}`,
        hint: ctx.theme === t ? "当前" : undefined,
        keywords: ["theme", "主题", "浅色", "深色", "跟随系统", "外观", t],
        run: () => ctx.setTheme(t),
      }),
    ),
    // ---- 系统：最少用的收尾项。 ----
    {
      id: "open-archive",
      group: "系统",
      title: "打开档案库",
      hint: "已归档的任务",
      keywords: ["archive", "档案库", "归档", "历史"],
      run: ctx.openArchive,
    },
    {
      id: "open-help",
      group: "系统",
      title: "帮助",
      hint: "快捷键与用法",
      keywords: ["help", "帮助", "快捷键", "用法", "关于"],
      run: ctx.openHelp,
    },
    // ---- 危险操作：批量接受并合并单独垫底，不跟导航命令混在一起（P2-23）。
    // 合并卡自带撤销兜底，但“全部接受”本身是批量意图，键盘上下选时不该顺手误触。 ----
    {
      id: "review-accept-all",
      group: "危险操作",
      title: "审查：全部接受并合并",
      hint:
        ctx.pendingReviewCount > 0
          ? `${ctx.pendingReviewCount} 个待审查`
          : "暂无待审查变更",
      keywords: ["accept", "merge", "合并", "接受", "全部接受", "审查"],
      run: ctx.acceptAllReview,
    },
  ];
  return list;
}

/** 任务的 project 字段存的是项目 id，这里解析成名字显示；找不到时
 * 原样显示（旧数据里的“默认项目”这类名字在迁移前就长这样）。 */
function projectNameOf(ctx: CommandContext, projectId: string): string {
  return ctx.projects.find((p) => p.id === projectId)?.name ?? projectId;
}

/** 动态命令：按标题模糊搜任务，回车跳转（§4.3“跳到任务…”）。
 * 覆盖标题 + 项目名 + 首条消息正文（P2-2：只搜标题找不到“上次讨论部署的那次对话”）。 */
function taskCommands(ctx: CommandContext, query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return ctx.tasks
    .filter((t) => !t.archived)
    .filter((t) => {
      if (t.title.toLowerCase().includes(q)) return true;
      if (projectNameOf(ctx, t.project).toLowerCase().includes(q)) return true;
      const first = t.messages.find((m) => m.role === "user")?.text ?? "";
      return first.toLowerCase().includes(q);
    })
    .slice(0, 5)
    .map(
      (t): CommandItem => ({
        id: `jump-task-${t.id}`,
        group: "跳到任务",
        title: t.title,
        hint: projectNameOf(ctx, t.project),
        keywords: [t.title, projectNameOf(ctx, t.project)],
        run: () => ctx.jumpToTask(t.id),
      }),
    );
}

function matches(item: CommandItem, q: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (item.title.toLowerCase().includes(needle)) return true;
  if (item.group.toLowerCase().includes(needle)) return true;
  return item.keywords.some((k) => k.toLowerCase().includes(needle));
}

/**
 * 取当前 query 下的命令列表：静态命令先过滤，再把匹配的任务跳转缀在后面。
 * query 为空时返回全部静态命令（分组顺序即展示顺序）。
 */
export function getCommands(ctx: CommandContext, query: string): CommandItem[] {
  const q = query.trim();
  const staticList = staticCommands(ctx).filter((c) => matches(c, q));
  return [...staticList, ...taskCommands(ctx, q)];
}
