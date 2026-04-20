export function EmptyPane({ isDragOver = false }: { isDragOver?: boolean } = {}) {
  return (
    <div
      data-testid="editor-empty-pane"
      data-drag-over={isDragOver || undefined}
      className={`h-full w-full flex flex-col items-center justify-center rounded border border-dashed transition-colors ${
        isDragOver
          ? "border-accent-400 bg-accent-50 dark:border-accent-500 dark:bg-accent-900/20"
          : "border-gray-300 dark:border-gray-600"
      }`}
    >
      <p className="text-sm text-gray-500 dark:text-gray-400 select-none">No tab open {'\u2014'} drag a tab here or open from the sidebar</p>
    </div>
  );
}

export default EmptyPane;
