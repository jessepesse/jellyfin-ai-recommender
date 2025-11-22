import React from 'react';

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
}

const Sidebar: React.FC<SidebarProps> = ({ active, onNavigate }) => {
  return (
    <aside className="w-64 bg-gray-900 h-screen flex flex-col border-r border-gray-800 p-4">
      <nav>
        <h3 className="text-lg font-semibold text-white mb-4">Menu</h3>
        <ul className="space-y-2">
          {navItems.map(item => (
            <li key={item.id}>
              <button
                onClick={() => onNavigate(item.id)}
                className={`w-full text-left px-3 py-2 rounded-md flex items-center justify-start ${active === item.id ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-auto border-t border-gray-800 pt-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center text-gray-300">U</div>
          <div>
            <div className="text-sm font-semibold text-white">Local User</div>
            <div className="text-xs text-gray-400">Signed in</div>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
