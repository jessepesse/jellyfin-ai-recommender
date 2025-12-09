import React, { useState } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import UserStatsModal from './UserStatsModal';

type NavItem = {
  id: string;
  label: string;
};

const navItems: NavItem[] = [
  { id: 'recommendations', label: 'Recommendations' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'mark-watched', label: 'Mark as Watched' },
  { id: 'settings', label: 'Settings' },
];

interface SidebarProps {
  active: string;
  onNavigate: (id: string) => void;
  onClose?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ active, onNavigate, onClose }) => {
  const { user, logout } = useAuth();
  const [showStats, setShowStats] = useState(false);
  const displayName = (user && ((user as any).Name || (user as any).name)) || 'Local User';
  const avatarLetter = String(displayName || 'U').charAt(0).toUpperCase();

  return (
    <>
      <aside className="w-80 bg-[#080810] min-h-screen flex flex-col border-r border-white/5 p-6 overflow-visible">
        <div className="flex-1 overflow-auto pl-6 pr-2 pb-24">
          <nav>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <img src="/images/logo.png" alt="Jellyfin AI" className="w-10 h-10 object-contain drop-shadow-[0_0_10px_rgba(34,211,238,0.3)]" />
                <div className="text-lg font-semibold text-white">Jellyfin AI</div>
              </div>
              {/* Mobile/Tablet close button (hidden on large desktops) */}
              <button className="lg:hidden p-1 text-slate-300 hover:text-white" onClick={() => onClose && onClose()} aria-label="Close menu">
                ✕
              </button>
            </div>
            <ul className="space-y-2">
              {navItems.map(item => (
                <li key={item.id}>
                  <button
                    onClick={() => onNavigate(item.id)}
                    className={`w-full text-left px-6 py-2.5 rounded-xl flex items-center justify-start transition-all duration-300 ${active === item.id ? 'relative z-20 bg-gradient-to-r from-violet-600 to-cyan-500 text-white shadow-lg shadow-cyan-500/30 scale-105' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="sticky bottom-4 border-t border-white/5 pt-4 bg-[#080810]">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowStats(true)}
              className="flex items-center space-x-3 overflow-visible hover:bg-white/5 p-2 rounded-lg transition-colors text-left group w-full mr-2"
              title="View Statistics"
            >
              <div className="w-10 h-10 bg-gradient-to-br from-violet-600 to-cyan-500 rounded-full flex items-center justify-center text-white font-bold shrink-0 shadow-lg shadow-cyan-500/30 group-hover:scale-110 transition-transform">
                {avatarLetter}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white truncate">
                  {displayName}
                </div>
                <div className="text-xs text-slate-500 group-hover:text-cyan-400 transition-colors">View Stats</div>
              </div>
            </button>

            <button
              onClick={() => { try { logout(); } catch (e) { console.error('Logout failed', e); } }}
              className="p-2 text-slate-500 hover:text-white hover:bg-slate-800/50 rounded-full transition-all duration-300"
              title="Log Out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      <UserStatsModal isOpen={showStats} onClose={() => setShowStats(false)} />
    </>
  );
};

export default Sidebar;
