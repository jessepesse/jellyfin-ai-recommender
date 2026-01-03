import React, { useState } from 'react';
import { useSetupWizard } from '../hooks/useSetupWizard';
import type { ServiceTestResult } from '../hooks/useSetupWizard';

const SetupWizard: React.FC = () => {
  const {
    formData,
    updateField,
    testResults,
    isSaving,
    isRestoring,
    error,
    restoreSuccess,
    handleTest,
    handleSave,
    handleRestore,
  } = useSetupWizard();

  const [restoreFile, setRestoreFile] = useState<File | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setRestoreFile(file);
    }
  };

  const onRestore = () => {
    if (restoreFile) {
      handleRestore(restoreFile);
    }
  };

  const renderStatusIcon = (svc: ServiceTestResult) => {
    if (svc.status === 'testing') return <span className="ml-2 text-yellow-300">⏳</span>;
    if (svc.status === 'success') return <span className="ml-2 text-green-400">✅</span>;
    if (svc.status === 'error') return <span className="ml-2 text-red-400">❌</span>;
    return null;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b0b15] text-white p-4">
      <div className="w-full max-w-xl bg-slate-900/80 backdrop-blur-md rounded-2xl p-6 shadow-lg border border-white/5">
        <h2 className="text-2xl font-semibold mb-4">Welcome — Setup</h2>
        <p className="text-sm text-slate-300 mb-6">Enter your Jellyfin and external service configuration. Power users can still use .env; this wizard stores values in the local database.</p>

        {/* Restore from Backup Section */}
        <div className="mb-6 p-4 bg-slate-800/50 rounded-lg border border-slate-700">
          <h3 className="text-lg font-medium mb-3 flex items-center gap-2">
            <span>💾</span>
            <span>Restore from Backup</span>
          </h3>
          <p className="text-sm text-slate-400 mb-3">
            Restoring from a previous installation? Upload your backup.json file to automatically pre-fill configuration and restore watch history.
          </p>
          <div className="flex flex-col gap-3">
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleFileSelect}
              className="p-2 rounded bg-slate-800 border border-slate-700 text-sm focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-cyan-600 file:text-white hover:file:bg-cyan-700"
            />
            <button
              type="button"
              onClick={onRestore}
              disabled={!restoreFile || isRestoring}
              className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed px-4 py-2 rounded transition-colors text-sm font-medium"
            >
              {isRestoring ? 'Loading Backup...' : 'Load Backup File'}
            </button>
            {restoreSuccess && (
              <div className="text-sm text-green-400 flex items-center gap-2">
                <span>✅</span>
                <span>Backup loaded successfully! Configuration fields updated below.</span>
              </div>
            )}
          </div>
        </div>

        {error && <div className="mb-4 text-red-400">{error}</div>}
        <form onSubmit={handleSave}>
          <div className="grid grid-cols-1 gap-4">
            <label className="text-sm">Jellyfin URL</label>
            <div className="flex items-center">
              <input className="p-2 rounded bg-slate-800 border border-slate-700 flex-1 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition" value={formData.jellyfinUrl} onChange={e => updateField('jellyfinUrl', e.target.value)} placeholder="http://your-jellyfin:8096" />
              {renderStatusIcon(testResults.jellyfin)}
            </div>
            {testResults.jellyfin.status === 'error' && testResults.jellyfin.message && <div className="text-sm text-red-400">{testResults.jellyfin.message}</div>}

            <label className="text-sm">Jellyseerr URL</label>
            <div className="flex items-center">
              <input className="p-2 rounded bg-slate-800 border border-slate-700 flex-1 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition" value={formData.jellyseerrUrl} onChange={e => updateField('jellyseerrUrl', e.target.value)} placeholder="http://your-jellyseerr:5055" />
              {renderStatusIcon(testResults.jellyseerr)}
            </div>
            {testResults.jellyseerr.status === 'error' && testResults.jellyseerr.message && <div className="text-sm text-red-400">{testResults.jellyseerr.message}</div>}

            <label className="text-sm">Jellyseerr API Key</label>
            <div className="flex items-center">
              <input className="p-2 rounded bg-slate-800 border border-slate-700 flex-1 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition" value={formData.jellyseerrApiKey} onChange={e => updateField('jellyseerrApiKey', e.target.value)} placeholder="API Key" />
              {renderStatusIcon(testResults.jellyseerr)}
            </div>

            {/* AI Provider Section */}
            <div className="mt-4 pt-4 border-t border-slate-700">
              <label className="text-sm font-medium mb-2 block">AI Provider</label>
              <div className="flex gap-4 mb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="aiProvider"
                    value="google"
                    checked={formData.aiProvider === 'google'}
                    onChange={() => updateField('aiProvider', 'google')}
                    className="w-4 h-4 text-cyan-500 bg-slate-800 border-slate-700 focus:ring-cyan-500"
                  />
                  <span className="text-slate-200">Google AI (Direct)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="aiProvider"
                    value="openrouter"
                    checked={formData.aiProvider === 'openrouter'}
                    onChange={() => updateField('aiProvider', 'openrouter')}
                    className="w-4 h-4 text-cyan-500 bg-slate-800 border-slate-700 focus:ring-cyan-500"
                  />
                  <span className="text-slate-200">OpenRouter</span>
                </label>
              </div>
            </div>

            {/* Google AI API Key */}
            <div className={formData.aiProvider !== 'google' ? 'opacity-50' : ''}>
              <label className="text-sm">Google AI (Gemini) API Key</label>
              <div className="flex items-center">
                <input
                  className="p-2 rounded bg-slate-800 border border-slate-700 flex-1 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition"
                  value={formData.geminiApiKey}
                  onChange={e => updateField('geminiApiKey', e.target.value)}
                  placeholder="Gemini API Key"
                  disabled={formData.aiProvider !== 'google'}
                />
                {formData.aiProvider === 'google' && renderStatusIcon(testResults.gemini)}
              </div>
              {formData.aiProvider === 'google' && testResults.gemini.status === 'error' && testResults.gemini.message && <div className="text-sm text-red-400">{testResults.gemini.message}</div>}
              <p className="text-xs text-slate-400 mt-1">Get from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">Google AI Studio</a></p>
            </div>

            {/* OpenRouter API Key */}
            <div className={formData.aiProvider !== 'openrouter' ? 'opacity-50' : ''}>
              <label className="text-sm">OpenRouter API Key</label>
              <div className="flex items-center">
                <input
                  className="p-2 rounded bg-slate-800 border border-slate-700 flex-1 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition"
                  value={formData.openrouterApiKey}
                  onChange={e => updateField('openrouterApiKey', e.target.value)}
                  placeholder="OpenRouter API Key"
                  disabled={formData.aiProvider !== 'openrouter'}
                />
                {formData.aiProvider === 'openrouter' && renderStatusIcon(testResults.openrouter)}
              </div>
              {formData.aiProvider === 'openrouter' && testResults.openrouter.status === 'error' && testResults.openrouter.message && <div className="text-sm text-red-400">{testResults.openrouter.message}</div>}
              <p className="text-xs text-slate-400 mt-1">Get from <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">OpenRouter</a></p>
            </div>

            {/* AI Model Selection */}
            <label className="text-sm">AI Model</label>
            <select className="p-2 rounded bg-slate-800 border border-slate-700 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition" value={formData.aiModel} onChange={e => updateField('aiModel', e.target.value)}>
              <option value="gemini-3-flash-preview">Gemini 3 Flash (Recommended)</option>
              <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</option>
              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
              <option value="gemini-3-pro-preview">Gemini 3 Pro</option>
            </select>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={handleTest} className="bg-slate-800 px-4 py-2 rounded hover:bg-slate-700 transition-colors">
              Test Connections
            </button>
            <button type="submit" disabled={isSaving} className="bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 shadow-lg shadow-cyan-500/20 px-4 py-2 rounded transition-all duration-300 disabled:opacity-50">
              {isSaving ? 'Saving...' : 'Save & Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SetupWizard;
