import type { HostFrame, ViewerState } from "../../core/run/protocol.ts"
import type { TerminalImageUpload } from "./terminal-images.ts"

export type TerminalTheme = { foreground: string; background: string; cursor: string }
export type TerminalControl = "interrupt" | "stop" | "take-control"
export type TerminalControlSender = (action: TerminalControl) => boolean
/** How the terminal draws: with WebGL, without it by choice, or without it because WebGL failed. */
export type RendererState = "webgl" | "basic" | "failed"
export type PresentationState = "loading" | "connecting" | "restoring" | "ready" | "failed"
export type ReconnectInfo = {
  status: "live" | "reconnecting" | "disconnected"
  attempt: number
  max: number
}
export type TerminalOptions = {
  url: string
  generation: number
  watching: boolean
  phone?: boolean
  resume: string
  theme?: TerminalTheme
  attachFiles?: TerminalImageUpload
  onEvent?: (event: HostFrame) => void
  onViewer?: (state: ViewerState) => void
  onControl?: (sender: TerminalControlSender | undefined) => void
  onRenderer?: (state: RendererState) => void
  /** Ready means the initial output has been parsed and the display can be painted. */
  onPresentation?: (state: PresentationState) => void
  onReconnectState?: (state: ReconnectInfo) => void
}
export type FreshResult = Extract<HostFrame, { type: "fresh-result" }>
export interface TerminalView {
  mount(root: HTMLElement): Promise<void>
  write(text: string): void
  onInput(listener: (text: string) => void): () => void
  /** Type text into the agent's window as a person would; false when this window cannot type. */
  sendInput?(text: string): boolean
  /** Pastes image paths and resolves once the agent drew each one; false when it did not. */
  pasteImages?(paths: readonly string[]): Promise<boolean>
  fresh?(sequence: number): Promise<FreshResult>
  resize(cols: number, rows: number): void
  focus(): void
  dispose(): void
  setTheme(theme: TerminalTheme): void
  setPhone?(phone: boolean): void
  /** A hidden window parses no output and, past the last few hidden, releases its WebGL context. */
  setVisible?(visible: boolean): void
  /** After WebGL failed, try it once more. */
  retryRenderer?(): void
}

export function terminalTheme(root: HTMLElement): TerminalTheme {
  const style = getComputedStyle(root)
  return {
    foreground: style.getPropertyValue("--ql-text").trim() || "#171717",
    background: style.getPropertyValue("--ql-bg-sunken").trim() || "#fafafa",
    cursor: style.getPropertyValue("--ql-text").trim() || "#171717",
  }
}

/** The main App imports this small interface; the renderer and fonts arrive only when a window opens. */
export function createTerminalView(options: TerminalOptions): TerminalView {
  let view: TerminalView | undefined
  let disposed = false
  let mountStarted = false
  const inputs = new Set<(text: string) => void>()
  let theme = options.theme
  let phone = options.phone
  let visible = true
  return {
    async mount(root) {
      if (disposed) return
      if (mountStarted) throw new Error("terminal already mounted")
      mountStarted = true
      options.onPresentation?.("loading")
      try {
        const path = "/terminal.js"
        const module = (await import(/* @vite-ignore */ path)) as {
          createXtermView(options: TerminalOptions): TerminalView
        }
        if (disposed) return
        view = module.createXtermView({ ...options, theme, phone })
        view.setVisible?.(visible)
        view.onInput((text) => {
          for (const listener of inputs) listener(text)
        })
        await view.mount(root)
        if (disposed) view.dispose()
      } catch {
        view?.dispose()
        if (disposed) return
        const message = document.createElement("p")
        message.textContent = "This window can't be drawn here"
        message.setAttribute("role", "status")
        const command = document.createElement("code")
        command.textContent = options.resume
        command.style.overflowWrap = "anywhere"
        root.replaceChildren(message, command)
        options.onPresentation?.("failed")
      }
    },
    write: (text) => view?.write(text),
    onInput(listener) {
      inputs.add(listener)
      return () => inputs.delete(listener)
    },
    sendInput: (text) => view?.sendInput?.(text) ?? false,
    pasteImages: (paths) => view?.pasteImages?.(paths) ?? Promise.resolve(false),
    fresh: (sequence) =>
      view?.fresh?.(sequence) ??
      Promise.reject(new Error("This session cannot start fresh here. Open Terminal instead.")),
    resize: (cols, rows) => view?.resize(cols, rows),
    focus: () => {
      view?.focus()
    },
    dispose() {
      disposed = true
      view?.dispose()
      inputs.clear()
    },
    setTheme(next) {
      theme = next
      view?.setTheme(next)
    },
    setPhone(next) {
      phone = next
      view?.setPhone?.(next)
    },
    setVisible(next) {
      visible = next
      view?.setVisible?.(next)
    },
    retryRenderer: () => view?.retryRenderer?.(),
  }
}
