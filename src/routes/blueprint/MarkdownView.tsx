import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import Mermaid from './Mermaid'

/** Lấy text thuần từ children của fenced code (string hoặc cây highlight). */
function codeText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children).replace(/\n$/, '')
  }
  if (Array.isArray(children)) return children.map(codeText).join('').replace(/\n$/, '')
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return codeText(children.props.children)
  }
  return ''
}

/** Render markdown "y như local": GFM (bảng, checklist, strikethrough), HTML nhúng,
 *  tô màu code (rehype-highlight + theme highlight.js ở index.css), và ```mermaid → diagram.
 *  prose dark:prose-invert bám dark-mode media của app. */
export default function MarkdownView({ text }: { text: string }) {
  return (
    <div className="prose prose-neutral max-w-none dark:prose-invert prose-pre:bg-neutral-100 dark:prose-pre:bg-neutral-900 prose-pre:text-neutral-800 dark:prose-pre:text-neutral-200 prose-table:text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // rehype-raw trước highlight: parse HTML thô trong .md; mermaid không phải ngôn ngữ hljs
        // nên ignoreMissing giữ source để vẽ diagram.
        rehypePlugins={[rehypeRaw, [rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          // Thay cả khối <pre> — nếu chỉ thay <code> thì Mermaid nằm trong <pre> (HTML sai → vỡ layout).
          pre({ children }) {
            const child = Children.toArray(children).find(isValidElement) as
              | ReactElement<{ className?: string; children?: ReactNode }>
              | undefined
            const className = child?.props?.className ?? ''
            if (/\blanguage-mermaid\b/.test(className)) {
              return <Mermaid code={codeText(child!.props.children)} />
            }
            return <pre>{children}</pre>
          },
          code({ className, children, node: _node, ...props }) {
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
