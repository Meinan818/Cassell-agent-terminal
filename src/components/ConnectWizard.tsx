import { useState } from "react";
import type { Settings } from "../types";

/* ------------------------------------------------------------------ */
/* /connect 式三步向导（P0-5）：只在没配好 Key 时出现。流程是选服务商  */
/* → 粘贴 Key → 点“测试连通”（给人话原因）→ 拉模型列表 → 完成。       */
/* 测试失败绝不原样贴 JSON/原始报错：401/403 必须说明原因 + 下一步。   */
/* ------------------------------------------------------------------ */

/** 把引擎 test_provider / list_models 返回的 detail 翻译成人话。 */
export function humanizeTestError(detail: string): string {
  const d = detail ?? "";
  if (/401|unauthorized|incorrect api key|invalid api key|invalid_api_key/i.test(d)) {
    return "API Key 无效或已过期：到服务商控制台确认 Key 的状态与余额，重新粘贴一次。";
  }
  if (/403|forbidden|permission|insufficient/i.test(d)) {
    return "Key 无权访问该模型或地址：确认 Key 与服务商地址是同一家的，并确认该 Key 的可用模型里有要用的模型。";
  }
  if (/404|not found/i.test(d)) {
    return "地址或模型不存在：检查服务商地址有没有写错、模型名是否在服务商的列表里。";
  }
  if (/timed? ?out|timeout|connect|dns|network|econnrefused|failed to fetch|name resolution/i.test(d)) {
    return "连不上服务商地址：检查服务商地址是否填对、网络是否通畅。";
  }
  const t = d.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    return "服务商返回了一段看不懂的错误——重试一次；还不行就检查 Key 与服务商地址。";
  }
  return t || "测试失败，但服务商没给具体原因：重试一次，或检查 Key 与服务商地址。";
}

interface ConnectWizardProps {
  settings: Settings;
  onPatch: (patch: Partial<Settings>) => void;
  /** 测指定服务商的连通（不切换当前服务商）。 */
  onTestConnection: (providerId: string) => Promise<{ ok: boolean; detail: string }>;
  /** 从指定服务商拉模型列表（不切换当前服务商）。 */
  onFetchModels: (providerId: string) => Promise<{ ok: boolean; detail: string }>;
  onClose: () => void;
  /** “稍后在设置里配”：关向导、打开设置 → 模型页。 */
  onOpenSettings: () => void;
}

const STEPS = ["选服务商", "粘贴 Key", "测试连通"];

