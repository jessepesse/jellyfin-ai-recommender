import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Footer from './Footer';
import axios from 'axios';

const Login: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverUrl, setServerUrl] = useState('');

  // Pre-fill server URL from localStorage or backend config
  useEffect(() => {
    const fetchServerUrl = async () => {
      // First try localStorage
      const storedUrl = localStorage.getItem('jellyfin_server');
      if (storedUrl) {
        setServerUrl(storedUrl);
        return;
      }

      // If not in localStorage, fetch from backend config
      try {
        const baseUrl = import.meta.env.VITE_BACKEND_URL
          ? import.meta.env.VITE_BACKEND_URL + '/api'
          : '/api';
        const response = await axios.get(`${baseUrl}/system/setup-defaults`);
        if (response.data.jellyfinUrl) {
          setServerUrl(response.data.jellyfinUrl);
        }
      } catch (err) {
        console.debug('Could not fetch server URL from backend:', err);
      }
    };

    fetchServerUrl();
  }, []);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const success = await login(username, password, serverUrl);
      if (!success) {
        setError('Login failed. Please check your credentials.');
      }
    } catch {
      setError('Login failed. Please check your credentials.');
    }
    setIsSubmitting(false);
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#0b0b15] text-white">
      <div className="flex-1 flex items-center justify-center">
        <div className="p-8 bg-slate-900/80 backdrop-blur-md rounded-2xl shadow-2xl w-full max-w-sm border border-white/5">
          <div className="mb-4">
            <img src="/assets/logo.png" alt="Jellyfin AI" className="w-24 h-24 mx-auto mb-4 object-contain drop-shadow-md transition-transform duration-300 hover:scale-105" />
            <h2 className="text-3xl font-bold mb-2 text-center text-gray-100">
              Sign In
            </h2>
          </div>
          <form onSubmit={handleLogin}>
            {error && <p className="mb-4 text-center text-red-400 text-sm">{error}</p>}
            <div className="mb-5">
              <label htmlFor="username" className="block mb-2 text-sm font-medium text-slate-300">
                Username
              </label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full p-3 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition"
                placeholder="Your username"
                required
              />
            </div>
            <div className="mb-6">
              <label htmlFor="password" className="block mb-2 text-sm font-medium text-slate-300">
                Password
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-3 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition"
                placeholder="••••••••"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`w-full ${isSubmitting ? 'bg-violet-500/60 cursor-not-allowed' : 'bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 shadow-lg shadow-cyan-500/20'} focus:ring-4 focus:outline-none focus:ring-cyan-500/50 font-medium rounded-lg text-sm px-5 py-3 text-center transition-all duration-300`}
            >
              {isSubmitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default Login;