import React from 'react';

const SkeletonCard: React.FC = () => {
  return (
    <div className="rounded-lg overflow-hidden">
      <div className="relative w-full" style={{ paddingTop: '150%' }}>
        <div className="absolute inset-0 bg-gray-700 animate-pulse" />
      </div>
      <div className="p-3">
        <div className="h-4 bg-gray-700 rounded w-3/4 animate-pulse mb-2" />
        <div className="h-3 bg-gray-700 rounded w-1/4 animate-pulse" />
      </div>
    </div>
  );
};

export default SkeletonCard;
