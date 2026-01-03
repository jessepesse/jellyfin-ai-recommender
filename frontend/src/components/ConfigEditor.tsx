import React, { useState, useEffect } from 'react';
import { getSystemConfigEditor, putSystemConfigEditor, postSystemVerify } from '../services/api';
import GlassCard from './GlassCard';
import { Loader2, Check, AlertCircle, Settings } from 'lucide-react';

const ConfigEditor: React.FC = () => {
  const [config, setConfig] = useState({
    jellyfinUrl: '',
    jellyseerrUrl: '',
    jellyseerrApiKey: '',
    tmdbApiKey: '',
    geminiApiKey: '',
    aiProvider: 'google' as 'google' | 'openrouter',
    openrouterApiKey: '',
    aiModel: 'gemini-3-flash-preview',
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  interface VerifyResult {
    valid: boolean;
    message?: string;
  }

  const [verifyResults, setVerifyResults] = useState<Record<string, VerifyResult> | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const response = await getSystemConfigEditor();
      if (response.ok && response.config) {
        setConfig({
          jellyfinUrl: response.config.jellyfinUrl || '',
          jellyseerrUrl: response.config.jellyseerrUrl || '',
          jellyseerrApiKey: response.config.jellyseerrApiKey || '',
          tmdbApiKey: response.config.tmdbApiKey || '',
          geminiApiKey: response.config.geminiApiKey || '',
          aiProvider: (response.config.aiProvider as 'google' | 'openrouter') || 'google',
          openrouterApiKey: response.config.openrouterApiKey || '',
          aiModel: response.config.aiModel || 'gemini-3-flash-preview',
        });
      }
    } catch (error) {
      console.error('Failed to load config', error);
      setMessage({ type: 'error', text: 'Failed to load configuration' });
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnections = async () => {
    try {
      setTesting(true);
      setMessage(null);
      setVerifyResults(null);

      const response = await postSystemVerify({
        jellyfinUrl: config.jellyfinUrl || undefined,
        jellyseerrUrl: config.jellyseerrUrl || undefined,
        jellyseerrApiKey: config.jellyseerrApiKey.startsWith('*') ? undefined : config.jellyseerrApiKey || undefined,
        tmdbApiKey: config.tmdbApiKey.startsWith('*') ? undefined : config.tmdbApiKey || undefined,
        geminiApiKey: config.geminiApiKey.startsWith('*') ? undefined : config.geminiApiKey || undefined,
        openrouterApiKey: config.openrouterApiKey.startsWith('*') ? undefined : config.openrouterApiKey || undefined,
      });

      setVerifyResults(response.results || {});

      const allValid = Object.values(response.results || {}).every((r: unknown) => (r as VerifyResult).valid);
      setMessage({
        type: allValid ? 'success' : 'error',
        text: allValid ? 'All connections verified successfully!' : 'Some connections failed. Check details below.',
      });
    } catch (error) {
      const err = error as { response?: { data?: { error?: string } } };
      console.error('Connection test failed', error);
      setMessage({ type: 'error', text: err.response?.data?.error || 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setMessage(null);

      const payload = {
        jellyfinUrl: config.jellyfinUrl || undefined,
        jellyseerrUrl: config.jellyseerrUrl || undefined,
        jellyseerrApiKey: config.jellyseerrApiKey || undefined,
        tmdbApiKey: config.tmdbApiKey || undefined,
        geminiApiKey: config.geminiApiKey || undefined,
        aiProvider: config.aiProvider || undefined,
        openrouterApiKey: config.openrouterApiKey || undefined,
        aiModel: config.aiModel || undefined,
      };

      const response = await putSystemConfigEditor(payload);

      // Check if Jellyseerr URL changed - user needs to re-download images
      if (response.jellyseerrUrlChanged) {
        setMessage({
          type: 'info',
          text: 'Configuration saved! Jellyseerr URL changed - images will be re-downloaded automatically on next media sync, or run: docker-compose exec backend npm run db:migrate-images'
        });
      } else {
        setMessage({ type: 'success', text: 'Configuration saved successfully!' });
      }

      // Reload to show masked keys
      setTimeout(() => loadConfig(), 1500);
    } catch (error) {
      const err = error as { response?: { data?: { error?: string } } };
      console.error('Failed to save config', error);
      setMessage({ type: 'error', text: err.response?.data?.error || 'Failed to save configuration' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <GlassCard className="p-6">
        <div className="flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
          <span className="ml-2 text-slate-300">Loading configuration...</span>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Settings className="w-6 h-6 text-violet-400" />
        <h3 className="text-2xl font-bold text-white">System Configuration</h3>
      </div>

      <p className="text-slate-400 mb-6">
        Update service URLs and API keys. Masked values (****) indicate existing secrets that will be preserved unless replaced.
      </p>

      {message && (
        <div className={`mb-4 p-4 rounded-lg flex items-start gap-3 ${message.type === 'success' ? 'bg-green-500/10 border border-green-500/20' :
          message.type === 'error' ? 'bg-red-500/10 border border-red-500/20' :
            'bg-blue-500/10 border border-blue-500/20'
          }`}>
          {message.type === 'success' && <Check className="w-5 h-5 text-green-400 mt-0.5" />}
          {message.type === 'error' && <AlertCircle className="w-5 h-5 text-red-400 mt-0.5" />}
          <span className={`${message.type === 'success' ? 'text-green-300' :
            message.type === 'error' ? 'text-red-300' :
              'text-blue-300'
            }`}>{message.text}</span>
        </div>
      )}

      <div className="space-y-4">
        {/* Jellyfin URL */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Jellyfin Server URL
          </label>
          <input
            type="text"
            value={config.jellyfinUrl}
            onChange={(e) => setConfig({ ...config, jellyfinUrl: e.target.value })}
            placeholder="http://your-server:8096"
            className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>

        {/* Jellyseerr URL */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Jellyseerr URL
          </label>
          <input
            type="text"
            value={config.jellyseerrUrl}
            onChange={(e) => setConfig({ ...config, jellyseerrUrl: e.target.value })}
            placeholder="http://your-server:5055"
            className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>


        {/* Jellyseerr API Key */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Jellyseerr API Key
          </label>
          <input
            type="text"
            value={config.jellyseerrApiKey}
            onChange={(e) => setConfig({ ...config, jellyseerrApiKey: e.target.value })}
            placeholder="Enter new key or leave masked to keep existing"
            className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
          />
          <p className="text-xs text-slate-500 mt-1">
            Masked values (****) will preserve the existing key. Enter a new key to update.
          </p>
        </div>

        {/* TMDB API Key (Optional - Direct Access) */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <label className="block text-sm font-medium text-slate-300">
              TMDB API Key
            </label>
            <span className="text-xs bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded-full border border-violet-500/30">
              Recommended for Discovery
            </span>
          </div>
          <input
            type="text"
            value={config.tmdbApiKey || ''}
            onChange={(e) => setConfig({ ...config, tmdbApiKey: e.target.value })}
            placeholder="Enter TMDB API Read Access Token or Key"
            className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
          />
          <p className="text-xs text-slate-500 mt-1">
            If provided, discovery queries will go directly to TMDB instead of proxying through Jellyseerr.
          </p>
        </div>

        {/* AI Provider Section */}
        <div className="pt-4 border-t border-slate-700">
          <label className="block text-sm font-medium text-slate-300 mb-3">
            AI Provider
          </label>
          <div className="flex gap-4 mb-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="aiProvider"
                value="google"
                checked={config.aiProvider === 'google'}
                onChange={() => setConfig({ ...config, aiProvider: 'google' })}
                className="w-4 h-4 text-violet-500 bg-slate-800 border-slate-700 focus:ring-violet-500"
              />
              <span className="text-slate-200">Google AI (Direct)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="aiProvider"
                value="openrouter"
                checked={config.aiProvider === 'openrouter'}
                onChange={() => setConfig({ ...config, aiProvider: 'openrouter' })}
                className="w-4 h-4 text-violet-500 bg-slate-800 border-slate-700 focus:ring-violet-500"
              />
              <span className="text-slate-200">OpenRouter</span>
            </label>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Active provider: <span className="text-violet-400 font-medium">{config.aiProvider === 'google' ? 'Google AI (Direct)' : 'OpenRouter'}</span>
          </p>

          {/* API Keys Grid - Both visible for easy switching */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Google AI API Key */}
            <div className={config.aiProvider !== 'google' ? 'opacity-50' : ''}>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Google AI API Key {config.aiProvider === 'google' && <span className="text-green-400 text-xs">(active)</span>}
              </label>
              <input
                type="text"
                value={config.geminiApiKey}
                onChange={(e) => setConfig({ ...config, geminiApiKey: e.target.value })}
                placeholder="Enter Google AI API key"
                disabled={config.aiProvider !== 'google'}
                className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <p className="text-xs text-slate-500 mt-1">
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline">Get API key</a>
              </p>
            </div>

            {/* OpenRouter API Key */}
            <div className={config.aiProvider !== 'openrouter' ? 'opacity-50' : ''}>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                OpenRouter API Key {config.aiProvider === 'openrouter' && <span className="text-green-400 text-xs">(active)</span>}
              </label>
              <input
                type="text"
                value={config.openrouterApiKey}
                onChange={(e) => setConfig({ ...config, openrouterApiKey: e.target.value })}
                placeholder="Enter OpenRouter API key"
                disabled={config.aiProvider !== 'openrouter'}
                className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <p className="text-xs text-slate-500 mt-1">
                <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline">Get API key</a>
              </p>
            </div>
          </div>
        </div>

        {/* AI Model */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            AI Model
          </label>
          <select
            value={config.aiModel}
            onChange={(e) => setConfig({ ...config, aiModel: e.target.value })}
            className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="gemini-3-flash-preview">Gemini 3 Flash (Recommended)</option>
            <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</option>
            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
            <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
            <option value="gemini-3-pro-preview">Gemini 3 Pro</option>
          </select>
        </div>
      </div>

      {/* Verification Results */}
      {verifyResults && (
        <div className="mt-6 space-y-2">
          <h4 className="text-sm font-semibold text-slate-300 mb-3">Connection Test Results:</h4>
          {Object.entries(verifyResults).map(([service, result]: [string, VerifyResult]) => (
            <div key={service} className={`flex items-center gap-3 p-3 rounded-lg ${result.valid ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'
              }`}>
              {result.valid ? (
                <Check className="w-5 h-5 text-green-400" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-400" />
              )}
              <div className="flex-1">
                <p className={`font-medium ${result.valid ? 'text-green-300' : 'text-red-300'}`}>
                  {service.charAt(0).toUpperCase() + service.slice(1)}
                </p>
                <p className="text-xs text-slate-400">{result.message || (result.valid ? 'Connected' : 'Failed')}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 mt-6">
        <button
          onClick={handleTestConnections}
          disabled={testing || saving}
          className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-600 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {testing ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Testing...
            </>
          ) : (
            'Test Connections'
          )}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || testing}
          className="flex-1 px-4 py-3 bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-600 hover:to-cyan-600 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg transition-all flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Changes'
          )}
        </button>
      </div>
    </GlassCard>
  );
};

export default ConfigEditor;
