import { b64ToDataURL, b64ToText } from '../../lib/blueprint'

/** Ảnh (png/jpg/webp) và SVG icon — dataURL đơn giản, không phải quản vòng đời objectURL. */
export function ImageView({ b64, contentType, alt }: { b64: string; contentType: string; alt: string }) {
  return (
    <div className="flex justify-center rounded-lg bg-neutral-50 p-4 dark:bg-neutral-900">
      <img
        src={b64ToDataURL(b64, contentType)}
        alt={alt}
        className="max-h-[80vh] max-w-full object-contain"
      />
    </div>
  )
}

/** JSON pretty. Parse lỗi → hiện text thô (vẫn đọc được, không vỡ). */
export function JsonView({ b64 }: { b64: string }) {
  const text = b64ToText(b64)
  let pretty = text
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    /* để nguyên text thô */
  }
  return (
    <pre className="max-h-[80vh] overflow-auto rounded-lg bg-neutral-50 p-4 font-mono text-xs text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
      {pretty}
    </pre>
  )
}

export function TextView({ b64 }: { b64: string }) {
  return (
    <pre className="max-h-[80vh] overflow-auto rounded-lg bg-neutral-50 p-4 font-mono text-xs whitespace-pre-wrap text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
      {b64ToText(b64)}
    </pre>
  )
}
