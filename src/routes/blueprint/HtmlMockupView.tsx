import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { blueprintDir } from '../../lib/queries'
import { b64ToDataURL, b64ToText, mimeOf } from '../../lib/blueprint'
import type { BlueprintFileContent } from '../../lib/types'
import { ErrorBox, Loading } from '../../components/ui'

/** Render mockup HTML "thành trang thật". Mỗi file là 1 dòng DB (không có server tĩnh),
 *  nên link tương đối (icon, css, screen html nhúng qua iframe/anchor) phải được thay bằng
 *  data URL trước khi nạp iframe.
 *
 *  - Asset không-phải-html (svg/png/css/js) → data URL nội tuyến (MIME theo đuôi path).
 *  - CSS: rewrite url(...) bên trong trước khi data-URL hoá.
 *  - HTML khác (screen nhúng qua <iframe src> hoặc link <a href>) → data URL của HTML đó,
 *    cũng đã inline asset một cấp (đủ cho gallery index → screen). iframe có sandbox. */
export default function HtmlMockupView({ runName, path }: { runName: string; path: string }) {
  // Prefix = thư mục chứa file (thường design_previews/) — không hardcode, để aso/*.html cũng chạy.
  const prefix = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
  const dir = useQuery({
    queryKey: ['blueprint-dir', runName, prefix],
    queryFn: () => blueprintDir(runName, prefix),
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
const CSS_RE = /\.css$/i

/** Nối path tương đối `ref` vào thư mục của `basePath`, chuẩn hoá ./ và ../.
 *  Bỏ ?query và #hash để khớp key trong map blueprint. */
function resolve(basePath: string, ref: string): string {
  const clean = ref.split('#')[0]?.split('?')[0] ?? ref
  const parts = basePath.split('/').slice(0, -1) // bỏ tên file, còn thư mục
  for (const seg of clean.split('/')) {
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

function cssDataURL(css: string): string {
  return `data:text/css;charset=utf-8,${encodeURIComponent(css)}`
}

/** Rewrite url(...) trong CSS — background-image, @font-face, v.v. */
function rewriteCssUrls(
  css: string,
  cssPath: string,
  byPath: Map<string, BlueprintFileContent>,
): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, _q: string, ref: string) => {
    const trimmed = ref.trim()
    if (!isRelative(trimmed)) return full
    const resolved = resolve(cssPath, trimmed)
    const file = byPath.get(resolved)
    if (!file) return full
    return `url("${b64ToDataURL(file.content_b64, mimeOf(file.path, file.content_type))}")`
  })
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
    } else if (CSS_RE.test(resolved)) {
      el.setAttribute(
        attr,
        cssDataURL(rewriteCssUrls(b64ToText(file.content_b64), file.path, byPath)),
      )
    } else {
      el.setAttribute(attr, b64ToDataURL(file.content_b64, mimeOf(file.path, file.content_type)))
    }
  }

  doc.querySelectorAll('[src]').forEach((el) => replace(el, 'src'))
  doc.querySelectorAll('a[href], link[href], use[href], image[href]').forEach((el) => replace(el, 'href'))
  doc.querySelectorAll('image').forEach((el) => {
    if (el.hasAttribute('xlink:href')) replace(el, 'xlink:href')
  })
  doc.querySelectorAll('[poster]').forEach((el) => replace(el, 'poster'))

  // srcset: "a.png 1x, b.png 2x"
  doc.querySelectorAll('[srcset]').forEach((el) => {
    const v = el.getAttribute('srcset')
    if (!v) return
    const next = v
      .split(',')
      .map((part) => {
        const trimmed = part.trim()
        if (!trimmed) return trimmed
        const [url, ...rest] = trimmed.split(/\s+/)
        if (!url || !isRelative(url)) return trimmed
        const resolved = resolve(htmlPath, url)
        const file = byPath.get(resolved)
        if (!file) return trimmed
        const data = b64ToDataURL(file.content_b64, mimeOf(file.path, file.content_type))
        return rest.length ? `${data} ${rest.join(' ')}` : data
      })
      .join(', ')
    el.setAttribute('srcset', next)
  })

  // style="" và <style> — background:url(...), v.v.
  doc.querySelectorAll('[style]').forEach((el) => {
    const v = el.getAttribute('style')
    if (!v || !/url\s*\(/i.test(v)) return
    el.setAttribute('style', rewriteCssUrls(v, htmlPath, byPath))
  })
  doc.querySelectorAll('style').forEach((el) => {
    const css = el.textContent ?? ''
    if (!css || !/url\s*\(/i.test(css)) return
    el.textContent = rewriteCssUrls(css, htmlPath, byPath)
  })

  return doc
}

function serialize(doc: Document): string {
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`
}
