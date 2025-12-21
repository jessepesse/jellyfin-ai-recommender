import React from 'react';

interface FilterChip {
  id: string;
  label: string;
  active: boolean;
}

interface Props {
  chips: FilterChip[];
  onToggle: (id: string) => void;
}

const FilterGroup: React.FC<Props> = ({ chips, onToggle }) => {
  return (
    <div className="relative">
      <div className="flex flex-wrap justify-center gap-2 py-4 px-4">
        {chips.map((chip) => (
          <button
            key={chip.id}
            onClick={() => onToggle(chip.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-300 ${chip.active
              ? 'bg-gradient-to-r from-violet-600 to-cyan-500 text-white shadow-lg shadow-cyan-500/30 scale-105'
              : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700 hover:text-white hover:scale-105'
              }`}
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default FilterGroup;
