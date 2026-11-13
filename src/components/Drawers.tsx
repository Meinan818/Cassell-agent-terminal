import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  Approval,
  CodexInfo,
  DeleteConfirm,
  Effort,
  Mode,
  ProviderConfig,
  Sandbox,
  Settings,
  Task,
} from "../types";
import {
  EFFORTS,
  EFFORT_LABELS,
  MODE_LABELS,
  SANDBOX_LABELS,
} from "../types";
import { APP_VERSION } from "../version";
import { modKey } from "../platform";
import type { CommandItem, SettingsNav } from "./commands";
import CrestLine from "./CrestLine";
import { humanizeTestError } from "./ConnectWizard";

/* ------------------------------------------------------------------ */
/* 抽屉（档案库 / 帮助沿用）：右侧滑出，与设置 modal 不是同一种浮层。  */
/* 设置 modal 的 Esc 由 App 的中央键盘处理接管（与 Cmd-K、Inspector 同 */
/* 一条优先级规则），所以 modal 自己不再挂 window Esc 监听，避免 Esc    */
/* 一次关掉两层。                                                      */
/* ------------------------------------------------------------------ */

/** 思考强度每档一句话说明（P1-2：设置与输入框模型菜单共用同一份文案）。 */
export const EFFORT_DESCS: Record<Effort, string> = {
  low: "快、便宜，适合简单问答。",
  medium: "均衡，适合大多数任务。",
  high: "想得深，适合复杂推理；慢一些、贵一些。",
  xhigh: "更深更仔细，适合难题；更慢、更贵。",
  max: "最深、最慢、最贵，只用于最难的问题。",
};

/** 沙箱每档人话说明（P2-4：界面上绝不出现 read-only / workspace-write /
 * danger-full-access 这些原始枚举名）。 */
export const SANDBOX_DESCS: Record<Sandbox, string> = {
  "read-only": "只能读文件，不能改任何东西。",
  "workspace-write": "可以改工作区里的文件，改不了工作区以外的地方。",
  "danger-full-access": "什么都能碰，很危险——只在你明确知道后果时用。",
};

/** 审批每档人话说明（P0-9：三档是真档位，引擎按档位执行——
 * auto 直接写；ask 写前弹审批卡；read-only 不写不执行。
 * 删文件类命令另走删除确认设置（见下），不受这档管。 */
export const APPROVAL_DESCS: Record<Approval, string> = {
  auto: "写文件、跑命令直接进行；删文件类命令仍按删除确认设置单独问（默认每次都问）。",
  ask: "每次写文件前都先弹审批卡问你，批了才写；删文件类命令仍按删除确认设置单独问。",
  "read-only": "不写文件、不执行命令，只能读。",
};

/** 删除确认两档人话说明（P0-4：默认每次都问，用户可在设置里关掉）。 */
export const DELETE_CONFIRM_DESCS: Record<DeleteConfirm, string> = {
  always: "每次删文件/执行删除命令前都单独弹确认，批了才删。",
  never: "删除不再单独问，直接执行。删根目录（rm -rf / 这类）永远拒绝，不受这档影响。",
};