export default function ConnectWizard({
  settings,
  onPatch,
  onTestConnection,
  onFetchModels,
  onClose,
  onOpenSettings,
}: ConnectWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selId, setSelId] = useState(settings.provider_id);
  const [key, setKey] = useState(settings.api_keys[settings.provider_id] ?? "");
  const [baseUrl, setBaseUrl] = useState(
    settings.providers.find((p) => p.id === settings.provider_id)?.base_url ?? "",
  );
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState<{ ok: boolean; detail: string } | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchRes, setFetchRes] = useState<{ ok: boolean; detail: string } | null>(null);

  const provider =
    settings.providers.find((p) => p.id === selId) ?? settings.providers[0];

  const pickProvider = (id: string) => {
    const p = settings.providers.find((x) => x.id === id);
    if (!p) return;
    setSelId(id);
    setKey(settings.api_keys[id] ?? "");
    setBaseUrl(p.base_url);
    setTestRes(null);
    setFetchRes(null);
    setStep(2);
  };

  const saveKeyAndGo = () => {
    if (!provider) return;
    onPatch({
      api_keys: { ...settings.api_keys, [provider.id]: key },
      providers: settings.providers.map((p) =>
        p.id === provider.id ? { ...p, base_url: baseUrl } : p,
      ),
    });
    setTestRes(null);
    setFetchRes(null);
    setStep(3);
  };

  const runTest = async () => {
    if (!provider || testing) return;
    setTesting(true);
    setTestRes(null);
    try {
      const r = await onTestConnection(provider.id);
      setTestRes(r);
    } catch (e) {
      setTestRes({ ok: false, detail: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const runFetch = async () => {
    if (!provider || fetching) return;
    setFetching(true);
    try {
      const r = await onFetchModels(provider.id);
      setFetchRes(r);
    } catch (e) {
      setFetchRes({ ok: false, detail: String(e) });
    } finally {
      setFetching(false);
    }
  };

  const finish = () => {
    if (!provider) return;
    // 完成时才把这个服务商设为当前：拉到的模型里挑第一个当默认。
    const models = provider.models ?? [];
    onPatch({
      provider_id: provider.id,
      model:
        models.includes(settings.model) && provider.id === settings.provider_id
          ? settings.model
          : models[0] || provider.default_model || settings.model,
    });
    onClose();
  };

  return (
    <div className="s7-overlay" onClick={onClose} role="presentation">
      <div
        className="s7-modal s7-wizard"
        role="dialog"
        aria-label="连接模型服务商"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="s7-modal-head">
          <span className="s7-modal-title">连接模型服务商</span>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="s7-wizard-steps" aria-label="连接步骤">
          {STEPS.map((label, i) => (
            <span key={label} className={step === i + 1 ? "on" : step > i + 1 ? "done" : ""}>
              <b>{i + 1}</b>
              {label}
            </span>
          ))}
        </div>
        <div className="s7-modal-body">
          <div className="s7-content s7-wizard-content">
            {step === 1 && (
              <>
                <p className="drawer-note">
                  选一家服务商，粘贴它的 API Key 就能开始用。支持你自己的 OpenAI 兼容反代（选一家后在下一步改地址）。
                </p>
                <div className="option-list" role="listbox" aria-label="服务商">
                  {settings.providers.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      aria-selected={p.id === selId}
                      className={`option ${p.id === selId ? "selected" : ""}`}
                      onClick={() => pickProvider(p.id)}
                    >
                      <span>{p.name}</span>
                      <span className="option-note">
                        {settings.api_keys[p.id]?.trim() ? "已配置 Key" : "未配置 Key"}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === 2 && provider && (
              <>
                <label className="field-label" htmlFor="wizard-key">
                  {provider.name} 的 API Key
                </label>
                <div className="s7-key-row">
                  <input
                    id="wizard-key"
                    className="field-input"
                    type={showKey ? "text" : "password"}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="粘贴 API Key"
                    autoComplete="off"
                    autoFocus
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
                <label className="field-label" htmlFor="wizard-base-url">
                  服务商地址（base_url）
                </label>
                <input
                  id="wizard-base-url"
                  className="field-input"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="例如 https://api.deepseek.com/v1"
                  autoComplete="off"
                />
                <p className="drawer-note">
                  Key 只保存在本机设置文件里，不会上传到任何地方。
                </p>
                <div className="drawer-row">
                  <button type="button" className="btn-ghost" onClick={() => setStep(1)}>
                    ← 上一步
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={saveKeyAndGo}
                    disabled={!key.trim()}
                    title={key.trim() ? undefined : "先粘贴 API Key"}
                  >
                    下一步：测试连通 →
                  </button>
                </div>
              </>
            )}

            {step === 3 && provider && (
              <>
                <div className="s7-group">
                  <div className="drawer-section">1 · 测试连通</div>
                  <p className="drawer-note">
                    向 {provider.name} 发一次最小请求，确认 Key 和地址都对。
                  </p>
                  <div className="drawer-row">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={runTest}
                      disabled={testing}
                    >
                      {testing ? "测试中…" : testRes ? "重新测试" : "测试连通"}
                    </button>
                    {testRes && (
                      <span className={testRes.ok ? "test-ok" : "test-fail"}>
                        {testRes.ok ? "✓ 连通成功" : `✕ ${humanizeTestError(testRes.detail)}`}
                      </span>
                    )}
                  </div>
                </div>
                <div className="s7-group">
                  <div className="drawer-section">2 · 拉取模型列表</div>
                  <div className="drawer-row">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={runFetch}
                      disabled={!testRes?.ok || fetching}
                      title={testRes?.ok ? undefined : "先通过连通测试"}
                    >
                      {fetching ? "拉取中…" : "拉取模型列表"}
                    </button>
                    {fetchRes && (
                      <span className={fetchRes.ok ? "test-ok" : "test-fail"}>
                        {fetchRes.ok ? `✓ ${fetchRes.detail}` : `✕ ${humanizeTestError(fetchRes.detail)}`}
                      </span>
                    )}
                  </div>
                  {testRes?.ok && !fetchRes && (
                    <p className="drawer-note">
                      建议先拉取模型列表，不然模型还是空的、选不了。
                    </p>
                  )}
                </div>
                <div className="drawer-row">
                  <button type="button" className="btn-ghost" onClick={() => setStep(2)}>
                    ← 上一步，改 Key
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={finish}
                    disabled={!testRes?.ok}
                    title={testRes?.ok ? undefined : "先通过连通测试"}
                  >
                    完成，进入工作区
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="s7-wizard-foot">
          <button type="button" className="btn-ghost" onClick={onOpenSettings}>
            稍后在设置里配 →
          </button>
        </div>
      </div>
    </div>
  );
}
