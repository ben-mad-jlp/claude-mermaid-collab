/**
 * Utility functions for working with annotation markers.
 * Includes stripping markers, counting, and clean export.
 */

/**
 * Strip all annotation markers from markdown content.
 * Removes: comment blocks, comment-start/end, status markers,
 * propose-start/end, approve-start/end, reject-start/end.
 *
 * @param content - Markdown content with annotation markers
 * @returns Clean markdown without any `<!-- ... -->` annotation patterns
 */
export function stripAnnotationMarkers(content: string): string {
  // All annotation patterns to remove
  const patterns = [
    /<!-- comment: .+? -->\n?/g,
    /<!-- comment-start: .+? -->\n?/g,
    /<!-- comment-end -->\n?/g,
    /<!-- status: (proposed|approved) -->\n?/g,
    /<!-- status: rejected: .+? -->\n?/g,
    /<!-- (propose|approve)-start -->\n?/g,
    /<!-- (propose|approve)-end -->\n?/g,
    /<!-- reject-start: .+? -->\n?/g,
    /<!-- reject-end -->\n?/g,
  ];

  let result = content;
  for (const pattern of patterns) {
    result = result.replace(pattern, '');
  }

  // Collapse multiple blank lines
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}

/**
 * Count annotations by type in content
 * @param content - Markdown content with annotation markers
 * @returns Object with counts for each annotation type
 */
export function countAnnotations(content: string): {
  comment: number;
  propose: number;
  approve: number;
  reject: number;
} {
  const counts = { comment: 0, propose: 0, approve: 0, reject: 0 };

  // Count each type
  counts.comment = (content.match(/<!-- comment(-start)?: /g) || []).length;
  counts.propose = (content.match(/<!-- (status: proposed|propose-start) -->/g) || []).length;
  counts.approve = (content.match(/<!-- (status: approved|approve-start) -->/g) || []).length;
  counts.reject = (content.match(/<!-- (status: rejected|reject-start): /g) || []).length;

  return counts;
}

/**
 * Trigger file download with cleaned content
 * @param filename - Filename for download
 * @param content - Content to download
 */
export function downloadCleanMarkdown(filename: string, content: string): void {
  const cleanContent = stripAnnotationMarkers(content);
  const blob = new Blob([cleanContent], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replace(/\.md$/, '') + '-clean.md';
  link.click();

  URL.revokeObjectURL(url);
}
