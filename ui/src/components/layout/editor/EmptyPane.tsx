export function EmptyPane({ isDragOver = false }: { isDragOver?: boolean } = {}) {
  return (
    <div
      data-testid="editor-empty-pane"
      data-drag-over={isDragOver || undefined}
      className={`h-full w-full flex flex-col items-center justify-center rounded transition-colors ${
        isDragOver
          ? "border border-dashed border-accent-400 bg-accent-50 dark:border-accent-500 dark:bg-accent-900/20"
          : ""
      }`}
    >
    </div>
  );
}

export default EmptyPane;
