import React from 'react';

interface Option {
  id: string;
  label: string;
}

interface Props {
  options: Option[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
}

const SegmentedControl: React.FC<Props> = ({ options, value, onChange, ariaLabel }) => {
  return (
    <div className="inline-flex bg-slate-900/80 backdrop-blur-sm rounded-full p-1 gap-1" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.id}
          onClick={() => onChange(option.id)}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
            value === option.id
              ? 'bg-gradient-to-r from-violet-600 to-cyan-500 text-white shadow-md shadow-cyan-500/20 scale-105'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};

export default SegmentedControl;
