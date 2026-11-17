export type ExportFormat = "pdf" | "png" | "html" | "markdown"
export type ExportPage = {
  title: string
  html: string
  width: number
  kind?: "document"
  section?: string
}
export type ExportAsset = { name: string; type: string; base64: string }
export type ExportInput = {
  format: ExportFormat
  title: string
  name: string
  pages: ExportPage[]
  markdown?: string
  assets?: ExportAsset[]
  revision?: string
}
export type ExportFile = { name: string; type: string; base64: string }
