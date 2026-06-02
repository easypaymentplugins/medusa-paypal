export type AdminFetchOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
  body?: Record<string, unknown>
  query?: Record<string, string>
}

export async function adminFetch<T = unknown>(path: string, opts: AdminFetchOptions = {}): Promise<T> {
  const { method = "GET", body, query } = opts
  let url = path
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams(query)
    url = `${path}?${params.toString()}`
  }
  const headers: Record<string, string> = { Accept: "application/json" }
  if (body !== undefined) headers["Content-Type"] = "application/json"
  if (typeof window !== "undefined") {
    const token = (window as any).__medusa__?.token
    if (token) headers["Authorization"] = `Bearer ${token}`
  }
  const res = await fetch(url, {
    method, headers, credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text().catch(() => "")
  if (!res.ok) {
    if (res.status === 401) throw new Error("Unauthorized (401) - session may have expired. Please reload and log in again.")
    if (res.status === 403) throw new Error("Forbidden (403) - you do not have permission to perform this action.")
    throw new Error(text || `Request failed with status ${res.status}`)
  }
  if (!text) return {} as T
  try { return JSON.parse(text) as T } catch { return {} as T }
}
