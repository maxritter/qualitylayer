import type { Terminal } from "@xterm/xterm"
import type { ViewerState } from "../../core/run/protocol.ts"
import {
  appearanceTheme,
  fontFamilyOf,
  readTerminalAppearance,
  subscribeTerminalAppearance,
} from "./appearance.ts"
import { loadBrowserTerminalFonts } from "./fonts.ts"
import { TerminalImages } from "./terminal-images.ts"
import type { AgentTransport } from "./transport.ts"
import {
  type TerminalOptions,
  type TerminalTheme,
  type TerminalView,
  terminalTheme,
} from "./view.ts"
import { readXtermDiagnostics } from "./xterm-diagnostics.ts"
import { DisplayQueue } from "./xterm-display.ts"
import { applyTerminalAppearance, keyProtocolSwitch, xtermThemeConfig } from "./xterm-dom.ts"
import { ImageEchoTracker } from "./xterm-echo.ts"
import { type MouseState, repairRebuildMouseEncoding, syncMouseTracking } from "./xterm-input.ts"
import { XtermLayout } from "./xterm-layout.ts"
import {
  applyTerminalStdinState,
  createCopyFeedbackElement,
  createViewTransport,
  handleTerminalPaste,
  handleTerminalShortcut,
  openMountedTerminal,
} from "./xterm-mount.ts"
import { WebglController } from "./xterm-webgl.ts"

export { keyProtocolSwitch }

export class XtermView implements TerminalView {
  private terminal: Terminal | undefined
  private transport: AgentTransport | undefined
  private webgl: WebglController
  private display: DisplayQueue
  private layout: XtermLayout
  private echoes = new ImageEchoTracker()
  private mouse: MouseState = {
    agentMouseMode: 0,
    localMouseWrite: false,
    rebuildMouseEncodings: undefined,
    keyProtocol: null,
  }
  private visible = true
  private reconnect: (() => void) | undefined
  private visibilityChanged = () => this.syncVisibility()
  private root: HTMLElement | undefined
  private listeners = new Set<(text: string) => void>()
  private disposed = false
  private mountStarted = false
  private canType = false
  private canResize = false
  private replayComplete = false
  private theme: TerminalTheme | undefined
  private unsubscribeAppearance: (() => void) | undefined
  private jump: HTMLButtonElement | undefined
  private copyFeedback: HTMLElement | undefined
  private images: TerminalImages | undefined

  constructor(private options: TerminalOptions) {
    this.theme = options.theme
    this.webgl = new WebglController(options.onRenderer)
    this.display = new DisplayQueue({
      getTerminal: () => this.terminal,
      isDisposed: () => this.disposed,
      isDrawing: () => this.drawing(),
      canType: () => this.canType,
      onMouseTracking: () =>
        syncMouseTracking(this.terminal, this.canType, this.mouse, this.disposed),
      onFailed: (code, message) => this.failed(code, message),
    })
    this.layout = new XtermLayout({
      getTerminal: () => this.terminal,
      getRoot: () => this.root,
      isDisposed: () => this.disposed,
      canResize: () => this.canResize,
      isPhone: () => Boolean(this.options.phone),
      enqueue: (op) => this.display.enqueue(op),
      sendResize: (cols, rows) => this.transport?.resize(cols, rows),
    })
  }

  private watchPointer = (event: PointerEvent) => {
    if (!this.canType && !(event.target as Element).closest("button"))
      this.root?.focus({ preventScroll: true })
  }

  private showCopyFailed = () => {
    if (this.disposed) return
    this.copyFeedback?.remove()
    this.copyFeedback = createCopyFeedbackElement(this.root)
  }

  private shortcut = (event: KeyboardEvent) => {
    handleTerminalShortcut(event, {
      canType: this.canType,
      keyProtocol: this.mouse.keyProtocol,
      terminal: this.terminal,
      sendInput: (text) => this.sendInput(text),
      onCopySuccess: () => this.copyFeedback?.remove(),
      onCopyFailed: this.showCopyFailed,
    })
  }

  private paste = (event: ClipboardEvent) => {
    handleTerminalPaste(event, {
      canType: this.canType,
      terminal: this.terminal,
      sendInput: (text) => this.transport?.sendInput(text) ?? false,
    })
  }

  private writeOutput(text: string) {
    if (!text || this.disposed) return
    this.echoes.onOutput(text)
    if (this.drawing()) this.display.draw(text)
    else this.display.bufferHiddenOutput(text)
  }

