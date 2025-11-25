import React from 'react';

const Footer: React.FC = () => {
  return (
    <footer className="w-full border-t border-white/5 text-center text-slate-500 text-xs sm:text-sm px-4 py-3 mt-6">
      <div className="inline-flex items-center gap-2">
        <span>🔖 v2.0.3</span>
        <span className="opacity-60">•</span>
        <a
          className="hover:text-cyan-400 transition-colors"
          href="https://github.com/jessepesse/jellyfin-ai-recommender"
          target="_blank"
          rel="noreferrer"
        >
          💻 Jellyfin AI Recommender
        </a>
        <span className="opacity-60">•</span>
        <span>🚀 Open Source</span>
      </div>
    </footer>
  );
};

export default Footer;
