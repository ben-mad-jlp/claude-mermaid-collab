import React from 'react';

export const TodosView: React.FC = () => {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center text-gray-400 dark:text-gray-500">
        <svg className="w-16 h-16 mx-auto mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
        <p className="text-lg font-medium">Project Todos</p>
        <p className="text-sm mt-1">Select a todo from the sidebar, or add one to get started.</p>
      </div>
    </div>
  );
};

export default TodosView;