  private failed(code: string, message: string) {
    if (this.disposed) return
    this.options.onEvent?.({ type: "error", code, message })
    this.options.onPresentation?.("failed")
    this.dispose()
  }

  private applyAppearance() {
    if (!this.terminal) return
    applyTerminalAppearance(this.terminal, readTerminalAppearance(), (fontFamily) => {
      if (!this.terminal || this.disposed) return
      this.terminal.options.fontFamily = fontFamily
      this.display.enqueue(() => this.fit())
    })
  }

  private fit() {
    this.layout.fit()
  }

  private hostResize(cols: number, rows: number) {
    this.display.hostResize(cols, rows)
  }

  get output(): Promise<void> {
    return this.display.output
  }

  private handleViewer(root: HTMLElement, state: ViewerState) {
    const wasResize = this.canResize
    this.canType = state.canType
    this.canResize = state.canResize
    this.layout.syncOverflow()
    root.inert = false
    applyTerminalStdinState(this.terminal, this.canType)
    this.options.onViewer?.(state)
    this.display.enqueue(() =>
      syncMouseTracking(this.terminal, this.canType, this.mouse, this.disposed),
    )
    if (!wasResize && this.canResize && this.replayComplete) this.display.enqueue(() => this.fit())
  }

  private onTransportConnect() {
    this.replayComplete = true
    if (!this.drawing()) {
      this.display.markDirty()
      return
    }
    this.display.enqueue(async () => {
      await repairRebuildMouseEncoding(this.terminal, this.mouse)
      this.fit()
      this.terminal?.refresh(0, this.terminal.rows - 1)
      this.options.onPresentation?.("ready")
    })
  }

  private onTransportDisconnect(root: HTMLElement) {
    this.canType = false
    this.replayComplete = false
    root.inert = false
    applyTerminalStdinState(this.terminal, false)
  }

  private bindEvents(root: HTMLElement, terminal: Terminal) {
    terminal.onData((text) => this.sendInput(text))
    terminal.onResize(({ cols, rows }) => {
      if (!this.display.resizingFromHost) this.layout.tellHostSize(cols, rows)
    })
    if (this.options.attachFiles)
      this.images = new TerminalImages(
        root,
        this.options.attachFiles,
        () => !this.disposed && this.canType,
        (text) => this.transport?.sendInput(text) ?? false,
        () => this.focus(),
      )
    root.addEventListener("paste", this.paste, true)
    root.addEventListener("keydown", this.shortcut, true)
    root.addEventListener("pointerdown", this.watchPointer)
    document.addEventListener("visibilitychange", this.visibilityChanged)
    this.layout.observe(root, terminal)
  }

  async mount(root: HTMLElement) {
    if (this.disposed) return
    if (this.mountStarted) throw new Error("terminal already mounted")
    this.mountStarted = true
    this.root = root
    // Font downloads must not hold the session's screen behind an empty viewport.
    const fonts = loadBrowserTerminalFonts()
    const mounted = openMountedTerminal({
      root,
      theme: this.theme,
      mouse: this.mouse,
      getTerminal: () => this.terminal,
      onCreated: (terminal) => {
        this.terminal = terminal
      },
      syncOverflow: () => this.layout.syncOverflow(),
      applyAppearance: () => this.applyAppearance(),
      syncWebgl: () => this.webgl.sync(this.terminal, () => this.drawing(), this.disposed),
    })
    this.jump = mounted.jump
    this.watchFontsAndAppearance(fonts)
    this.transport = createViewTransport({
      terminalOptions: this.options,
      mouse: this.mouse,
      listeners: this.listeners,
      enqueue: (op) => this.display.enqueue(op),
      hostResize: (cols, rows) => this.hostResize(cols, rows),
      onViewer: (state) => this.handleViewer(root, state),
    })
    this.bindEvents(root, mounted.terminal)
    this.options.onPresentation?.("connecting")
    this.reconnect = () =>
      this.transport?.connect({
        url: this.options.url,
        callbacks: {
          onData: (text) => this.writeOutput(text),
          onConnect: () => this.onTransportConnect(),
          onDisconnect: () => this.onTransportDisconnect(root),
        },
      })
    this.reconnect()
  }

