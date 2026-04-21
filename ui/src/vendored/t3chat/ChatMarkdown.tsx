import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Highlight from 'react-syntax-highlighter';
import { atomOneDark, atomOneLight } from 'react-syntax-highlighter/dist/cjs/styles/hljs';
import { cn } from './lib/utils';

export interface ChatMarkdownProps {
  content: string;
  className?: string;
}

export const ChatMarkdown: React.FC<ChatMarkdownProps> = ({ content, className }) => {
  const isDark =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches;

  const components = {
    h1: (p: any) => <h1 className="text-2xl font-bold mt-4 mb-2" {...p} />,
    h2: (p: any) => <h2 className="text-xl font-bold mt-3 mb-2" {...p} />,
    h3: (p: any) => <h3 className="text-lg font-bold mt-2 mb-1" {...p} />,
    p: (p: any) => <p className="mb-2 leading-relaxed" {...p} />,
    ul: (p: any) => <ul className="list-disc pl-5 mb-2" {...p} />,
    ol: (p: any) => <ol className="list-decimal pl-5 mb-2" {...p} />,
    li: (p: any) => <li className="mb-0.5" {...p} />,
    a: (p: any) => (
      <a className="text-primary underline-offset-4 hover:underline" target="_blank" rel="noopener noreferrer" {...p} />
    ),
    blockquote: (p: any) => <blockquote className="border-l-2 border-border pl-3 italic text-muted-foreground my-2" {...p} />,
    hr: (p: any) => <hr className="my-3 border-border" {...p} />,
    code: ({ inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '');
      const isBlock = inline === false || !!match;
      if (isBlock) {
        const lang = match ? match[1] : 'text';
        const code = String(children).replace(/\n$/, '');
        return (
          <div className="mb-2 rounded-md overflow-hidden border border-border">
            <Highlight
              language={lang}
              style={(isDark ? atomOneDark : atomOneLight) as any}
              customStyle={{ margin: 0, padding: '10px 12px', fontSize: '13px', background: 'transparent' }}
              {...({ wrapLongLines: true } as any)}
            >
              {code}
            </Highlight>
          </div>
        );
      }
      return (
        <code className="px-1 py-0.5 bg-muted rounded text-[0.85em] font-mono" {...props}>
          {children}
        </code>
      );
    },
    table: (p: any) => (
      <div className="overflow-x-auto mb-2">
        <table className="border-collapse border border-border w-full text-sm" {...p} />
      </div>
    ),
    th: (p: any) => <th className="border border-border bg-muted px-2 py-1 text-left font-semibold" {...p} />,
    td: (p: any) => <td className="border border-border px-2 py-1" {...p} />,
  };

  return (
    <div
      className={cn(
        // `prose-code` injects literal backticks via ::before / ::after which
        // show up in the a11y tree ("backtick foo backtick") and visually
        // double up with our own `<code>` styling. Clear them.
        'prose prose-sm max-w-none dark:prose-invert',
        'prose-code:before:content-none prose-code:after:content-none',
        className
      )}
    >
      <ReactMarkdown components={components as any} remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
};

ChatMarkdown.displayName = 'ChatMarkdown';
