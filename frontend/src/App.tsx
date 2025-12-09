import React, { useEffect, useState } from 'react';
import Dashboard from './components/Dashboard';
import Login from './components/Login';
import { useAuth } from './contexts/AuthContext';
import SetupWizard from './components/SetupWizard';
import { getSystemStatus } from './services/api';
import ErrorBoundary from './components/ErrorBoundary';
import Sidebar from './components/Sidebar';
import { Menu } from 'lucide-react';
import type { AppView } from './types';

const FullPageSpinner = () => (
  <div className="min-h-screen flex items-center justify-center bg-[#0b0b15] text-white">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400" />
  </div>
);

const App: React.FC = () => {
  const { user } = useAuth();
  const [currentView, setCurrentView] = useState<AppView>('recommendations');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [configLoading, setConfigLoading] = useState<boolean>(true);
  // Stable hooks for UI state — must be declared unconditionally
  // const [currentView, setCurrentView] = React.useState<AppView>('recommendations'); // This line was removed as it's now declared above
  // const [isSidebarOpen, setIsSidebarOpen] = React.useState(false); // This line was removed as it's now declared above

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      setConfigLoading(true);
      try {
        const res = await getSystemStatus();
        if (!mounted) return;
        setIsConfigured(Boolean(res.configured));
      } catch (e) {
        if (!mounted) return;
        console.error('Failed to check system status', e);
        setIsConfigured(false);
      } finally {
        if (mounted) setConfigLoading(false);
      }
    };
    check();
    return () => { mounted = false; };
  }, []);

  // Debug: render state intentionally omitted from production logs

  // 1. Loading State
  if (configLoading || isConfigured === null) {
    return <FullPageSpinner />;
  }

  // 2. Setup State
  if (isConfigured === false) {
    return <SetupWizard />;
  }

  // 3. Auth State
  if (!user) {
    return <Login />;
  }

  // 4. App State (Logged In)

  return (
    <div className="flex h-screen bg-[#0b0b15] text-white overflow-visible">
      {/* Top bar with menu button - visible at all sizes */}
      <div className="w-full fixed top-0 left-0 right-0 z-50 bg-[#0b0b15] border-b border-white/5 lg:hidden">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="text-lg font-semibold">Jellyfin AI Recommender</div>
          <button
            className="p-2 rounded-md text-slate-400 hover:text-white bg-slate-800/30 hover:bg-slate-800/50 transition cursor-pointer"
            onClick={() => { console.log('Sidebar toggle clicked'); setIsSidebarOpen(true); }}
            aria-label="Open menu"
            title="Open menu"
          >
            <Menu size={20} className="text-current" />
          </button>
        </div>
      </div>

      {/* Sidebar - large desktop */}
      <div className="hidden lg:block lg:flex-none lg:p-6 z-20">
        <Sidebar active={currentView} onNavigate={(id: AppView) => setCurrentView(id)} />
      </div>

      {/* Mobile Sidebar Drawer */}
      {isSidebarOpen && (
        <div className="fixed inset-0 z-[60] bg-black/50 lg:hidden" onClick={() => setIsSidebarOpen(false)} />
      )}
      <div className={`fixed inset-y-0 left-0 z-[70] transform lg:hidden ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} transition-all duration-300 ease-in-out`}>
        <div className="w-80">
          <Sidebar
            active={currentView}
            onNavigate={(id: AppView) => { setCurrentView(id); setIsSidebarOpen(false); }}
            onClose={() => setIsSidebarOpen(false)}
          />
        </div>
      </div>

      <main className={`flex-1 overflow-auto ${isSidebarOpen ? 'pointer-events-none' : ''} lg:pl-0`}>
        <div className="h-12 lg:hidden" />
        <div className="p-0 lg:p-6">
          <ErrorBoundary>
            <Dashboard currentView={currentView} />
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
};

export default App;