  private watchFontsAndAppearance(fonts: Promise<unknown>) {
    void fonts
      .then(() => {
        if (!this.terminal || this.disposed) return
        this.terminal.options.fontFamily = fontFamilyOf(readTerminalAppearance())
        this.display.enqueue(() => {
          this.fit()
          this.terminal?.refresh(0, this.terminal.rows - 1)
        })
      })
      .catch(() => {
        // The terminal's system monospace fallback remains readable when a font is unavailable.
      })
    this.unsubscribeAppearance = subscribeTerminalAppearance(() => {
      if (!this.terminal || !this.root) return
      this.applyAppearance()
      this.setTheme(this.theme ?? terminalTheme(this.root))
      this.webgl.sync(this.terminal, () => this.drawing(), this.disposed)
      this.display.enqueue(() => this.fit())
    })
  }

  write(text: string) {
    this.writeOutput(text)
  }

  onInput(listener: (text: string) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  fresh(sequence: number) {
    return (
      this.transport?.fresh(sequence) ??
      Promise.reject(new Error("Reconnect this session before starting fresh."))
    )
  }

  sendInput(text: string) {
    const sent = this.transport?.sendInput(text) ?? false
    if (sent) this.echoes.onSubmitted(text)
    return sent
  }

  pasteImages(paths: readonly string[]): Promise<boolean> {
    return this.echoes.pasteImages(
      paths,
      () => this.disposed,
      (text) => this.sendInput(text),
    )
  }

  resize(cols: number, rows: number) {
    if (this.canResize && !this.options.phone)
      this.display.enqueue(() => this.terminal?.resize(cols, rows))
  }

  focus() {
    if (this.canType) this.terminal?.focus()
  }

  setVisible(visible: boolean) {
    if (this.visible === visible) return
    this.visible = visible
    this.syncVisibility()
  }

  private drawing() {
    return (
      this.visible && (typeof document === "undefined" || document.visibilityState !== "hidden")
    )
  }

  private syncVisibility() {
    if (this.disposed) return
    this.webgl.sync(this.terminal, () => this.drawing(), this.disposed)
    if (this.terminal)
      this.terminal.options.cursorBlink = this.drawing() && readTerminalAppearance().cursorBlink
    if (!this.drawing()) return
    const kept = this.display.takeHiddenOutput()
    if (this.display.displayDirty && this.reconnect) {
      this.display.displayDirty = false
      this.replayComplete = false
      this.options.onPresentation?.("connecting")
      this.reconnect()
    } else if (kept) this.display.draw(kept)
    this.display.enqueue(() => {
      this.fit()
      this.terminal?.refresh(0, this.terminal.rows - 1)
    })
  }

  retryRenderer() {
    this.webgl.retry(this.terminal, () => this.drawing(), this.disposed)
  }

  setPhone(phone: boolean) {
    this.options.phone = phone
    this.transport?.setPhone(phone)
    this.layout.syncOverflow()
    if (!phone) this.display.enqueue(() => this.fit())
  }

  dispose() {
    this.disposed = true
    this.echoes.dispose()
    this.display.dispose()
    document.removeEventListener("visibilitychange", this.visibilityChanged)
    this.reconnect = undefined
    this.root?.removeEventListener("paste", this.paste, true)
    this.root?.removeEventListener("keydown", this.shortcut, true)
    this.root?.removeEventListener("pointerdown", this.watchPointer)
    this.copyFeedback?.remove()
    this.images?.dispose()
    this.images = undefined
    this.unsubscribeAppearance?.()
    this.jump?.remove()
    this.layout.dispose()
    this.transport?.destroy()
    this.webgl.release()
    this.terminal?.dispose()
    this.transport = undefined
    this.terminal = undefined
    this.listeners.clear()
    if (this.root) this.root.inert = false
    this.root = undefined
    this.jump = undefined
    this.copyFeedback = undefined
  }

  setTheme(theme: TerminalTheme) {
    this.theme = theme
    const shown = appearanceTheme(theme)
    if (this.root) {
      this.root.style.backgroundColor = shown.background
      this.root.style.color = shown.foreground
    }
    if (this.terminal) this.terminal.options.theme = xtermThemeConfig(shown)
  }

  diagnostics() {
    return readXtermDiagnostics(this.terminal, {
      backend: this.webgl.backend,
      rendererState: this.webgl.rendererState,
      connected: this.transport?.isConnected() ?? false,
      disposed: this.disposed,
      pendingWrites: this.display.pendingWrites,
      pendingOutputBytes: this.display.pendingOutputBytes,
    })
  }
}

export function createXtermView(options: TerminalOptions): TerminalView {
  return new XtermView(options)
}
