"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Settings,
  Play,
  Pause,
  Square,
  Plus,
  X,
  Save,
  Loader2,
  Bell,
  Mail,
  AlertCircle,
  Zap,
  KeyRound,
  Trash2,
} from "lucide-react";

interface ProjectSettingsProps {
  project: {
    id: string;
    status: 'active' | 'paused' | 'stopped';
    customRules: string[];
    ownerEmail?: string;
    autoFixEnabled?: boolean;
    byok?: { keyHint?: string } | null;
    notificationPrefs?: {
      emailOnPush?: boolean;
      emailOnPR?: boolean;
      minSeverity?: string;
      additionalEmails?: string[];
    };
  };
  onUpdate: (updates: Partial<ProjectSettingsProps['project']>) => Promise<void>;
  onClose: () => void;
}

export function ProjectSettings({ project, onUpdate, onClose }: ProjectSettingsProps) {
  const [status, setStatus] = useState<'active' | 'paused' | 'stopped'>(project.status || 'active');
  const [customRules, setCustomRules] = useState<string[]>(project.customRules || []);
  const [newRule, setNewRule] = useState("");
  const [emailOnPush, setEmailOnPush] = useState(project.notificationPrefs?.emailOnPush ?? true);
  const [autoFixEnabled, setAutoFixEnabled] = useState(project.autoFixEnabled ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  // BYOK (Bring Your Own Key) — managed via a dedicated endpoint so the raw key
  // never round-trips through the generic settings PATCH.
  const [keyHint, setKeyHint] = useState<string | undefined>(project.byok?.keyHint);
  const [newKey, setNewKey] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMsg, setKeyMsg] = useState("");

  const handleSaveKey = async () => {
    if (!newKey.trim()) return;
    setKeyBusy(true);
    setKeyMsg("");
    try {
      const res = await fetch(`/api/code-police/projects/${project.id}/byok`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: newKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save key");
      setKeyHint(data.keyHint);
      setNewKey("");
      setKeyMsg("Key saved and encrypted.");
      toast.success("Gemini API key saved and encrypted successfully!");
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Failed to save key";
      setKeyMsg(errMsg);
      toast.error(errMsg);
    } finally {
      setKeyBusy(false);
    }
  };

  const handleRemoveKey = async () => {
    setKeyBusy(true);
    setKeyMsg("");
    try {
      const res = await fetch(`/api/code-police/projects/${project.id}/byok`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to remove key");
      }
      setKeyHint(undefined);
      setKeyMsg("Key removed. Using platform default.");
      toast.success("Gemini API key removed. Using platform default.");
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Failed to remove key";
      setKeyMsg(errMsg);
      toast.error(errMsg);
    } finally {
      setKeyBusy(false);
    }
  };

  const statusOptions = [
    {
      value: 'active' as const,
      label: 'Active',
      icon: Play,
      color: 'text-green-400 bg-green-500/10 border-green-500/30',
      description: 'Analyzing every push and PR'
    },
    {
      value: 'paused' as const,
      label: 'Paused',
      icon: Pause,
      color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
      description: 'Webhooks received but ignored'
    },
    {
      value: 'stopped' as const,
      label: 'Stopped',
      icon: Square,
      color: 'text-red-400 bg-red-500/10 border-red-500/30',
      description: 'No analysis, webhook removed'
    },
  ];

  const handleAddRule = () => {
    if (newRule.trim() && !customRules.includes(newRule.trim())) {
      setCustomRules([...customRules, newRule.trim()]);
      setNewRule("");
    }
  };

  const handleRemoveRule = (index: number) => {
    setCustomRules(customRules.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError("");

    try {
      await onUpdate({
        status,
        customRules,
        autoFixEnabled,
        notificationPrefs: {
          ...project.notificationPrefs,
          emailOnPush,
        },
      } as Partial<ProjectSettingsProps['project']>);
      toast.success("Project settings updated successfully!");
      onClose();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Failed to save settings";
      setError(errMsg);
      toast.error(errMsg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-zinc-800">
              <Settings className="w-5 h-5 text-zinc-400" />
            </div>
            <h2 className="text-lg font-semibold text-white">Project Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-180px)]">
          {/* Status Toggle */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-3">
              Project Status
            </label>
            <div className="grid grid-cols-3 gap-3">
              {statusOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setStatus(option.value)}
                  className={`p-3 rounded-xl border transition-all ${status === option.value
                      ? option.color + ' border-2'
                      : 'bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                    }`}
                >
                  <option.icon className="w-5 h-5 mx-auto mb-1" />
                  <p className="text-sm font-medium">{option.label}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              {statusOptions.find(o => o.value === status)?.description}
            </p>
          </div>

          {/* Custom Rules */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-3">
              Custom Rules
            </label>
            <p className="text-xs text-zinc-500 mb-3">
              Define specific rules for the AI to enforce (e.g., &ldquo;No console.logs&rdquo;, &ldquo;All functions must have JSDoc&rdquo;)
            </p>

            {/* Rules List */}
            <div className="space-y-2 mb-3">
              {customRules.map((rule, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 p-2 bg-zinc-800 rounded-lg"
                >
                  <span className="flex-1 text-sm text-zinc-300">{rule}</span>
                  <button
                    onClick={() => handleRemoveRule(index)}
                    className="p-1 hover:bg-zinc-700 rounded transition-colors"
                  >
                    <X className="w-4 h-4 text-zinc-500" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add Rule Input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newRule}
                onChange={(e) => setNewRule(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddRule()}
                placeholder="Add a custom rule..."
                className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                onClick={handleAddRule}
                disabled={!newRule.trim()}
                className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg transition-colors disabled:opacity-50"
              >
                <Plus className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>

          {/* Auto-Fix */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-3">
              <Zap className="w-4 h-4 inline mr-2" />
              Auto-Fix
            </label>

            <label className="flex items-center justify-between p-3 bg-zinc-800 rounded-lg cursor-pointer">
              <div className="flex items-center gap-3">
                <Zap className="w-4 h-4 text-emerald-400" />
                <div>
                  <span className="text-sm text-zinc-300">Auto-fix on push</span>
                  <p className="text-xs text-zinc-500">Automatically create PR with fixes</p>
                </div>
              </div>
              <div
                onClick={() => setAutoFixEnabled(!autoFixEnabled)}
                className={`w-10 h-6 rounded-full p-1 transition-colors cursor-pointer ${autoFixEnabled ? 'bg-emerald-500' : 'bg-zinc-600'
                  }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform ${autoFixEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
              </div>
            </label>
            {autoFixEnabled && (
              <p className="text-xs text-amber-400 mt-2 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                PRs will be created automatically after every push with issues
              </p>
            )}
          </div>

          {/* Bring Your Own Key (BYOK) */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-3">
              <KeyRound className="w-4 h-4 inline mr-2" />
              Bring Your Own Key
            </label>
            <p className="text-xs text-zinc-500 mb-3">
              Use your own Gemini API key for this project&rsquo;s analyses. It is
              encrypted at rest and never shown again. Leave empty to use the
              platform default.
            </p>

            {keyHint ? (
              <div className="flex items-center justify-between p-3 bg-zinc-800 rounded-lg">
                <div className="flex items-center gap-3">
                  <KeyRound className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-mono text-zinc-300">{keyHint}</span>
                </div>
                <button
                  onClick={handleRemoveKey}
                  disabled={keyBusy}
                  className="p-2 hover:bg-zinc-700 rounded transition-colors disabled:opacity-50"
                  aria-label="Remove key"
                >
                  <Trash2 className="w-4 h-4 text-red-400" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="AIza..."
                  className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  onClick={handleSaveKey}
                  disabled={!newKey.trim() || keyBusy}
                  className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors disabled:opacity-50 text-white text-sm"
                >
                  {keyBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                </button>
              </div>
            )}
            {keyMsg && <p className="text-xs text-zinc-400 mt-2">{keyMsg}</p>}
          </div>

          {/* Notifications */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-3">
              <Bell className="w-4 h-4 inline mr-2" />
              Notifications
            </label>

            <label className="flex items-center justify-between p-3 bg-zinc-800 rounded-lg cursor-pointer">
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-zinc-400" />
                <span className="text-sm text-zinc-300">Email on push events</span>
              </div>
              <div
                onClick={() => setEmailOnPush(!emailOnPush)}
                className={`w-10 h-6 rounded-full p-1 transition-colors cursor-pointer ${emailOnPush ? 'bg-red-500' : 'bg-zinc-600'
                  }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform ${emailOnPush ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
              </div>
            </label>
            <p className="text-xs text-zinc-500 mt-2 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              PR events will post comments to GitHub, not send emails
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-zinc-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