function DrawerShell({
  title,
  onClose,
  closing = false,
  children,
}: {
  title: string;
  onClose: () => void;
  /** 正在退场：先播 180ms 滑出动画再卸载（App 的 useOverlayExitValue）。 */
  closing?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={closing ? "drawer-overlay closing" : "drawer-overlay"}
      onClick={onClose}
      role="presentation"
    >
      <div
        className={closing ? "drawer closing" : "drawer"}
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <span>{title}</span>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 设置 modal（S7，§3.6；审计 P0-6 后重构）：居中 640px modal + 左导航。 */
/* 分组按“用户任务”分，不按字段归属分：                                */
/*   模型（连上服务商：选商 → Key → 地址 → 测连通 → 拉列表 → 选模型）  */
/*   → 工作方式（模式 / 思考强度 / Ultracode 三个互相可见）            */
/*   → 权限（审批 / 沙箱，干活时常要看）→ 外观（主题、启动动画）        */
/*   → 专员（身份卡 / 工作区 / 显示名，基本只设一次）。                */
/* 第 1 步的设置逻辑（settings 状态、save_settings、list_models 拉取）   */
/* 原样保留，只换容器与样式；原生 <select> 全部换成分段控件与选项列表。 */
/* 未配 Key 时不显示假模型、假掩码 key、假测试时间。                    */
/* ------------------------------------------------------------------ */

/* 位置纪律（2026-11-13 用户定）：左导航按使用频率排——模型（配 Key、换模型，
   打开设置最常见的目的）→ 工作方式（模式/强度常要微调）→ 权限（审批/沙箱，
   干活时常要看）→ 外观（主题、启动动画，设好就很少动）→ 专员（名字/工作区，
   基本只设一次）。 */
const SETTINGS_NAVS: { id: SettingsNav; label: string }[] = [
  { id: "model", label: "模型" },
  { id: "workstyle", label: "工作方式" },
  { id: "permissions", label: "权限" },
  { id: "appearance", label: "外观" },
  { id: "specialist", label: "专员" },
];

export function SettingsModal({
  settings,
  onPatch,
  onClose,
  closing = false,
  codexInfo,
  onTestConnection,
  testing,
  testResult,
  onFetchModels,
  onPickFolder,
  currentProjectName = null,
  initialNav = "model",
  onModeChange,
  onOpenWizard,
}: {
  settings: Settings;
  onPatch: (patch: Partial<Settings>) => void;
  onClose: () => void;
  /** 正在退场：先播 180ms 回缩动画再卸载（App 的 useOverlayExitValue）。 */
  closing?: boolean;
  codexInfo: CodexInfo | null;
  /** 测指定服务商（只看不切换时也测得到）。 */
  onTestConnection: (providerId: string) => void;
  testing: boolean;
  testResult: { ok: boolean; detail: string } | null;
  /** 从指定服务商拉模型列表（只看不切换时也拉得到）。 */
  onFetchModels: (providerId: string) => Promise<{ ok: boolean; detail: string }>;
  onPickFolder: () => void;
  /** P0-1：当前项目的名字（没有项目时为 null）——工作区这一行
   * 现在是“当前项目的目录”，文案要说明它属于当前项目。 */
  currentProjectName?: string | null;
  /** 从哪组打开（默认落在最常用的“模型”组；Cmd-K“切换模型…”也进这一组）。 */
  initialNav?: SettingsNav;
  /** 模式切换走 App 的统一入口（P1-11：仪式 + 模式行，不要静默切换）。 */
  onModeChange: (mode: Mode) => void;
  /** 没配 Key 时打开三步连接向导。 */
  onOpenWizard: () => void;
}) {
  const [nav, setNav] = useState<SettingsNav>(initialNav);
  /* P1-3：查看中的服务商（viewProviderId）与生效的服务商
     （settings.provider_id）分开——点列表行只选中查看，另给明确的
     “设为当前服务商”按钮；Key / 地址 / 测试 / 拉列表都按查看中的来。 */
  const [viewProviderId, setViewProviderId] = useState(settings.provider_id);
  const [switchNote, setSwitchNote] = useState<string | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchResult, setFetchResult] = useState<{
    ok: boolean;
    detail: string;
  } | null>(null);
  const [showKey, setShowKey] = useState(false);
  const provider =
    settings.providers.find((p) => p.id === viewProviderId) ?? settings.providers[0];
  const isViewingActive = viewProviderId === settings.provider_id;
  const hasAnyKey = Object.values(settings.api_keys).some((k) => k?.trim());
  const key = provider ? settings.api_keys[provider.id] ?? "" : "";
  const isCustom = provider?.id.startsWith("custom-") ?? false;

  // Cmd-K 在 modal 已开时又指定一组：跟过去，不用关了重开。
  useEffect(() => {
    setNav(initialNav);
  }, [initialNav]);

  // 查看中的服务商被删掉后，回落到当前生效的服务商。
  useEffect(() => {
    if (!settings.providers.some((p) => p.id === viewProviderId)) {
      setViewProviderId(settings.provider_id);
      setSwitchNote(null);
    }
  }, [settings.providers, settings.provider_id, viewProviderId]);

  const setKey = (v: string) => {
    if (!provider) return;
    onPatch({
      api_keys: { ...settings.api_keys, [provider.id]: v },
    });
  };

  const updateProvider = (patch: Partial<ProviderConfig>) => {
    if (!provider) return;
    onPatch({
      providers: settings.providers.map((p) =>
        p.id === provider.id ? { ...p, ...patch } : p,
      ),
    });
  };

  // 点列表行 = 只选中查看，不切换生效的服务商。
  const viewProvider = (id: string) => {
    setViewProviderId(id);
    setSwitchNote(null);
    setFetchResult(null);
  };

  // 明确的“设为当前服务商”：切换生效服务商 + 默认模型，并给一行确认反馈。
  const applyProvider = () => {
    if (!provider || isViewingActive) return;
    const model = provider.default_model || provider.models[0] || "";
    onPatch({ provider_id: provider.id, model });
    setSwitchNote(
      `已切换到 ${provider.name}${model ? `，模型已设为 ${model}` : "（该服务商还没有模型，先拉取模型列表）"}。`,
    );
  };

  // 自定义服务商：名字 + 地址 + Key 自己填，走 OpenAI 兼容接口（自己的反代也能接）。
  // 加进来只是“查看中”，生效要另点“设为当前服务商”。
  const addCustomProvider = () => {
    const id = `custom-${Date.now().toString(36)}`;
    const np: ProviderConfig = {
      id,
      name: "自定义服务商",
      base_url: "",
      env_key: "",
      models: [],
      default_model: "",
    };
    onPatch({ providers: [...settings.providers, np] });
    setViewProviderId(id);
    setSwitchNote(null);
    setFetchResult(null);
  };

  const deleteCustomProvider = () => {
    if (!provider || !isCustom) return;
    const rest = settings.providers.filter((p) => p.id !== provider.id);
    if (rest.length === 0) return;
    const next = rest[0];
    const nextKeys = { ...settings.api_keys };
    delete nextKeys[provider.id];
    // 删的是正在生效的服务商才回落；只是在查看的，生效服务商不动。
    if (isViewingActive) {
      onPatch({
        providers: rest,
        provider_id: next.id,
        model: next.default_model || next.models[0] || "",
        api_keys: nextKeys,
      });
    } else {
      onPatch({ providers: rest, api_keys: nextKeys });
    }
    setViewProviderId(next.id);
    setSwitchNote(null);
  };

  const fetchModels = async () => {
    if (!provider) return;
    setFetchingModels(true);
    setFetchResult(null);
    const r = await onFetchModels(provider.id);
    setFetchResult(r);
    setFetchingModels(false);
  };

  const providerModels = provider?.models ?? [];
  const modelInList = providerModels.includes(settings.model);

  return (
    <div
      className={closing ? "s7-overlay closing" : "s7-overlay"}
      onClick={onClose}
      role="presentation"
    >
      <div
        className={closing ? "s7-modal closing" : "s7-modal"}
        role="dialog"
        aria-label="设置"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="s7-modal-head">
          <span className="s7-modal-title">设置</span>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="s7-modal-body">
          <nav className="s7-nav" aria-label="设置分组">
            {SETTINGS_NAVS.map((n) => (
              <button
                key={n.id}
                type="button"
                className={nav === n.id ? "on" : ""}
                onClick={() => setNav(n.id)}
                aria-current={nav === n.id ? true : undefined}
              >
                {n.label}
              </button>
            ))}
          </nav>
          <div className="s7-content" key={nav}>
            {nav === "specialist" && (
              <>
                <div className="s7-group">
                  <div className="s7-identity">
                    <span className="w2-crest" title="卡塞尔学院">
                      <CrestLine size={22} />
                    </span>
                    <span className="s7-identity-name">
                      {settings.display_name?.trim() || "路明非"}
                    </span>
                    <span className="w2-seal" title="S">
                      S
                    </span>
                  </div>
                  <div className="s7-identity-id">S2017-0117</div>
                  <p className="drawer-note">
                    编号是学院档案，只读，不可改。
                  </p>
                </div>
                {/* P0-1：这一行不再是全局唯一设置——它是“当前项目的目录”。
                    选文件夹 = 改当前项目的目录；还没有项目时，选文件夹
                    就地新建一个项目。换项目请在侧栏“项目”组点一下。 */}
                <div className="s7-group">
                  <div className="drawer-section">
                    当前项目的目录
                    {currentProjectName ? ` · ${currentProjectName}` : ""}
                  </div>
                  <div className="drawer-row">
                    <span className="drawer-note">
                      {settings.workdir || "还没有选择项目文件夹"}
                    </span>
                    <button type="button" className="btn-primary" onClick={onPickFolder}>
                      选择文件夹…
                    </button>
                  </div>
                  <p className="drawer-note">
                    {currentProjectName
                      ? `这是「${currentProjectName}」的目录：诺玛只在这个目录里读写文件，审查队列按这里的 Git 状态生成。换项目请在侧栏“项目”组切换。`
                      : "还没有项目：选一个文件夹就会新建一个项目，诺玛只在那个目录里读写文件。"}
                  </p>
                </div>
                {/* 位-7：显示名放专员页最底部、不抢焦点（不 autoFocus）。 */}
                <div className="s7-group">
                  <label className="field-label" htmlFor="settings-display-name">
                    显示名
                  </label>
                  <input
                    id="settings-display-name"
                    className="field-input"
                    value={settings.display_name}
                    onChange={(e) => onPatch({ display_name: e.target.value })}
                    placeholder="路明非（默认）"
                    autoComplete="off"
                  />
                  <p className="drawer-note">问候与身份卡显示这个名字。</p>
                </div>
              </>
            )}

            {nav === "model" && (
              <>
                {/* 工作方式汇总：模式 / 思考强度 / Ultracode 三项当前值一眼可见，
                    点进去是“工作方式”组（P0-6 的另一半：三项互相可见）。 */}
                <div className="s7-summary">
                  <span>
                    当前工作方式：{MODE_LABELS[settings.mode]} · 思考强度{" "}
                    {EFFORT_LABELS[settings.effort]} · Ultracode{" "}
                    {settings.ultracode ? "开" : "关"}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setNav("workstyle")}
                  >
                    去工作方式页 →
                  </button>
                </div>
                {!hasAnyKey && (
                  <div className="s7-summary s7-summary-warn">
                    <span>还没有配置任何服务商的 API Key，诺玛没法开始干活。</span>
                    <button type="button" className="btn-primary" onClick={onOpenWizard}>
                      用三步向导连接 →
                    </button>
                  </div>
                )}
                <div className="s7-group">
                  <div className="drawer-section">模型服务商</div>
                  <p className="drawer-note">
                    配好 API Key 和服务商地址，就能连上服务商、拉取模型列表。支持你自己的
                    OpenAI 兼容反代。
                  </p>
                  <div className="field-label">服务商</div>
                  <div className="option-list" role="listbox" aria-label="服务商">
                    {settings.providers.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        role="option"
                        aria-selected={p.id === viewProviderId}
                        className={`option ${p.id === viewProviderId ? "selected" : ""}`}
                        onClick={() => viewProvider(p.id)}
                      >
                        <span>
                          {p.name}
                          {p.id === settings.provider_id && (
                            <span className="s7-tag-current">当前</span>
                          )}
                        </span>
                        <span className="option-note">
                          {p.base_url || "未填地址"}
                          {settings.api_keys[p.id]?.trim() ? " · 已配置 Key" : " · 未配置 Key"}
                        </span>
                        {p.id === viewProviderId && <span className="check">✓</span>}
                      </button>
                    ))}
                  </div>
                  {/* “查看”与“选用”分开（P1-3）：行只选中查看，生效要另点这个按钮。 */}
                  {!isViewingActive && provider && (
                    <div className="drawer-row">
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={applyProvider}
                      >
                        设为当前服务商
                      </button>
                      {switchNote && <span className="test-ok">{switchNote}</span>}
                    </div>
                  )}
                  {isViewingActive && switchNote && (
                    <p className="drawer-note test-ok">{switchNote}</p>
                  )}
                  {isCustom && (
                    <>
                      <label className="field-label" htmlFor="settings-provider-name">
                        服务商名称
                      </label>
                      <input
                        id="settings-provider-name"
                        className="field-input"
                        value={provider.name}
                        onChange={(e) => updateProvider({ name: e.target.value })}
                        autoComplete="off"
                      />
                    </>
                  )}
                  {/* 位置纪律：加/删服务商是“选服务商”这一步的分支，紧跟服务商列表放，
                      不丢到测试结果后面——流程是：选服务商（没有就添加）→ 填 Key →
                      填地址 → 测连通 → 拉模型 → 选模型。 */}
                  <div className="drawer-row">
                    <button type="button" className="btn-ghost" onClick={addCustomProvider}>
                      ＋ 添加自定义服务商
                    </button>
                    {isCustom && (
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={deleteCustomProvider}
                      >
                        删除此服务商
                      </button>
                    )}
                  </div>
                </div>
                {/* 连接单独成卡：Key → 地址 → 测连通 → 拉列表，别和服务商列表挤在一张卡里。 */}
                <div className="s7-group">
                  <div className="drawer-section">连接</div>
                  <label className="field-label" htmlFor="settings-key">
                    {provider?.name ?? ""} 的 API Key
                  </label>
                  <div className="s7-key-row">
                    <input
                      id="settings-key"
                      className="field-input"
                      type={showKey ? "text" : "password"}
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      placeholder="粘贴 API Key"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setShowKey((v) => !v)}
                      aria-label={showKey ? "隐藏 Key" : "显示 Key"}
                    >
                      {showKey ? "隐藏" : "显示"}
                    </button>
                  </div>
                  <span className={key.trim() ? "test-ok" : "s7-key-state"}>
                    {key.trim() ? "✓ 已配置" : "未配置 Key"}
                  </span>
                  <label className="field-label" htmlFor="settings-base-url">
                    服务商地址（base_url）
                  </label>
                  <input
                    id="settings-base-url"
                    className="field-input"
                    value={provider?.base_url ?? ""}
                    onChange={(e) => updateProvider({ base_url: e.target.value })}
                    placeholder="例如 https://api.deepseek.com/v1 或 http://127.0.0.1:8790/v1"
                    autoComplete="off"
                  />
                  <label className="field-label" htmlFor="settings-access-kind">
                    接入方式
                  </label>
                  <select
                    id="settings-access-kind"
                    className="field-input"
                    value={provider?.kind ?? "direct"}
                    onChange={(e) => updateProvider({ kind: e.target.value })}
                  >
                    <option value="direct">官方直连</option>
                    <option value="relay">中转站（反代）</option>
                  </select>
                  <p className="drawer-note">
                    同一个模型在官方与中转站上的 ID 不一样（官方 V4.1-Flash 是 deepseek-flash，中转站上是 deepseek-v4-flash），按接入方式自动换算。
                  </p>
                  <div className="drawer-row">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => onTestConnection(provider?.id ?? settings.provider_id)}
                      disabled={testing}
                    >
                      {testing ? "测试中…" : "测试连通"}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={fetchModels}
                      disabled={fetchingModels || !provider?.base_url?.trim()}
                      title={
                        provider?.base_url?.trim()
                          ? "从服务商拉取可用模型"
                          : "先填服务商地址"
                      }
                    >
                      {fetchingModels ? "拉取中…" : "自动读取模型列表"}
                    </button>
                  </div>
                  {testResult && (
                    <span className={testResult.ok ? "test-ok" : "test-fail"}>
                      {testResult.ok ? "✓ " : "✕ "}
                      {testResult.ok ? testResult.detail : humanizeTestError(testResult.detail)}
                    </span>
                  )}
                  {fetchResult && (
                    <span className={fetchResult.ok ? "test-ok" : "test-fail"}>
                      {fetchResult.ok ? "✓ " : "✕ "}
                      {fetchResult.ok ? fetchResult.detail : humanizeTestError(fetchResult.detail)}
                    </span>
                  )}
                  <p className="drawer-note">
                    Key 只保存在本机设置文件里，不会上传到任何地方。测试会向所选服务商发一次最小请求（消耗极少量额度）。
                  </p>
                </div>
                <div className="s7-group">
                  <div className="drawer-section">模型</div>
                  {!isViewingActive && (
                    <p className="drawer-note">
                      正在查看 {provider?.name ?? ""} 的模型列表（不是当前服务商）。先点「设为当前服务商」，再选模型。
                    </p>
                  )}
                  {providerModels.length === 0 ? (
                    <div className="s7-empty">
                      该服务商还没有模型列表
                      <span>点「自动读取模型列表」从服务商拉取；没配 Key 之前这里是空的，不显示假模型。</span>
                    </div>
                  ) : (
                    <div className="option-list" role="listbox" aria-label="模型">
                      {providerModels.map((m) =>
                        isViewingActive ? (
                          <button
                            key={m}
                            type="button"
                            role="option"
                            aria-selected={m === settings.model}
                            className={`option ${m === settings.model ? "selected" : ""}`}
                            onClick={() => onPatch({ model: m })}
                          >
                            <span>{m}</span>
                            {m === settings.model && <span className="check">✓</span>}
                          </button>
                        ) : (
                          <div key={m} className="option static" role="option" aria-selected={false}>
                            <span>{m}</span>
                          </div>
                        ),
                      )}
                      {/* P2-17：“未在列表中”是展示行，不是按钮（以前 onClick 是 undefined 的死按钮）。 */}
                      {!modelInList && settings.model && (
                        <div className="option static selected" aria-selected>
                          <span>{settings.model}</span>
                          <span className="option-note">未在列表中</span>
                          <span className="check">✓</span>
                        </div>
                      )}
                    </div>
                  )}
                  <label className="field-label" htmlFor="settings-compression-model">
                    压缩模型
                  </label>
                  <input
                    id="settings-compression-model"
                    className="field-input"
                    value={settings.compression_model ?? "deepseek-flash"}
                    onChange={(e) => onPatch({ compression_model: e.target.value })}
                    placeholder="deepseek-flash"
                    autoComplete="off"
                  />
                  <p className="drawer-note">
                    压缩历史时用的模型，和上面选的主模型分开改；改主模型不会动它。
                  </p>
                </div>
                {/* P2-16：高级折叠已删。Codex CLI 路径收进模型组底部一行小字。 */}
                <div className="s7-group s7-codex-line">
                  <span className="drawer-note">
                    备用引擎 Codex CLI：
                    {codexInfo
                      ? codexInfo.found
                        ? ` 已检测到 ${codexInfo.version}`
                        : ` 未检测到（${codexInfo.version}）`
                      : " 正在检测…"}
                  </span>
                  <input
                    className="field-input s7-codex-input"
                    value={settings.codex_path}
                    onChange={(e) => onPatch({ codex_path: e.target.value })}
                    placeholder="codex（留空则从 PATH 解析）"
                    aria-label="Codex 路径"
                    autoComplete="off"
                  />
                  {!codexInfo?.found && (
                    <span className="drawer-note">
                      安装：<code>npm install -g @openai/codex</code>
                    </span>
                  )}
                </div>
              </>
            )}

            {nav === "workstyle" && (
              <>
                <div className="s7-group">
                  <div className="drawer-section">模式</div>
                  <div className="effort-row" role="group" aria-label="模式">
                    <button
                      type="button"
                      className={`effort ${settings.mode === "norma" ? "selected" : ""}`}
                      onClick={() => onModeChange("norma")}
                    >
                      诺玛 · 通用
                    </button>
                    <button
                      type="button"
                      className={`effort ${settings.mode === "eva" ? "selected" : ""}`}
                      onClick={() => onModeChange("eva")}
                    >
                      EVA · 工程
                    </button>
                  </div>
                  <p className="drawer-note">
                    诺玛做通用工作，EVA 做工程开发。切换模式会有一段短暂仪式；切换时会带上该模式的默认思考强度与审批（诺玛默认
                    中等 / 写前确认，EVA 默认高 / 全自动），之后可以再改；Ultracode 开关不动。
                  </p>
                </div>
                <div className="s7-group">
                  <div className="drawer-section">思考强度</div>
                  <div className="effort-row" role="group" aria-label="思考强度">
                    {EFFORTS.map((ef) => (
                      <button
                        key={ef}
                        type="button"
                        className={`effort ${settings.effort === ef ? "selected" : ""}`}
                        onClick={() => onPatch({ effort: ef })}
                      >
                        {EFFORT_LABELS[ef]}
                      </button>
                    ))}
                  </div>
                  <p className="drawer-note">{EFFORT_DESCS[settings.effort]}</p>
                  <p className="drawer-note">
                    思考强度只管一轮想多深，与模式、Ultracode 各自独立。
                  </p>
                </div>
                <div className="s7-group">
                  <div className="drawer-section">Ultracode</div>
                  <div className="drawer-row">
                    <span className="drawer-note">
                      高级工程工作流：多智能体并行、交叉验证、迭代
                    </span>
                    <button
                      type="button"
                      className="switch-btn"
                      role="switch"
                      aria-checked={settings.ultracode}
                      aria-label="Ultracode 开关"
                      onClick={() => onPatch({ ultracode: !settings.ultracode })}
                    >
                      <span
                        className={`switch ${settings.ultracode ? "on" : ""}`}
                        aria-hidden="true"
                      >
                        <span className="knob" />
                      </span>
                    </button>
                  </div>
                  <p className="drawer-note">
                    当前引擎还是单智能体循环：打开后开关会传给引擎并记录下来，多智能体并行编排在后续版本接入，不会假装已经实现。
                  </p>
                </div>
              </>
            )}

            {nav === "permissions" && (
              <>
                <div className="s7-group">
                  <div className="drawer-section">守夜人模式</div>
                  <p className="drawer-note">
                    危险操作先审批。审批与沙箱是两个独立的拨杆：审批管“要不要问你”，沙箱管“能碰哪些文件”。
                  </p>
                  <div className="field-label">审批模式</div>
                  <div className="effort-row" role="group" aria-label="审批模式">
                    <button
                      type="button"
                      className={`effort ${settings.approval === "auto" ? "selected" : ""}`}
                      onClick={() => onPatch({ approval: "auto" as Approval })}
                    >
                      Auto 全自动
                    </button>
                    <button
                      type="button"
                      className={`effort ${settings.approval === "ask" ? "selected" : ""}`}
                      onClick={() => onPatch({ approval: "ask" as Approval })}
                    >
                      写前确认
                    </button>
                    <button
                      type="button"
                      className={`effort ${settings.approval === "read-only" ? "selected" : ""}`}
                      onClick={() => onPatch({ approval: "read-only" as Approval })}
                    >
                      只读
                    </button>
                  </div>
                  <p className="drawer-note">
                    {APPROVAL_DESCS[settings.approval]}
                  </p>
                </div>
                <div className="s7-group">
                  <div className="drawer-section">删除确认</div>
                  <p className="drawer-note">
                    删文件、执行删除命令时要不要单独问你一次。默认每次都问；嫌烦可以在这里关掉，随时能改回来。
                  </p>
                  <div className="effort-row" role="group" aria-label="删除确认">
                    <button
                      type="button"
                      className={`effort ${settings.delete_confirm === "always" ? "selected" : ""}`}
                      onClick={() => onPatch({ delete_confirm: "always" as DeleteConfirm })}
                    >
                      每次都问
                    </button>
                    <button
                      type="button"
                      className={`effort ${settings.delete_confirm === "never" ? "selected" : ""}`}
                      onClick={() => onPatch({ delete_confirm: "never" as DeleteConfirm })}
                    >
                      不再询问
                    </button>
                  </div>
                  <p className="drawer-note">
                    {DELETE_CONFIRM_DESCS[settings.delete_confirm]}
                  </p>
                </div>
                <div className="s7-group">
                  <div className="drawer-section">沙箱模式</div>
                  <div className="effort-row" role="group" aria-label="沙箱模式">
                    {(Object.keys(SANDBOX_LABELS) as Sandbox[]).map((sb) => (
                      <button
                        key={sb}
                        type="button"
                        className={`effort ${settings.sandbox === sb ? "selected" : ""}`}
                        onClick={() => onPatch({ sandbox: sb })}
                      >
                        {SANDBOX_LABELS[sb]}
                      </button>
                    ))}
                  </div>
                  <p className="drawer-note">{SANDBOX_DESCS[settings.sandbox]}</p>
                </div>
              </>
            )}

            {nav === "appearance" && (
              <>
                {/* 启动动画放外观组第一项（用户 2026-11-13 定：显眼位置，别藏三级深处）。 */}
                <div className="s7-group">
                  <div className="drawer-section">启动动画</div>
                  <div className="drawer-row">
                    <span>启动动画</span>
                    <button
                      type="button"
                      className={`switch ${settings.boot_animation ? "on" : ""}`}
                      role="switch"
                      aria-checked={settings.boot_animation}
                      aria-label="启动动画开关"
                      onClick={() => onPatch({ boot_animation: !settings.boot_animation })}
                    >
                      <span className="knob" />
                    </button>
                  </div>
                  <p className="drawer-note">
                    打开软件时播放七步登录仪式，约 20 秒；关闭后直接进入工作区。
                  </p>
                </div>
                <div className="s7-group">
                  <div className="drawer-section">主题</div>
                  <div className="effort-row" role="group" aria-label="主题">
                    <button
                      type="button"
                      className={`effort ${settings.theme === "light" ? "selected" : ""}`}
                      onClick={() => onPatch({ theme: "light" })}
                    >
                      ☀ 浅色
                    </button>
                    <button
                      type="button"
                      className={`effort ${settings.theme === "dark" ? "selected" : ""}`}
                      onClick={() => onPatch({ theme: "dark" })}
                    >
                      ☾ 深色
                    </button>
                    <button
                      type="button"
                      className={`effort ${settings.theme === "system" ? "selected" : ""}`}
                      onClick={() => onPatch({ theme: "system" })}
                    >
                      ◐ 跟随系统
                    </button>
                  </div>
                  <p className="drawer-note">
                    跟随系统时，系统一切、应用跟着切。主题也可以在命令面板（
                    {modKey("K")}）里切。
                  </p>
                </div>
                <div className="s7-group">
                  <div className="drawer-section">快捷键</div>
                  <div className="s7-kbd-list">
                    <div><kbd>⌘/Ctrl K</kbd><span>命令面板</span></div>
                    <div><kbd>⌘/Ctrl ,</kbd><span>打开设置</span></div>
                    <div><kbd>⌘/Ctrl N</kbd><span>新建任务</span></div>
                    <div><kbd>Enter</kbd><span>发送</span></div>
                    <div><kbd>Shift + Enter</kbd><span>换行</span></div>
                    <div><kbd>Esc</kbd><span>关闭面板 / 跳过开机动画</span></div>
                  </div>
                </div>
                <div className="s7-group">
                  <div className="drawer-section">关于</div>
                  <p className="drawer-note">
                    卡塞尔专员终端 {APP_VERSION}。卡塞尔学院配发给专员的日常执行终端。
                    AI 是诺玛；打开 EVA 开关后，诺玛切换为 EVA 模式（工程开发）。
                  </p>
                  <p className="drawer-note">
                    执行引擎是应用自带的原生引擎，直连 OpenAI 兼容接口；界面是 Tauri 2 + React。
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cmd-K 命令面板（S7，§4.3）：560px 居中面板，输入即过滤，上下键选，   */
/* 回车执行，Esc 关闭。命令来自 ./commands 的注册表，每条都执行真实动作。*/
/* ------------------------------------------------------------------ */

export function CommandPalette({
  onClose,
  closing = false,
  getItems,
}: {
  onClose: () => void;
  /** 正在退场：先播 180ms 上收动画再卸载（App 的 useOverlayExitValue）。 */
  closing?: boolean;
  getItems: (query: string) => CommandItem[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const items = getItems(query);
  const sel = Math.min(selected, Math.max(0, items.length - 1));

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-cmd-idx="${sel}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const run = (item: CommandItem) => {
    onClose();
    item.run();
  };

  let lastGroup = "";
  return (
    <div
      className={closing ? "s7-palette-overlay closing" : "s7-palette-overlay"}
      onClick={onClose}
      role="presentation"
    >
      <div
        className={closing ? "s7-palette closing" : "s7-palette"}
        role="dialog"
        aria-label="命令面板"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="s7-palette-input">
          <span className="s7-palette-prompt" aria-hidden="true">
            {modKey("K")}
          </span>
          <input
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => Math.min(s + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const item = items[sel];
                if (item) run(item);
              } else if (e.key === "Escape") {
                // 兜底：App 的中央 Esc 处理（捕获阶段）会先关面板，这里只是备用。
                onClose();
              }
            }}
            placeholder="输入命令，或搜一个任务…"
            aria-label="命令搜索"
          />
          <kbd className="s7-palette-esc">Esc</kbd>
        </div>
        <div className="s7-palette-list" ref={listRef}>
          {items.length === 0 && (
            <div className="s7-empty">
              没有找到「{query}」
              <span>换个词试试，或直接回车新建任务。</span>
              <button type="button" className="btn-ghost" onClick={() => setQuery("")}>
                清除搜索
              </button>
            </div>
          )}
          {items.map((item, idx) => {
            const head =
              item.group !== lastGroup ? (
                <div className="s7-palette-group" key={`g-${item.group}-${idx}`}>
                  {item.group}
                </div>
              ) : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {head}
                <button
                  type="button"
                  data-cmd-idx={idx}
                  className={`s7-palette-item ${idx === sel ? "sel" : ""}`}
                  onMouseEnter={() => setSelected(idx)}
                  onClick={() => run(item)}
                >
                  <span>{item.title}</span>
                  {item.hint && <span className="s7-palette-hint">{item.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="s7-palette-foot">
          <span>↑↓ 选择</span>
          <span>回车 执行</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}

/* 档案库（P2-20）：搜索框 + 每行“彻底删除”（两步确认，删了就没了）。 */
export function ArchiveDrawer({
  tasks,
  onRestore,
  onDelete,
  onClose,
  closing = false,
}: {
  tasks: Task[];
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  /** 正在退场：先播 180ms 滑出动画再卸载（App 的 useOverlayExitValue）。 */
  closing?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const archived = tasks.filter((t) => t.archived);
  const shown = query.trim()
    ? archived.filter((t) =>
        t.title.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : archived;
  return (
    <DrawerShell title="档案库" onClose={onClose} closing={closing}>
      {archived.length > 0 && (
        <input
          className="field-input s7-archive-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索已归档的任务…"
          aria-label="搜索已归档的任务"
          autoComplete="off"
        />
      )}
      {archived.length === 0 && (
        <div className="rp-empty">
          <div className="rp-empty-title">档案库是空的</div>
          <div className="rp-empty-text">
            归档的任务会留在这里，可以随时恢复。
          </div>
        </div>
      )}
      {archived.length > 0 && shown.length === 0 && (
        <div className="rp-empty">
          <div className="rp-empty-title">没有匹配的任务</div>
          <div className="rp-empty-text">换个词试试。</div>
        </div>
      )}
      {shown.map((t) => (
        <div key={t.id} className="archive-row">
          <div>
            <div className="archive-title">{t.title}</div>
            <div className="archive-meta">
              {t.project} · {new Date(t.createdAt).toLocaleString("zh-CN")}
            </div>
          </div>
          <div className="archive-actions">
            <button type="button" className="btn-ghost" onClick={() => onRestore(t.id)}>
              恢复
            </button>
            {confirmDeleteId === t.id ? (
              <>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => {
                    onDelete(t.id);
                    setConfirmDeleteId(null);
                  }}
                >
                  确认删除
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setConfirmDeleteId(null)}
                >
                  取消
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setConfirmDeleteId(t.id)}
              >
                彻底删除
              </button>
            )}
          </div>
        </div>
      ))}
    </DrawerShell>
  );
}

export function HelpDrawer({
  onClose,
  closing = false,
}: {
  onClose: () => void;
  /** 正在退场：先播 180ms 滑出动画再卸载（App 的 useOverlayExitValue）。 */
  closing?: boolean;
}) {
  const openLink = (u: string) => {
    openUrl(u).catch(() => undefined);
  };
  return (
    <DrawerShell title="帮助" onClose={onClose} closing={closing}>
      <div className="drawer-section">卡塞尔专员终端 {APP_VERSION}</div>
      <p className="drawer-note">
        卡塞尔学院配发给专员的日常执行终端。AI 是诺玛；打开 EVA 开关后，诺玛切换为
        EVA 模式（工程开发）。
      </p>
      <div className="drawer-section">怎么用</div>
      <ul className="help-list">
        <li>先在设置里填好服务商的 API Key，点“测试连通”；没配 Key 时问候区有个“连接模型服务商”按钮，会打开三步向导。</li>
        <li>也可以添加自定义服务商（填自己的反代地址），再点“自动读取模型列表”。</li>
        <li>在输入框里给诺玛下指令，回车发送；Shift + Enter 换行。</li>
        <li>输入框下方的模型按钮里换服务商、模型与思考强度；思考强度点选只打勾、不关闭菜单，选到模型才收起。</li>
        <li>输入框下方的诺玛/EVA 芯片、左栏名册、命令面板（{modKey("K")}
        ）里都能切换模式；切换有一段短暂仪式。</li>
        <li>诺玛改动文件后，点顶部“审查”入口（带待审查数量）在浮层 Inspector 里逐项通过或拒绝；拒绝会把文件还原到 HEAD。</li>
        <li>浮层 Inspector 里还有终端、文件、工作流与插件；点浮层外或按 Esc 关闭。</li>
        <li>每条消息悬停会出现复制 / 重试 / 编辑 / 删除；对话顶部的用量行会一直显示累计 token。</li>
      </ul>
      <div className="drawer-section">快捷键</div>
      <ul className="help-list">
        <li>⌘/Ctrl + K 命令面板 · ⌘/Ctrl + , 打开设置 · ⌘/Ctrl + N 新建任务</li>
        <li>Enter 发送 · Shift + Enter 换行</li>
        <li>Esc 关闭面板 / 跳过开机动画</li>
      </ul>
      <div className="drawer-section">引擎与开源</div>
      <p className="drawer-note">
        执行引擎是应用自带的原生引擎，直连 OpenAI 兼容接口；界面是 Tauri 2 +
        React。
      </p>
      <div className="drawer-row">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => openLink("https://tauri.app")}
        >
          Tauri ↗
        </button>
      </div>
    </DrawerShell>
  );
}
