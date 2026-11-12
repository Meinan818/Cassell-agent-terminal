import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  Approval,
  CodexInfo,
  Effort,
  ProviderConfig,
  Sandbox,
  Settings,
  Task,
} from "../types";
import { EFFORTS, EFFORT_LABELS, SANDBOX_LABELS } from "../types";

function DrawerShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
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
    <div className="drawer-overlay" onClick={onClose} role="presentation">
      <div
        className="drawer"
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

export function SettingsDrawer({
  settings,
  onPatch,
  onClose,
  codexInfo,
  onTestConnection,
  testing,
  testResult,
  onFetchModels,
  onPickFolder,
}: {
  settings: Settings;
  onPatch: (patch: Partial<Settings>) => void;
  onClose: () => void;
  codexInfo: CodexInfo | null;
  onTestConnection: () => void;
  testing: boolean;
  testResult: { ok: boolean; detail: string } | null;
  onFetchModels: () => Promise<{ ok: boolean; detail: string }>;
  onPickFolder: () => void;
}) {
  const [providerId, setProviderId] = useState(settings.provider_id);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchResult, setFetchResult] = useState<{
    ok: boolean;
    detail: string;
  } | null>(null);
  const provider =
    settings.providers.find((p) => p.id === providerId) ?? settings.providers[0];
  const key = provider ? settings.api_keys[provider.id] ?? "" : "";
  const isCustom = provider?.id.startsWith("custom-") ?? false;

  // 选中的服务商被删掉后，回落到当前生效的服务商
  useEffect(() => {
    if (!settings.providers.some((p) => p.id === providerId)) {
      setProviderId(settings.provider_id);
    }
  }, [settings.providers, settings.provider_id, providerId]);

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

  // 在设置里选服务商 = 直接切换生效的服务商（测试与拉列表都按它来）
  const selectProvider = (id: string) => {
    const p = settings.providers.find((x) => x.id === id);
    if (!p) return;
    setProviderId(id);
    onPatch({
      provider_id: id,
      model: p.default_model || p.models[0] || "",
    });
  };

  // 自定义服务商：名字 + 地址 + Key 自己填，走 OpenAI 兼容接口（自己的反代也能接）
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
    onPatch({
      providers: [...settings.providers, np],
      provider_id: id,
      model: "",
    });
    setProviderId(id);
    setFetchResult(null);
  };

  const deleteCustomProvider = () => {
    if (!provider || !isCustom) return;
    const rest = settings.providers.filter((p) => p.id !== provider.id);
    if (rest.length === 0) return;
    const next = rest[0];
    const nextKeys = { ...settings.api_keys };
    delete nextKeys[provider.id];
    onPatch({
      providers: rest,
      provider_id: next.id,
      model: next.default_model || next.models[0] || "",
      api_keys: nextKeys,
    });
    setProviderId(next.id);
  };

  const fetchModels = async () => {
    if (!provider) return;
    setFetchingModels(true);
    setFetchResult(null);
    const r = await onFetchModels();
    setFetchResult(r);
    setFetchingModels(false);
  };

  const providerModels = provider?.models ?? [];
  const modelInList = providerModels.includes(settings.model);

  return (
    <DrawerShell title="设置" onClose={onClose}>
      {/* 1. 个人资料 */}
      <div className="drawer-section">个人资料</div>
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
      <p className="drawer-note">
        编号 S2017-0117 · 血统评级 S。问候与身份卡显示这个名字。
      </p>

      {/* 2. 模式：NORMA / EVA 两个平等模式，与思考强度、Ultracode 各自独立 */}
      <div className="drawer-section">模式</div>
      <div className="effort-row" role="group" aria-label="模式">
        <button
          type="button"
          className={`effort ${settings.mode === "norma" ? "selected" : ""}`}
          onClick={() => onPatch({ mode: "norma" })}
        >
          诺玛 · 通用
        </button>
        <button
          type="button"
          className={`effort ${settings.mode === "eva" ? "selected" : ""}`}
          onClick={() => onPatch({ mode: "eva" })}
        >
          EVA · 工程
        </button>
      </div>
      <p className="drawer-note">
        诺玛做通用工作，EVA 做工程开发。切换模式只换人设与工作方式，不改思考强度，也不动
        Ultracode 开关。
      </p>

      {/* 3. 模型服务商 */}
      <div className="drawer-section">模型服务商</div>
      <p className="drawer-note">
        配好 API Key 和服务商地址，就能连上服务商、拉取模型列表。支持你自己的
        OpenAI 兼容反代。
      </p>
      <label className="field-label" htmlFor="settings-provider">
        服务商
      </label>
      <select
        id="settings-provider"
        className="field-input"
        value={providerId}
        onChange={(e) => selectProvider(e.target.value)}
      >
        {settings.providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}（{p.base_url || "未填地址"}）
          </option>
        ))}
      </select>
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
      <label className="field-label" htmlFor="settings-key">
        {provider?.name ?? ""} 的 API Key
      </label>
      <input
        id="settings-key"
        className="field-input"
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="粘贴 API Key"
        autoComplete="off"
      />
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
      <div className="drawer-row">
        <button
          type="button"
          className="btn-primary"
          onClick={onTestConnection}
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
          {testResult.detail}
        </span>
      )}
      {fetchResult && (
        <span className={fetchResult.ok ? "test-ok" : "test-fail"}>
          {fetchResult.ok ? "✓ " : "✕ "}
          {fetchResult.detail}
        </span>
      )}
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
      <p className="drawer-note">
        Key 只保存在本机设置文件里，不会上传到任何地方。测试会向所选服务商发一次最小请求（消耗极少量额度）。
      </p>

      {/* 3. 模型与思考强度 */}
      <div className="drawer-section">模型与思考强度</div>
      <label className="field-label" htmlFor="settings-model">
        模型
      </label>
      <select
        id="settings-model"
        className="field-input"
        value={settings.model}
        onChange={(e) => onPatch({ model: e.target.value })}
      >
        {providerModels.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        {!modelInList && settings.model && (
          <option value={settings.model}>
            {settings.model}（未在列表中）
          </option>
        )}
        {providerModels.length === 0 && !settings.model && (
          <option value="">先拉取模型列表</option>
        )}
      </select>
      <label className="field-label" htmlFor="settings-effort">
        思考强度
      </label>
      <select
        id="settings-effort"
        className="field-input"
        value={settings.effort}
        onChange={(e) => onPatch({ effort: e.target.value as Effort })}
      >
        {EFFORTS.map((ef) => (
          <option key={ef} value={ef}>
            {EFFORT_LABELS[ef]}
          </option>
        ))}
      </select>

      {/* Ultracode：独立开关，与模式、思考强度互不联动 */}
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

      {/* 4. 工作区 */}
      <div className="drawer-section">工作区</div>
      <div className="drawer-row">
        <span className="drawer-note">
          {settings.workdir || "还没有选择项目文件夹"}
        </span>
        <button type="button" className="btn-primary" onClick={onPickFolder}>
          选择文件夹…
        </button>
      </div>
      <p className="drawer-note">
        诺玛只在这个目录里读写文件。审查队列按这里的 Git 状态生成。
      </p>

      {/* 5. 权限与沙箱 */}
      <div className="drawer-section">权限与沙箱</div>
      <label className="field-label" htmlFor="settings-approval">
        审批模式
      </label>
      <select
        id="settings-approval"
        className="field-input"
        value={settings.approval}
        onChange={(e) => onPatch({ approval: e.target.value as Approval })}
      >
        <option value="auto">Auto 全自动</option>
        <option value="read-only">只读确认</option>
      </select>
      <label className="field-label" htmlFor="settings-sandbox">
        沙箱模式
      </label>
      <select
        id="settings-sandbox"
        className="field-input"
        value={settings.sandbox}
        onChange={(e) => onPatch({ sandbox: e.target.value as Sandbox })}
      >
        {(Object.keys(SANDBOX_LABELS) as Sandbox[]).map((sb) => (
          <option key={sb} value={sb}>
            {SANDBOX_LABELS[sb]}
          </option>
        ))}
      </select>

      {/* 6. 外观与启动 */}
      <div className="drawer-section">外观与启动</div>
      <div className="drawer-row">
        <span>主题</span>
        <button
          type="button"
          className="btn-ghost"
          onClick={() =>
            onPatch({ theme: settings.theme === "light" ? "dark" : "light" })
          }
        >
          {settings.theme === "light" ? "☀ 浅色" : "☾ 深色"}
        </button>
      </div>
      <div className="drawer-row">
        <span>开机动画</span>
        <button
          type="button"
          className={`switch ${settings.boot_animation ? "on" : ""}`}
          role="switch"
          aria-checked={settings.boot_animation}
          aria-label="开机动画开关"
          onClick={() => onPatch({ boot_animation: !settings.boot_animation })}
        >
          <span className="knob" />
        </button>
      </div>
      <div className="drawer-row">
        <span>流式输出</span>
        <button
          type="button"
          className={`switch ${settings.streaming ? "on" : ""}`}
          role="switch"
          aria-checked={settings.streaming}
          aria-label="流式输出开关"
          onClick={() => onPatch({ streaming: !settings.streaming })}
        >
          <span className="knob" />
        </button>
      </div>

      {/* 高级设置 */}
      <button
        type="button"
        className="drawer-advanced-toggle"
        onClick={() => setAdvancedOpen(!advancedOpen)}
        aria-expanded={advancedOpen}
      >
        高级设置 {advancedOpen ? "▾" : "▸"}
      </button>
      {advancedOpen && (
        <>
          <div className="drawer-section">Codex CLI（备用引擎）</div>
          <div className="drawer-note">
            {codexInfo
              ? codexInfo.found
                ? `✓ 已检测到：${codexInfo.version}（${codexInfo.path}）`
                : `✕ ${codexInfo.version}`
              : "正在检测…"}
          </div>
          <label className="field-label" htmlFor="settings-codex-path">
            Codex 路径（留空则从 PATH 解析）
          </label>
          <input
            id="settings-codex-path"
            className="field-input"
            value={settings.codex_path}
            onChange={(e) => onPatch({ codex_path: e.target.value })}
            placeholder="codex"
          />
          {!codexInfo?.found && (
            <p className="drawer-note">
              未检测到 Codex CLI。安装：
              <code>npm install -g @openai/codex</code>
            </p>
          )}
        </>
      )}
    </DrawerShell>
  );
}

