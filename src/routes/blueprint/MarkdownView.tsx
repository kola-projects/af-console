import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import Mermaid from './Mermaid'

/** Render markdown "y như local": GFM (bảng, checklist, strikethrough), tô màu code
 *  (rehype-highlight + theme highlight.js ở index.css), và ```mermaid → diagram.
 *  prose dark:prose-invert bám dark-mode media của app. */
export default function MarkdownView({ text }: { text: string }) {
  return (
    <div className="prose prose-neutral max-w-none dark:prose-invert prose-pre:bg-neutral-100 dark:prose-pre:bg-neutral-900 prose-pre:text-neutral-800 dark:prose-pre:text-neutral-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          code({ className, children, ...props }) {
            // Chặn riêng mermaid — rehype-highlight bỏ qua (không phải ngôn ngữ đã đăng ký),
            // nên children vẫn là source thô để vẽ diagram.
            if (className && /\blanguage-mermaid\b/.test(className)) {
              return <Mermaid code={String(children ?? '').replace(/\n$/, '')} />
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            )
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
