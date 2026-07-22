import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { blueprintDir } from '../../lib/queries'
import { b64ToDataURL, b64ToText } from '../../lib/blueprint'
import type { BlueprintFileContent } from '../../lib/types'
import { ErrorBox, Loading } from '../../components/ui'

/** Render mockup HTML "thành trang thật". Mỗi file là 1 dòng DB (không có server tĩnh),
 *  nên link tương đối (icon, css, screen html nhúng qua iframe/anchor) phải được thay bằng
 *  data URL trước khi nạp iframe.
 *
 *  - Asset không-phải-html (svg/png/css/js) → data URL nội tuyến.
 *  - HTML khác (screen nhúng qua <iframe src> hoặc link <a href>) → data URL của HTML đó,
 *    cũng đã inline asset một cấp (đủ cho gallery index → screen). iframe có sandbox. */
export default function HtmlMockupView({ runName, path }: { runName: string; path: string }) {
  const dir = useQuery({
    queryKey: ['blueprint-dir', runName, 'design_previews/'],
    queryFn: () => blueprintDir(runName, 'design_previews/'),
  })

  const srcDoc = useMemo(() => {
    if (!dir.data) return null
    const target = dir.data.find((f) => f.path === path)
    if (!target) return null
    const byPath = new Map(dir.data.map((f) => [f.path, f]))
    return serialize(rewriteDoc(b64ToText(target.content_b64), target.path, byPath, true))
  }, [dir.data, path])

  if (dir.isLoading) return <Loading />
  if (dir.error) return <ErrorBox error={dir.error} />
  if (!srcDoc) return <ErrorBox error={new Error('Không dựng được mockup.')} />

  return (
    <iframe
      title={path}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      className="h-[80vh] w-full rounded-lg border border-neutral-200 bg-white dark:border-neutral-800"
    />
  )
}

const HTML_RE = /\.html?$/i

/** Nối path tương đối `ref` vào thư mục của `basePath`, chuẩn hoá ./ và ../ */
function resolve(basePath: string, ref: string): string {
  const parts = basePath.split('/').slice(0, -1) // bỏ tên file, còn thư mục
  for (const seg of ref.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

function isRelative(v: string): boolean {
  return !!v && !/^(https?:|data:|blob:|mailto:|tel:|javascript:|#|\/\/)/i.test(v)
}

function htmlDataURL(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

/** Rewrite mọi ref tương đối trong 1 tài liệu HTML.
 *  `nestHtml` = true: HTML nhúng cũng được inline asset một cấp rồi biến thành data URL
 *  (dùng cho tài liệu gốc). Ở tầng nhúng gọi lại với nestHtml=false để tránh đệ quy vô hạn. */
function rewriteDoc(
  htmlText: string,
  htmlPath: string,
  byPath: Map<string, BlueprintFileContent>,
  nestHtml: boolean,
): Document {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html')

  const replace = (el: Element, attr: string) => {
    const v = el.getAttribute(attr)
    if (!v || !isRelative(v)) return
    const resolved = resolve(htmlPath, v)
    const file = byPath.get(resolved)
    if (!file) return
    if (HTML_RE.test(resolved)) {
      // HTML nhúng: chỉ inline asset một cấp (nestHtml=false) rồi thành data URL.
      if (nestHtml) {
        const inner = serialize(rewriteDoc(b64ToText(file.content_b64), file.path, byPath, false))
        el.setAttribute(attr, htmlDataURL(inner))
      }
      // nếu không nest thì để nguyên (điều hướng sâu dùng sidebar)
    } else {
      el.setAttribute(attr, b64ToDataURL(file.content_b64, file.content_type))
    }
  }

  doc.querySelectorAll('[src]').forEach((el) => replace(el, 'src'))
  doc.querySelectorAll('a[href], link[href], use[href]').forEach((el) => replace(el, 'href'))
  doc.querySelectorAll('[poster]').forEach((el) => replace(el, 'poster'))
  return doc
}

function serialize(doc: Document): string {
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`
}