export function ArchiveDrawer({
  tasks,
  onRestore,
  onClose,
}: {
  tasks: Task[];
  onRestore: (id: string) => void;
  onClose: () => void;
}) {
  const archived = tasks.filter((t) => t.archived);
  return (
    <DrawerShell title="档案库" onClose={onClose}>
      {archived.length === 0 && (
        <div className="rp-empty">
          <div className="rp-empty-title">档案库是空的</div>
          <div className="rp-empty-text">
            归档的任务会留在这里，可以随时恢复。
          </div>
        </div>
      )}
      {archived.map((t) => (
        <div key={t.id} className="archive-row">
          <div>
            <div className="archive-title">{t.title}</div>
            <div className="archive-meta">
              {t.project} · {new Date(t.createdAt).toLocaleString("zh-CN")}
            </div>
          </div>
          <button type="button" className="btn-ghost" onClick={() => onRestore(t.id)}>
            恢复
          </button>
        </div>
      ))}
    </DrawerShell>
  );
}

export function HelpDrawer({ onClose }: { onClose: () => void }) {
  const openLink = (u: string) => {
    openUrl(u).catch(() => undefined);
  };
  return (
    <DrawerShell title="帮助" onClose={onClose}>
      <div className="drawer-section">卡塞尔专员终端 0.1.6</div>
      <p className="drawer-note">
        卡塞尔学院配发给专员的日常执行终端。AI 是诺玛；打开 EVA 开关后，诺玛切换为
        EVA 模式——并行编排任务、多智能体交叉核查。
      </p>
      <div className="drawer-section">怎么用</div>
      <ul className="help-list">
        <li>先在设置里填好服务商的 API Key，点“测试连通”。</li>
        <li>也可以添加自定义服务商（填自己的反代地址），再点“自动读取模型列表”。</li>
        <li>在输入框里给诺玛下指令，回车发送；Shift + Enter 换行。</li>
        <li>模型按钮里换服务商、模型与思考强度；EVA 开关在输入框右侧。</li>
        <li>诺玛改动文件后，右侧“审查”里逐项通过或拒绝；拒绝会把文件还原到 HEAD。</li>
        <li>右侧“终端”可以直接跑命令；“文件”可以浏览工作区并预览。</li>
      </ul>
      <div className="drawer-section">快捷键</div>
      <ul className="help-list">
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
