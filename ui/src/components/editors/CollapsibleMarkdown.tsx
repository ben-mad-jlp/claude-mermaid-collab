/**
 * CollapsibleMarkdown Component
 *
 * Renders markdown with collapsible heading-based sections.
 * Each heading (h1-h6) becomes a collapsible section containing
 * all content until the next heading of the same or higher level.
 */

import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
  oneDark,
  vs,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from '@/hooks/useTheme';
import { remarkDiagramEmbeds } from '@/lib/remarkDiagramEmbeds';
import {
  ManagedCollapsibleSection,
  CollapsibleSectionsProvider,
  CollapsibleSectionsControls,
} from './CollapsibleSection';

interface Section {
  id: string;
  level: number;
  title: string;
  content: string;
  children: Section[];
  /** 1-based line number in the original document where this section's content starts */
  contentStartLine: number;
}

/**
 * Parse markdown into a tree of sections based on headings
 */
function parseMarkdownSections(markdown: string): { preamble: string; preambleStartLine: number; sections: Section[] } {
  const lines = markdown.split('\n');
  const sections: Section[] = [];
  let preamble = '';
  let preambleStartLine = 1;
  let currentContent: string[] = [];
  /** 1-based line number where currentContent[0] sits in the original document */
  let currentContentStartLine = 1;
  let sectionStack: { section: Section; level: number }[] = [];
  let sectionCounter = 0;
  let inCodeBlock = false;

  const flushContent = () => {
    if (currentContent.length > 0) {
      const raw = currentContent.join('\n');
      // Count leading blank lines that .trim() will strip
      let leadingBlanks = 0;
      for (const ch of currentContent) {
        if (ch.trim() === '') leadingBlanks++;
        else break;
      }
      const content = raw.trim();
      const adjustedStartLine = currentContentStartLine + leadingBlanks;

      if (sectionStack.length > 0) {
        sectionStack[sectionStack.length - 1].section.content = content;
        sectionStack[sectionStack.length - 1].section.contentStartLine = adjustedStartLine;
      } else {
        preamble = content;
        preambleStartLine = adjustedStartLine;
      }
      currentContent = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1; // 1-based

    // Track fenced code blocks (``` or ~~~)
    if (line.trimStart().match(/^(`{3,}|~{3,})/)) {
      inCodeBlock = !inCodeBlock;
    }

    const headingMatch = !inCodeBlock && line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      flushContent();

      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      const newSection: Section = {
        id: `section-${sectionCounter++}`,
        level,
        title,
        content: '',
        contentStartLine: lineNum + 1, // default: line after heading
        children: [],
      };

      // Pop sections from stack that are same level or deeper
      while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1].level >= level) {
        sectionStack.pop();
      }

      // Add to parent or root
      if (sectionStack.length > 0) {
        sectionStack[sectionStack.length - 1].section.children.push(newSection);
      } else {
        sections.push(newSection);
      }

      sectionStack.push({ section: newSection, level });
      // Next content line starts after this heading
      currentContentStartLine = lineNum + 1;
    } else {
      if (currentContent.length === 0) {
        currentContentStartLine = lineNum;
      }
      currentContent.push(line);
    }
  }

  flushContent();

  return { preamble, preambleStartLine, sections };
}

interface MarkdownContentProps {
  content: string;
  theme: string;
  components: Record<string, React.ComponentType<any>>;
  /** If provided, creates an interactive checkbox input component adjusted by lineOffset */
  onCheckboxToggle?: (absoluteLine: number) => void;
  /** 1-based line offset of this content fragment within the full document */
  lineOffset: number;
}

const MarkdownContent: React.FC<MarkdownContentProps> = ({ content, components, onCheckboxToggle, lineOffset }) => {
  if (!content.trim()) return null;

  // Build section-specific components with adjusted checkbox handler
  const sectionComponents = React.useMemo(() => {
    if (!onCheckboxToggle) return components;
    return {
      ...components,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      li: (props: any) => {
        const { children, className, node } = props;
        const isTask = className === 'task-list-item';
        if (!isTask) return <li className="my-1">{children}</li>;

        // Task list item — the li node has position, the synthetic input does not
        const sectionRelativeLine = node?.position?.start?.line;
        const absoluteLine = sectionRelativeLine ? sectionRelativeLine + lineOffset - 1 : undefined;

        // Find the checkbox among children and replace it with an interactive one
        const newChildren = React.Children.map(children, (child) => {
          if (React.isValidElement(child) && (child as any).props?.type === 'checkbox') {
            const checked = (child as any).props?.checked || false;
            return (
              <input
                type="checkbox"
                checked={checked}
                disabled={!absoluteLine}
                onChange={() => absoluteLine && onCheckboxToggle(absoluteLine)}
                className="mr-2 cursor-pointer accent-blue-600"
              />
            );
          }
          return child;
        });

        return <li className="my-1 list-none">{newChildren}</li>;
      },
    };
  }, [components, onCheckboxToggle, lineOffset]);

  return (
    <ReactMarkdown
      components={sectionComponents}
      remarkPlugins={[remarkGfm, remarkDiagramEmbeds]}
      rehypePlugins={[rehypeRaw]}
    >
      {content}
    </ReactMarkdown>
  );
};

interface SectionRendererProps {
  section: Section;
  theme: string;
  components: Record<string, React.ComponentType<any>>;
  onCheckboxToggle?: (absoluteLine: number) => void;
}

const SectionRenderer: React.FC<SectionRendererProps> = ({ section, theme, components, onCheckboxToggle }) => {
  return (
    <ManagedCollapsibleSection
      level={section.level}
      title={section.title}
      sectionId={section.id}
    >
      <MarkdownContent
        content={section.content}
        theme={theme}
        components={components}
        onCheckboxToggle={onCheckboxToggle}
        lineOffset={section.contentStartLine}
      />
      {section.children.map(child => (
        <SectionRenderer key={child.id} section={child} theme={theme} components={components} onCheckboxToggle={onCheckboxToggle} />
      ))}
    </ManagedCollapsibleSection>
  );
};

export interface CollapsibleMarkdownProps {
  content: string;
  className?: string;
  /** Extra component overrides to merge with defaults */
  extraComponents?: Record<string, React.ComponentType<any>>;
  /** Callback when a checkbox is toggled; receives the 1-based absolute line number in the full document */
  onCheckboxToggle?: (absoluteLine: number) => void;
}

export const CollapsibleMarkdown: React.FC<CollapsibleMarkdownProps> = ({
  content,
  className = '',
  extraComponents,
  onCheckboxToggle,
}) => {
  const { theme } = useTheme();

  const { preamble, preambleStartLine, sections } = useMemo(() => parseMarkdownSections(content), [content]);

  const baseComponents = useMemo(
    () => ({
      // Paragraphs
      p: ({ children }: { children?: React.ReactNode }) => (
        <p className="my-3 text-gray-700 dark:text-gray-300 leading-relaxed">
          {children}
        </p>
      ),

      // Text styling
      strong: ({ children }: { children?: React.ReactNode }) => (
        <strong className="font-bold text-gray-900 dark:text-white">
          {children}
        </strong>
      ),
      em: ({ children }: { children?: React.ReactNode }) => (
        <em className="italic text-gray-700 dark:text-gray-300">
          {children}
        </em>
      ),

      // Links
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          {children}
        </a>
      ),

      // Lists
      ul: ({ children }: { children?: React.ReactNode }) => (
        <ul className="list-disc list-inside my-3 ml-2 text-gray-700 dark:text-gray-300">
          {children}
        </ul>
      ),
      ol: ({ children }: { children?: React.ReactNode }) => (
        <ol className="list-decimal list-inside my-3 ml-2 text-gray-700 dark:text-gray-300">
          {children}
        </ol>
      ),
      li: ({ children }: { children?: React.ReactNode }) => (
        <li className="my-1">{children}</li>
      ),

      // Code blocks
      pre: ({ children }: { children?: React.ReactNode }) => {
        const codeElement = React.Children.toArray(children).find(
          (child): child is React.ReactElement =>
            React.isValidElement(child) && child.type === 'code'
        );

        if (!codeElement) {
          return <pre className="my-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg overflow-auto">{children}</pre>;
        }

        const codeClassName = codeElement.props.className || '';
        const match = /language-(\w+)/.exec(codeClassName);
        const language = match ? match[1] : 'text';
        const code = String(codeElement.props.children).replace(/\n$/, '');

        return (
          <div className="my-4 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
            <SyntaxHighlighter
              language={language}
              style={theme === 'dark' ? oneDark : vs}
              showLineNumbers={false}
              customStyle={{
                margin: 0,
                padding: '1rem',
                fontSize: '0.875rem',
              }}
            >
              {code}
            </SyntaxHighlighter>
          </div>
        );
      },

      // Inline code
      code: ({ className: codeClassName, children }: { className?: string; children?: React.ReactNode }) => {
        if (codeClassName) {
          return <code className={codeClassName}>{children}</code>;
        }
        return (
          <code className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded font-mono text-sm text-gray-900 dark:text-gray-100">
            {children}
          </code>
        );
      },

      // Blockquotes
      blockquote: ({ children }: { children?: React.ReactNode }) => (
        <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 my-4 italic text-gray-600 dark:text-gray-400">
          {children}
        </blockquote>
      ),

      // Horizontal rule
      hr: () => (
        <hr className="my-4 border-t-2 border-gray-300 dark:border-gray-600" />
      ),

      // Tables
      table: ({ children }: { children?: React.ReactNode }) => (
        <table className="my-4 w-full border-collapse border border-gray-300 dark:border-gray-600">
          {children}
        </table>
      ),
      thead: ({ children }: { children?: React.ReactNode }) => (
        <thead className="bg-gray-100 dark:bg-gray-800">{children}</thead>
      ),
      tbody: ({ children }: { children?: React.ReactNode }) => (
        <tbody>{children}</tbody>
      ),
      tr: ({ children }: { children?: React.ReactNode }) => (
        <tr className="border-b border-gray-300 dark:border-gray-600">
          {children}
        </tr>
      ),
      td: ({ children }: { children?: React.ReactNode }) => (
        <td className="p-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300">
          {children}
        </td>
      ),
      th: ({ children }: { children?: React.ReactNode }) => (
        <th className="p-2 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white font-bold text-left">
          {children}
        </th>
      ),
    }),
    [theme, extraComponents]
  );

  // Merge extra components (e.g. interactive checkbox input) on top of defaults
  const mergedComponents = useMemo(
    () => extraComponents ? { ...baseComponents, ...extraComponents } : baseComponents,
    [baseComponents, extraComponents]
  );

  // Count total sections (including nested)
  const countSections = (secs: Section[]): number => {
    return secs.reduce((acc, s) => acc + 1 + countSections(s.children), 0);
  };
  const totalSections = countSections(sections);

  return (
    <CollapsibleSectionsProvider>
      <div className={`collapsible-markdown ${className}`} data-testid="collapsible-markdown">
        {/* Always show controls if there are sections */}
        {totalSections > 0 && <CollapsibleSectionsControls />}

        {/* Preamble content before first heading */}
        {preamble && (
          <div className="preamble mb-4">
            <MarkdownContent
              content={preamble}
              theme={theme}
              components={mergedComponents}
              onCheckboxToggle={onCheckboxToggle}
              lineOffset={preambleStartLine}
            />
          </div>
        )}

        {/* Collapsible sections */}
        {sections.map(section => (
          <SectionRenderer key={section.id} section={section} theme={theme} components={mergedComponents} onCheckboxToggle={onCheckboxToggle} />
        ))}
      </div>
    </CollapsibleSectionsProvider>
  );
};

export default CollapsibleMarkdown;
