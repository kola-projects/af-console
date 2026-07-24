/** Version build-time từ package.json (vite define). Không fetch /package.json — file đó không có trong dist. */
export const APP_VERSION: string = __APP_VERSION__

const GITHUB_PKG =
  'https://api.github.com/repos/kola-projects/af-console/contents/package.json'

/** Version trên nhánh mặc định GitHub (sau khi release push). */
export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(GITHUB_PKG)
    if (!res.ok) return null
    const data = (await res.json()) as { content?: string }
    if (!data.content) return null
    const pkg = JSON.parse(atob(data.content)) as { version?: string }
    return pkg.version ?? null
  } catch {
    return null
  }
}
