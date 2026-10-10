/**
 * A very small Markdown renderer for the agent's reports: headings, bullet
 * and numbered lists, paragraphs, bold, italics. No HTML passthrough, no
 * dependencies. The agent's output is short and plain, and anything it emits
 * is rendered as text, never as markup.
 */

import type { ReactNode } from "react";

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // **bold**, *italic*, `code`
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={`${keyPrefix}-b${i}`} className="font-medium text-foreground">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={`${keyPrefix}-c${i}`} className="font-data text-xs bg-muted rounded-xs px-xxs">{tok.slice(1, -1)}</code>);
    else out.push(<em key={`${keyPrefix}-i${i}`}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderMarkdown(md: string): ReactNode[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      const text = para.join(" ").trim();
      if (text) nodes.push(<p key={`p${key++}`} className="text-s text-neutral-8">{inline(text, `p${key}`)}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const Tag = list.ordered ? "ol" : "ul";
      nodes.push(
        <Tag key={`l${key++}`} className={`${list.ordered ? "list-decimal" : "list-disc"} pl-l flex flex-col gap-xxs text-s text-neutral-8`}>
          {list.items.map((item, idx) => (
            <li key={idx}>{inline(item, `l${key}-${idx}`)}</li>
          ))}
        </Tag>,
      );
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);

    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      const cls =
        level === 1
          ? "font-brand text-l font-heavy text-foreground mt-s"
          : level === 2
          ? "font-brand text-m font-medium text-foreground mt-s"
          : "font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground mt-xs";
      nodes.push(<p key={`h${key++}`} className={cls}>{inline(heading[2], `h${key}`)}</p>);
      continue;
    }
    if (bullet || numbered) {
      flushPara();
      const ordered = !!numbered && !bullet;
      const item = (bullet ?? numbered)![1];
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(item);
      continue;
    }
    if (line.startsWith("---")) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return nodes;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  return <div className={`flex flex-col gap-s ${className ?? ""}`}>{renderMarkdown(source)}</div>;
}
