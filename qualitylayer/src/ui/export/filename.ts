export const exportName = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "qualitylayer-export"

export async function exportRevision(source: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source))
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, "0")).join("")
}
