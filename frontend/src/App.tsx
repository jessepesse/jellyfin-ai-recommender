import React from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Login from './components/Login';
import { useAuth } from './contexts/AuthContext';

const App: React.FC = () => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Login />;
  const [currentView, setCurrentView] = React.useState<'recommendations'|'watchlist'|'search'|'settings'>('recommendations');

  return (
    <div className="flex h-screen bg-gray-900 text-white overflow-hidden">
      <div className="flex-none p-6">
        <Sidebar active={currentView} onNavigate={(id) => setCurrentView(id as any)} />
      </div>
      <main className="flex-1 overflow-auto p-6">
        <Dashboard currentView={currentView} />
      </main>
    </div>
  );
};

export default App;
