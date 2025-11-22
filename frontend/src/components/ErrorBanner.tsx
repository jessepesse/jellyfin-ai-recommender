import React from 'react';

interface Props {
  message: string;
  onRetry?: () => void;
}

const ErrorBanner: React.FC<Props> = ({ message, onRetry }) => {
  return (
    <div className="bg-red-600 text-white p-3 rounded flex items-center justify-between">
      <div className="flex-1">{message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="ml-4 bg-white text-red-600 px-3 py-1 rounded font-semibold hover:bg-gray-100"
        >
          Retry
        </button>
      )}
    </div>
  );
};

export default ErrorBanner;
