import React from 'react';

interface Props {
  children: React.ReactNode;
  className?: string;
}

const GlassCard: React.FC<Props> = ({ children, className = '' }) => {
  return (
    <div className={`bg-slate-800/30 backdrop-blur-md border border-white/5 rounded-2xl p-8 ${className}`}>
      {children}
    </div>
  );
};

export default GlassCard;
