import { Fragment, type ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  const result: ReactNode[] = [];
  const tokens = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\s]+\))/g;
  let previous = 0;
  for (const match of text.matchAll(tokens)) {
    const index = match.index!;
    result.push(text.slice(previous, index));
    const token = match[0];
    let node: ReactNode = token;
    if (token.startsWith('`')) node = <code className="ai-inline-code">{token.slice(1, -1)}</code>;
    else if (token.startsWith('**')) node = <strong>{token.slice(2, -2)}</strong>;
    else if (token.startsWith('*')) node = <em>{token.slice(1, -1)}</em>;
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)!;
      try {
        const url = new URL(link[2]!);
        if (['https:', 'http:'].includes(url.protocol)) node = <a href={url.href} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
      } catch { /* Invalid URLs remain inert text. */ }
    }
    result.push(<Fragment key={index}>{node}</Fragment>);
    previous = index + token.length;
  }
  result.push(text.slice(previous));
  return result;
}

/** Render a deliberately small Markdown subset as escaped React text, never HTML. */
export function ChatMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('```')) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i]!.startsWith('```')) code.push(lines[i]!);
      blocks.push(<pre className="ai-code-block" key={i}><code>{code.join('\n')}</code></pre>);
    } else if (/^#{1,3} /.test(line)) {
      const [, hashes, content] = /^(#{1,3}) (.*)$/.exec(line)!;
      const Heading = ({ 1: 'h2', 2: 'h3', 3: 'h4' } as const)[hashes!.length as 1 | 2 | 3];
      blocks.push(<Heading className="ai-heading" key={i}>{inline(content!)}</Heading>);
    } else if (/^- /.test(line)) {
      const items: ReactNode[] = [];
      do { items.push(<li key={i}>{inline(lines[i]!.slice(2))}</li>); i++; }
      while (i < lines.length && /^- /.test(lines[i]!));
      i--;
      blocks.push(<ul className="ai-list" key={i}>{items}</ul>);
    } else blocks.push(<Fragment key={i}>{inline(line)}{i < lines.length - 1 && <br />}</Fragment>);
  }
  return <>{blocks}</>;
}
