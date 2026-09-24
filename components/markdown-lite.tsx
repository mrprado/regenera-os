// Renders the small Markdown subset contract templates use (#/## headings, **bold**, "- " lists, "> " notes,
// paragraphs) as React elements. No HTML is ever injected, so contract text cannot carry markup or scripts.
import type { ReactNode } from "react";

function inline(text: string, key: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong> : part);
}

export default function MarkdownLite({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (para.length) { const k = `p${blocks.length}`; blocks.push(<p key={k}>{para.flatMap((l, i) => (i ? [<br key={`${k}-br${i}`} />, ...inline(l, `${k}-${i}`)] : inline(l, `${k}-${i}`)))}</p>); para = []; }
    if (list.length) { const k = `ul${blocks.length}`; blocks.push(<ul key={k}>{list.map((l, i) => <li key={i}>{inline(l, `${k}-${i}`)}</li>)}</ul>); list = []; }
  };
  for (const line of lines) {
    const t = line.trimEnd();
    if (!t.trim()) { flush(); continue; }
    if (t.startsWith("# ")) { flush(); blocks.push(<h1 key={`h${blocks.length}`}>{inline(t.slice(2), `h${blocks.length}`)}</h1>); continue; }
    if (t.startsWith("## ")) { flush(); blocks.push(<h2 key={`h${blocks.length}`}>{inline(t.slice(3), `h${blocks.length}`)}</h2>); continue; }
    if (t.startsWith("> ")) { flush(); blocks.push(<blockquote key={`q${blocks.length}`}>{inline(t.slice(2), `q${blocks.length}`)}</blockquote>); continue; }
    if (/^- /.test(t)) { if (para.length) flush(); list.push(t.slice(2)); continue; }
    if (list.length) flush();
    para.push(t);
  }
  flush();
  return <div className={className}>{blocks}</div>;
}
