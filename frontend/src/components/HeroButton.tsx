import React from 'react';

interface Props {
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
  className?: string;
  type?: 'button' | 'submit';
}

const HeroButton: React.FC<Props> = ({ 
  onClick, 
  disabled = false, 
  children, 
  variant = 'primary',
  className = '',
  type = 'button'
}) => {
  const baseStyles = 'px-8 py-3 rounded-full font-semibold text-sm transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed';
  
  const variantStyles = variant === 'primary'
    ? 'relative z-10 bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 text-white shadow-lg shadow-cyan-500/30 hover:shadow-cyan-500/50 hover:scale-105 active:scale-95'
    : 'bg-slate-800/80 backdrop-blur-sm text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700/50';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${baseStyles} ${variantStyles} ${className}`}
    >
      {children}
    </button>
  );
};

export default HeroButton;
