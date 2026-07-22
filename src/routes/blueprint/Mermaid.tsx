import { useEffect, useRef, useState } from 'react'

/** Render một khối ```mermaid thành SVG. Lazy-import mermaid (nặng ~vài trăm KB)
 *  nên chỉ tải khi thật sự có diagram. Lỗi cú pháp → hiện code thô, không làm vỡ trang. */
export default function Mermaid({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const id = `mmd-${Math.random().toString(36).slice(2)}`
    // Mỗi lần: import → khởi tạo theo dark-mode hiện tại → render.
    ;(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
        mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' })
        const { svg } = await mermaid.render(id, code)
        if (alive && ref.current) ref.current.innerHTML = svg
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [code])

  if (error) {
    return (
      <pre className="overflow-x-auto rounded bg-neutral-100 p-3 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
        <div className="mb-1 text-red-600 dark:text-red-400">mermaid lỗi: {error}</div>
        {code}
      </pre>
    )
  }
  return <div ref={ref} className="my-3 flex justify-center overflow-x-auto" />
}
