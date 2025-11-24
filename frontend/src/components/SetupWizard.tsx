import React, { useState, useEffect } from 'react';
import { postSystemSetup, postSystemVerify, getSystemSetupDefaults } from '../services/api';

type ServiceStatus = 'idle' | 'testing' | 'success' | 'error';

const defaultTests = {
  jellyfin: { status: 'idle' as ServiceStatus, message: '' },
  jellyseerr: { status: 'idle' as ServiceStatus, message: '' },
  gemini: { status: 'idle' as ServiceStatus, message: '' },
};

const SetupWizard: React.FC = () => {
  const [jellyfinUrl, setJellyfinUrl] = useState('');
  const [jellyseerrUrl, setJellyseerrUrl] = useState('');
  const [jellyseerrApiKey, setJellyseerrApiKey] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash-lite');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [testResults, setTestResults] = useState<any>(defaultTests);

  // On mount, fetch defaults (env > DB) and pre-fill wizard inputs.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const defaults = await getSystemSetupDefaults();
        if (!mounted) return;
        if (defaults.jellyfinUrl) setJellyfinUrl(defaults.jellyfinUrl);
        if (defaults.jellyseerrUrl) setJellyseerrUrl(defaults.jellyseerrUrl);
        if (defaults.jellyseerrApiKey) setJellyseerrApiKey(defaults.jellyseerrApiKey);
        if (defaults.geminiApiKey) setGeminiApiKey(defaults.geminiApiKey);
        if (defaults.geminiModel) setGeminiModel(defaults.geminiModel);
      } catch (e) {
        // Silent failure is acceptable — wizard remains empty for manual entry
        console.warn('Failed to load setup defaults', e);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const handleTest = async () => {
    setError(null);
    setTestResults({
      jellyfin: { status: 'testing', message: '' },
      jellyseerr: { status: 'testing', message: '' },
      gemini: { status: 'testing', message: '' },
    });

    try {
      const data = await postSystemVerify({ jellyfinUrl, jellyseerrUrl, jellyseerrApiKey, geminiApiKey });
      setTestResults({
        jellyfin: { status: data.jellyfin?.ok ? 'success' : 'error', message: data.jellyfin?.message || '' },
        jellyseerr: { status: data.jellyseerr?.ok ? 'success' : 'error', message: data.jellyseerr?.message || '' },
        gemini: { status: data.gemini?.ok ? 'success' : 'error', message: data.gemini?.message || '' },
      });
    } catch (e: any) {
      setError(e?.message || 'Test failed');
      setTestResults({ jellyfin: { status: 'error', message: '' }, jellyseerr: { status: 'error', message: '' }, gemini: { status: 'error', message: '' } });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const allPassed = testResults && testResults.jellyfin?.status === 'success' && testResults.jellyseerr?.status === 'success' && testResults.gemini?.status === 'success';
    if (!allPassed) {
      const ok = window.confirm('Not all connection tests passed. Are you sure you want to save anyway?');
      if (!ok) return;
    }

    setIsSaving(true);
    try {
      await postSystemSetup({ jellyfinUrl, jellyseerrUrl, jellyseerrApiKey, geminiApiKey, geminiModel });
      window.location.reload();
    } catch (err: any) {
      setError(err?.message || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const renderStatusIcon = (svc: any) => {
    if (!svc) return null;
    if (svc.status === 'testing') return <span className="ml-2 text-yellow-300">⏳</span>;
    if (svc.status === 'success') return <span className="ml-2 text-green-400">✅</span>;
    if (svc.status === 'error') return <span className="ml-2 text-red-400">❌</span>;
    return null;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b0b15] text-white">
      <div className="w-full max-w-xl bg-slate-900/80 backdrop-blur-md rounded-2xl p-6 shadow-lg border border-white/5">
        <h2 className="text-2xl font-semibold mb-4">Welcome — Setup</h2>
        <p className="text-sm text-slate-300 mb-6">Enter your Jellyfin and external service configuration. Power users can still use .env; this wizard stores values in the local database.</p>
        {error && <div className="mb-4 text-red-400">{error}</div>}
        <form onSubmit={handleSave}>
          <div className="grid grid-cols-1 gap-4">
            <label className="text-sm">Jellyfin URL</label>
            <div className="flex items-center">
              <input className="p-2 rounded bg-slate-800 border border-slate-700 flex-1 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition" value={jellyfinUrl} onChange={e => setJellyfinUrl(e.target.value)} placeholder="http://your-jellyfin:8096" />
              {renderStatusIcon(testResults.jellyfin)}
            </div>
            {testResults.jellyfin?.status === 'error' && testResults.jellyfin?.message && <div className="text-sm text-red-400">{testResults.jellyfin.message}</div>}

            <label className="text-sm">Jellyseerr URL</label>
            <div className="flex items-center">
              <input className="p-2 rounded bg-slate-800 border border-slate-700 flex-1 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition" value={jellyseerrUrl} onChange={e => setJellyseerrUrl(e.target.value)} placeholder="http://your-jellyseerr:5055" />
              {renderStatusIcon(testResults.jellyseerr)}
            </div>
            {testResults.jellyseerr?.status === 'error' && testResults.jellyseerr?.message && <div className="text-sm text-red-400">{testResults.jellyseerr.message}</div>}

            <label className="text-sm">Jellyseerr API Key</label>
            <div className="flex items-center">
              <input className="p-2 rounded bg-slate-800 border border-slate-700 flex-1 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition" value={jellyseerrApiKey} onChange={e => setJellyseerrApiKey(e.target.value)} placeholder="API Key" />
              {renderStatusIcon(testResults.jellyseerr)}
            </div>

            <label className="text-sm">Gemini API Key</label>
            <div className="flex items-center">
              <input className="p-2 rounded bg-slate-800 border border-slate-700 flex-1 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition" value={geminiApiKey} onChange={e => setGeminiApiKey(e.target.value)} placeholder="Gemini API Key" />
              {renderStatusIcon(testResults.gemini)}
            </div>
            {testResults.gemini?.status === 'error' && testResults.gemini?.message && <div className="text-sm text-red-400">{testResults.gemini.message}</div>}

            <label className="text-sm">Gemini Model</label>
            <select className="p-2 rounded bg-slate-800 border border-slate-700 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition" value={geminiModel} onChange={e => setGeminiModel(e.target.value)}>
              <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite (Recommended)</option>
              <option value="gemini-2.5-flash">gemini-2.5-flash</option>
              <option value="gemini-2.5-pro">gemini-2.5-pro</option>
              <option value="gemini-3-pro-preview">gemini-3-pro-preview</option>
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
