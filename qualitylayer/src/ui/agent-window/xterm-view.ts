import { Unicode11Addon } from "@xterm/addon-unicode11"
import { WebglAddon } from "@xterm/addon-webgl"
import { Terminal } from "@xterm/xterm"
import styles from "@xterm/xterm/css/xterm.css" with { type: "text" }
import {
  appearanceTheme,
  DEFAULT_TERMINAL_APPEARANCE,
  FONT_SIZE_RANGE,
  fontFamilyOf,
  readTerminalAppearance,
  subscribeTerminalAppearance,
  type TerminalAppearance,
  writeTerminalAppearance,
} from "./appearance.ts"
import { loadBrowserTerminalFonts } from "./fonts.ts"
import { imageEchoed, imagePaste, TerminalImages } from "./terminal-images.ts"
import { AgentTransport } from "./transport.ts"
import {
  type RendererState,
  type TerminalOptions,
  type TerminalTheme,
  type TerminalView,
  terminalTheme,
} from "./view.ts"

/** Suppress browser-side reports: the host's terminal already answered every query to the PTY. */
function ownNoQueries(terminal: Terminal) {
  for (const prefix of [undefined, "?", ">", "="]) {
    terminal.parser.registerCsiHandler({ prefix, final: "c" }, () => true)
    terminal.parser.registerCsiHandler({ prefix, final: "n" }, () => true)
  }
  terminal.parser.registerCsiHandler({ final: "t" }, () => true)
  terminal.parser.registerCsiHandler({ prefix: ">", final: "q" }, () => true)
  terminal.parser.registerCsiHandler({ prefix: "?", final: "u" }, () => true)
  terminal.parser.registerCsiHandler({ intermediates: "$", final: "p" }, () => true)
  terminal.parser.registerCsiHandler({ prefix: "?", intermediates: "$", final: "p" }, () => true)
  terminal.parser.registerDcsHandler({ intermediates: "$", final: "q" }, () => true)
  terminal.parser.registerDcsHandler({ intermediates: "+", final: "q" }, () => true)
  for (const id of [4, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
    terminal.parser.registerOscHandler(id, (data) => data === "?" || data.split(";").includes("?"))
}

/** Characters of output a hidden window keeps to draw when it shows again (about 2 MB). */
const HIDDEN_OUTPUT_LIMIT = 1_000_000
/**
 * How many hidden windows keep their WebGL context, the most recently hidden first. One shown again
 * draws at once from the canvas it kept; a new context starts empty and shows the pane blank for a
 * frame or two. WebKit allows about 16 live contexts per page, so the others hand theirs back.
 */
const KEPT_HIDDEN_CONTEXTS = 2
const keptHidden: XtermView[] = []
type DisplayOperation = { text: string } | { cols: number; rows: number }
type DisplayBatch = { operations: DisplayOperation[]; bytes: number }

export class XtermView implements TerminalView {
  private terminal: Terminal | undefined
  private transport: AgentTransport | undefined
  private addon: WebglAddon | undefined
  /** The canvas that holds the addon's WebGL context, to hand the context back when the addon goes. */
  private addonCanvas: HTMLCanvasElement | undefined
  private renderer: RendererState = "basic"
  private visible = true
  private displayDirty = false
  /** Output that arrived while the window was hidden, drawn when it shows again. */
  private hiddenOutput = ""
  private reconnect: (() => void) | undefined
  private visibilityChanged = () => this.syncVisibility()
  private root: HTMLElement | undefined
  private listeners = new Set<(text: string) => void>()
  private observer: ResizeObserver | undefined
  private fitTimer: ReturnType<typeof setTimeout> | undefined
  /** The cell size, in CSS pixels, the last fit counted with. */
  private fittedCell: { width: number; height: number } | undefined
  private output = Promise.resolve()
  private pendingWrites = 0
  private pendingOutputBytes = 0
  private finishWrite: (() => void) | undefined
  private displayBatch: DisplayBatch | undefined
  private resizingFromHost = false
  /** The size the host has yet to hear; it is sent once xterm has drawn the resized screen. */
  private hostSize: { cols: number; rows: number } | undefined
  private fitAfterDraw = false
  /** Work waiting for xterm's next drawn frame, stopped when the window goes. */
  private drawWaits = new Set<() => void>()
  private disposed = false
  private mountStarted = false
  private canType = false
  private canResize = false
  private agentMouseMode = 0
  /**
   * The extended key protocol the program in the terminal turned on, read from its output: kitty
   * (`CSI > flags u`) or xterm's modifyOtherKeys (`CSI > 4 ; 2 m`). xterm.js encodes neither, so a
   * modified Enter (Claude Code's Ctrl+Enter "send now") would reach the program as a plain Enter.
   */
  private keyProtocol: "kitty" | "modify" | null = null
  private localMouseWrite = false
  private wheelRemainder = 0
  private rebuildMouseEncodings: Set<number> | undefined
  private replayComplete = false
  private theme: TerminalTheme | undefined
  private unsubscribeAppearance: (() => void) | undefined
  private jump: HTMLButtonElement | undefined
  private copyFeedback: HTMLElement | undefined
  private images: TerminalImages | undefined
  /** Image pastes waiting for the agent to draw them; each gets every output chunk, drawn or not. */
  private echoes = new Set<{ output(text: string): void; done(ok: boolean): void }>()
  /**
   * Image marks the agent drew for earlier pastes in this window: a later redraw of one (a queued
   * message, history) never stands for a new image. Paths drawn since the last Enter are skipped
   * when a message is retried.
   */
  private drawn = { marks: new Set<string>(), paths: new Set<string>() }
  private submitted(text: string) {
    if (text.includes("\r")) this.drawn = { marks: this.drawn.marks, paths: new Set() }
  }
  private watchPointer = (event: PointerEvent) => {
    if (!this.canType && !(event.target as Element).closest("button"))
      this.root?.focus({ preventScroll: true })
  }
  private shortcut = (event: KeyboardEvent) => {
    // Ctrl+Enter in the program's own key protocol; with none on, xterm's plain Enter stands.
    if (this.canType && this.keyProtocol !== null && isCtrlEnter(event)) {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.sendInput(this.keyProtocol === "kitty" ? "\x1b[13;5u" : "\x1b[27;5;13~")
      return
    }
    if ((event.metaKey || (event.ctrlKey && event.shiftKey)) && event.key.toLowerCase() === "c") {
      const selection = this.terminal?.getSelection()
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!selection) return
      const failed = () => {
        if (this.disposed) return
        this.copyFeedback?.remove()
        this.copyFeedback = document.createElement("p")
        this.copyFeedback.className = "q-run-copy-feedback"
        this.copyFeedback.setAttribute("role", "status")
        this.copyFeedback.textContent =
          "Could not copy. Select the text and use Copy from the menu."
        this.root?.append(this.copyFeedback)
      }
      try {
        if (!navigator.clipboard) throw new Error("Clipboard unavailable")
        void navigator.clipboard
          .writeText(selection)
          .then(() => this.copyFeedback?.remove(), failed)
      } catch {
        failed()
      }
      return
    }
    if (
      !(event.metaKey || event.ctrlKey) ||
      event.altKey ||
      !["+", "=", "-", "0"].includes(event.key)
    )
      return
    event.preventDefault()
    event.stopImmediatePropagation()
    const value = readTerminalAppearance()
    writeTerminalAppearance(
      event.key === "0"
        ? { ...value, fontSize: DEFAULT_TERMINAL_APPEARANCE.fontSize }
        : {
            ...value,
            fontSize: Math.max(
              FONT_SIZE_RANGE[0],
              Math.min(FONT_SIZE_RANGE[1], value.fontSize + (event.key === "-" ? -1 : 1)),
            ),
          },
    )
  }
  private paste = (event: ClipboardEvent) => {
    if (
      !this.canType ||
      !this.terminal?.modes.bracketedPasteMode ||
      !event.clipboardData?.types.includes("text/plain")
    )
      return
    const text = event.clipboardData.getData("text/plain")
    if (!this.transport?.sendInput(`\x1b[200~${text}\x1b[201~`)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  constructor(private options: TerminalOptions) {
    this.theme = options.theme
  }
  private enqueue(operation: () => void | Promise<void>) {
    if (this.disposed) return
    if (this.pendingWrites >= 128) return this.overloaded()
    // Resizes, viewer changes and appearance updates keep their order between output batches.
    this.displayBatch = undefined
    this.pendingWrites++
    this.output = this.output
      .then(async () => {
        if (!this.disposed) await operation()
      })
      .finally(() => {
        this.pendingWrites--
      })
      .catch(() =>
        this.failed(
          "viewer_render_failed",
          "The terminal renderer stopped. Reconnect to restore its screen.",
        ),
      )
  }
  private writeOutput(text: string) {
    if (!text || this.disposed) return
    for (const echo of this.echoes) echo.output(text)
    if (!this.drawing()) {
      // A hidden window parses nothing. It keeps what arrives, up to a limit, and draws it when it
      // shows again: a switch to Conversation or Files and back keeps the screen, its reading
      // position and its renderer, with no reconnect and no loading screen. Past the limit, or after
      // a change only a replay restores, it asks the host for a fresh screen instead.
      if (!this.displayDirty && this.hiddenOutput.length + text.length <= HIDDEN_OUTPUT_LIMIT)
        this.hiddenOutput += text
      else this.markDirty()
      return
    }
    this.draw(text)
  }
  /** What a hidden window cannot keep: the host sends the whole screen again when it shows. */
  private markDirty() {
    this.displayDirty = true
    this.hiddenOutput = ""
  }
  private draw(text: string) {
    this.queueDisplay({ text })
  }
  private queueDisplay(operation: DisplayOperation) {
    if (this.disposed) return
    // Resize entries retain two numbers and an object/array slot even without output text.
    const bytes = "text" in operation ? operation.text.length * 2 : 64
    if (this.pendingOutputBytes + bytes > 8 * 1024 * 1024) return this.overloaded()
    this.pendingOutputBytes += bytes
    if (this.displayBatch && this.displayBatch.bytes + bytes <= 512_000) {
      const last = this.displayBatch.operations.at(-1)
      if (last && "text" in last && "text" in operation) last.text += operation.text
      else this.displayBatch.operations.push(operation)
      this.displayBatch.bytes += bytes
      return
    }
    const batch: DisplayBatch = { operations: [operation], bytes }
    this.enqueue(() => this.flushDisplay(batch))
    if (!this.disposed) this.displayBatch = batch
  }
  private async flushDisplay(batch: DisplayBatch) {
    if (this.displayBatch === batch) this.displayBatch = undefined
    try {
      for (const operation of batch.operations) {
        if (!this.terminal || this.disposed) break
        if ("text" in operation) {
          await new Promise<void>((resolve) => {
            this.finishWrite = () => {
              this.finishWrite = undefined
              resolve()
            }
            this.terminal?.write(operation.text, this.finishWrite)
          })
        } else {
          this.resizingFromHost = true
          try {
            this.terminal.resize(operation.cols, operation.rows)
          } finally {
            this.resizingFromHost = false
          }
        }
      }
      if (!this.canType) await this.mouseTracking()
    } finally {
      this.pendingOutputBytes = Math.max(0, this.pendingOutputBytes - batch.bytes)
    }
  }
  private overloaded() {
    this.failed(
      "viewer_overloaded",
      "The terminal is receiving output faster than it can draw. Reconnect to restore its screen.",
    )
  }
  private failed(code: string, message: string) {
    if (this.disposed) return
    this.options.onEvent?.({
      type: "error",
      code,
      message,
    })
    this.options.onPresentation?.("failed")
    this.dispose()
  }
  private async mouseTracking() {
    if (!this.terminal || this.disposed) return
    if (!this.canType && this.terminal.modes.mouseTrackingMode === "none") return
    const reset = "\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l"
    const restore = this.canType && this.agentMouseMode ? `\x1b[?${this.agentMouseMode}h` : ""
    this.localMouseWrite = true
    try {
      await new Promise<void>((resolve) => this.terminal?.write(reset + restore, resolve))
    } finally {
      this.localMouseWrite = false
    }
  }
  private setRenderer(state: RendererState) {
    if (this.renderer === state) return
    this.renderer = state
    this.options.onRenderer?.(state)
  }
  /** Draw with WebGL when the person wants it; otherwise, and when WebGL fails, xterm's own renderer. */
  private webgl() {
    if (!this.terminal || this.disposed) return
    const wanted = readTerminalAppearance().webgl
    if (!wanted) {
      this.releaseWebgl()
      this.setRenderer("basic")
      return
    }
    const kept = keptHidden.indexOf(this)
    if (kept !== -1) keptHidden.splice(kept, 1)
    if (!this.drawing()) {
      // A hidden window keeps its context only while it is among the last few hidden: WebKit allows
      // only a few per page, and past them it takes the oldest, which can be the one on screen.
      if (this.addon) keptHidden.unshift(this)
      for (const view of keptHidden.splice(KEPT_HIDDEN_CONTEXTS)) view.releaseWebgl()
      return
    }
    if (this.addon || this.renderer === "failed") return
    try {
      const screen = this.terminal.element?.querySelector(".xterm-screen")
      const before = new Set(screen?.querySelectorAll("canvas"))
      const addon = new WebglAddon(true)
      this.terminal.loadAddon(addon)
      addon.onContextLoss(() => {
        const hidden = this.addon === addon && !this.drawing()
        if (this.addon === addon) this.releaseWebgl()
        else addon.dispose()
        // A hidden window whose kept context the browser took draws with a new one when it shows.
        if (hidden) return
        // The model, scrollback and input stay: only the drawing changes.
        this.setRenderer("failed")
      })
      this.addon = addon
      this.addonCanvas = [...(screen?.querySelectorAll("canvas") ?? [])].find(
        (canvas) => !before.has(canvas) && canvas.getContext("webgl2") !== null,
      )
      this.setRenderer("webgl")
    } catch {
      this.releaseWebgl()
      this.setRenderer("failed")
    }
  }
  /**
   * Disposing the addon removes its canvas but leaves the WebGL context alive until garbage
   * collection. WebKit counts those against its 16 live contexts and then takes the oldest one, which
   * can be a terminal on screen: it goes blank, then falls back to drawing without WebGL. Losing the
   * context on purpose hands it back without waiting for the collector.
   */
  private releaseWebgl() {
    const kept = keptHidden.indexOf(this)
    if (kept !== -1) keptHidden.splice(kept, 1)
    const addon = this.addon
    const canvas = this.addonCanvas
    this.addon = undefined
    this.addonCanvas = undefined
    try {
      addon?.dispose()
    } finally {
      canvas?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext()
    }
  }
  private applyAppearance(appearance: TerminalAppearance) {
    if (!this.terminal) return
    const fontFamily = fontFamilyOf(appearance)
    if (appearance.fontFamily && document.fonts?.load)
      // An installed font is measured once it is ready; until then the bundled stack draws.
      void document.fonts
        .load(`${appearance.fontSize}px "${appearance.fontFamily}"`)
        .then(() => {
          if (!this.terminal || this.disposed) return
          this.terminal.options.fontFamily = fontFamily
          this.enqueue(() => this.fit())
        })
        .catch(() => {})
    this.terminal.options.fontSize = appearance.fontSize
    this.terminal.options.lineHeight = appearance.lineHeight
    this.terminal.options.fontFamily = fontFamily
    this.terminal.options.fontWeight = appearance.fontWeight
    this.terminal.options.letterSpacing = appearance.letterSpacing
    this.terminal.options.scrollback = appearance.scrollback
    this.terminal.options.cursorBlink = appearance.cursorBlink
  }
  private hostResize(cols: number, rows: number) {
    if (!this.drawing()) {
      // A status frame repeats the size; only a new one needs the whole screen again.
      if (cols !== this.terminal?.cols || rows !== this.terminal?.rows) this.markDirty()
      return
    }
    // A reconnect delivers its whole resize/write journal at once. Keep their order in the same
    // bounded batches instead of counting each historical resize as a live backlog operation.
    this.queueDisplay({ cols, rows })
  }
  /**
   * Runs `then` once xterm has drawn its next frame. A resize clears the WebGL canvas, and while an
   * agent's synchronized output (DEC 2026) is open xterm draws nothing until it closes; whatever
   * would resize or repaint waits for a drawn frame, so the canvas is never left empty behind it.
   * A paused renderer (a hidden pane) draws nothing; the timer runs `then` anyway.
   */
  private afterDraw(then: () => void) {
    if (!this.terminal) return
    const drawn = this.terminal.onRender(() => run())
    const timer = setTimeout(() => run(), 100)
    const stop = () => {
      drawn.dispose()
      clearTimeout(timer)
      this.drawWaits.delete(stop)
    }
    const run = () => {
      stop()
      if (!this.disposed) then()
    }
    this.drawWaits.add(stop)
  }
  /**
   * The agent repaints its whole screen after a resize, inside synchronized output that holds
   * xterm's drawing until the repaint ends. The host hears of the new size once xterm has drawn the
   * resized screen, so the cleared canvas is drawn again before the agent's repaint begins.
   */
  private tellHostSize(cols: number, rows: number) {
    const waiting = this.hostSize !== undefined
    this.hostSize = { cols, rows }
    if (waiting) return
    this.afterDraw(() => {
      const size = this.hostSize
      this.hostSize = undefined
      if (size) this.transport?.resize(size.cols, size.rows)
    })
  }
  /**
   * A window that fits the terminal to its pane never scrolls the pane: a scrollbar that comes and
   * goes there changes the space the fit measures, each fit resizes the agent and its repaint, and
   * the pane flashed without end (issue #242, Codex's trust screen with classic scrollbars). A
   * window that shows another window's size, watching or on a phone, scrolls to reach all of it.
   */
  private syncOverflow() {
    if (this.root)
      this.root.style.overflow = this.canResize && !this.options.phone ? "clip" : "auto"
  }
  private fit() {
    if (!this.canResize || this.options.phone || !this.terminal || !this.root) return
    if (this.terminal.modes?.synchronizedOutputMode) {
      // The agent is mid-repaint: a resize now would leave the canvas empty until it ends.
      if (!this.fitAfterDraw) {
        this.fitAfterDraw = true
        this.afterDraw(() => {
          this.fitAfterDraw = false
          this.enqueue(() => this.fit())
        })
      }
      return
    }
    const screen = this.terminal.element?.querySelector(".xterm-screen")?.getBoundingClientRect()
    if (!screen?.width || !screen.height) return
    // The root's padding is not drawing space: a column counted there runs past the edge.
    const style = getComputedStyle(this.root)
    const pad = (value: string) => parseFloat(value) || 0
    const width = this.root.clientWidth - pad(style.paddingLeft) - pad(style.paddingRight)
    const height = this.root.clientHeight - pad(style.paddingTop) - pad(style.paddingBottom)
    this.fittedCell = {
      width: screen.width / this.terminal.cols,
      height: screen.height / this.terminal.rows,
    }
    const cols = Math.min(500, Math.floor(width / this.fittedCell.width))
    const rows = Math.min(300, Math.floor(height / this.fittedCell.height))
    if (cols <= 2 || rows <= 1) return
    this.terminal.resize(cols, rows)
  }
  /** Whether xterm draws other cells than the last fit counted with. */
  private cellChanged() {
    const screen = this.terminal?.element?.querySelector(".xterm-screen")?.getBoundingClientRect()
    if (!this.terminal || !this.fittedCell || !screen?.width || !screen.height) return false
    return (
      Math.abs(screen.width / this.terminal.cols - this.fittedCell.width) > 0.01 ||
      Math.abs(screen.height / this.terminal.rows - this.fittedCell.height) > 0.01
    )
  }
  async mount(root: HTMLElement) {
    if (this.disposed) return
    if (this.mountStarted) throw new Error("terminal already mounted")
    this.mountStarted = true
    this.root = root
    // Font downloads must not hold the session's screen behind an empty viewport.
    const fonts = loadBrowserTerminalFonts()
    if (!document.querySelector("style[data-ql-terminal]")) {
      const style = document.createElement("style")
      style.dataset.qlTerminal = "xterm"
      style.textContent = styles as unknown as string
      document.head.append(style)
    }
    root.inert = false
    if (!root.hasAttribute("aria-label")) {
      root.setAttribute("aria-label", "Agent terminal output")
      root.setAttribute("role", "region")
      root.tabIndex = 0
    }
    this.syncOverflow()
    const appearance = readTerminalAppearance()
    const theme = appearanceTheme(this.theme ?? terminalTheme(root), appearance)
    this.terminal = new Terminal({
      cols: 80,
      rows: 24,
      fontFamily: fontFamilyOf(appearance),
      fontSize: appearance.fontSize,
      lineHeight: appearance.lineHeight,
      fontWeight: appearance.fontWeight,
      letterSpacing: appearance.letterSpacing,
      // xterm's SGR dim contrast check uses half this floor: request 4.5 for dim cells too.
      minimumContrastRatio: 9,
      screenReaderMode: true,
      macOptionClickForcesSelection: true,
      scrollback: appearance.scrollback,
      scrollSensitivity: 2,
      fastScrollSensitivity: 5,
      smoothScrollDuration: 0,
      cursorBlink: appearance.cursorBlink,
      cursorStyle: "block",
      cursorInactiveStyle: "block",
      disableStdin: true,
      allowProposedApi: true,
      theme: {
        foreground: theme.foreground,
        background: theme.background,
        cursor: theme.cursor,
        selectionForeground: theme.background,
        selectionBackground: theme.foreground,
        selectionInactiveBackground: theme.foreground,
      },
    })
    // The native host counts common emoji as two cells when answering cursor queries.
    this.terminal.loadAddon(new Unicode11Addon())
    this.terminal.unicode.activeVersion = "11"
    ownNoQueries(this.terminal)
    for (const prefix of ["<", ">", "="])
      this.terminal.parser.registerCsiHandler({ prefix, final: "u" }, (params) => {
        this.keyProtocol = keyProtocolSwitch(prefix, params, "u", this.keyProtocol)
        return false
      })
    this.terminal.parser.registerCsiHandler({ prefix: ">", final: "m" }, (params) => {
      this.keyProtocol = keyProtocolSwitch(">", params, "m", this.keyProtocol)
      return false
    })
    // Mouse tracking belongs to the controlling viewer. Watching keeps ordinary text selection.
    for (const final of ["h", "l"])
      this.terminal.parser.registerCsiHandler({ prefix: "?", final }, (params) => {
        if (!this.localMouseWrite)
          for (const mode of params)
            if (typeof mode === "number") {
              if ([9, 1000, 1002, 1003].includes(mode))
                this.agentMouseMode = final === "h" ? mode : 0
              if (this.rebuildMouseEncodings && [1006, 1016].includes(mode)) {
                if (final === "h") this.rebuildMouseEncodings.add(mode)
                else this.rebuildMouseEncodings.delete(mode)
              }
            }
        return false
      })
    this.terminal.open(root)
    // Agents can enable mouse reports while using normal terminal scrollback. Wheel still reads
    // that history; full-screen TUIs in the alternate buffer retain their own mouse handling.
    this.terminal.attachCustomWheelEventHandler((event) => {
      const terminal = this.terminal
      if (
        !terminal ||
        terminal.buffer.active.type !== "normal" ||
        terminal.buffer.active.baseY === 0 ||
        terminal.modes.mouseTrackingMode === "none" ||
        event.deltaY === 0
      )
        return true
      const height = terminal.element
        ?.querySelector(".xterm-screen")
        ?.getBoundingClientRect().height
      if (!height) return true
      const rows =
        event.deltaMode === 1
          ? event.deltaY
          : event.deltaMode === 2
            ? event.deltaY * terminal.rows
            : event.deltaY / (height / terminal.rows)
      const sensitivity =
        (terminal.options.scrollSensitivity ?? 1) *
        (event.altKey ? (terminal.options.fastScrollSensitivity ?? 5) : 1)
      if (Math.sign(rows) !== Math.sign(this.wheelRemainder)) this.wheelRemainder = 0
      this.wheelRemainder += rows * sensitivity
      const lines = Math.trunc(this.wheelRemainder)
      this.wheelRemainder -= lines
      if (lines) terminal.scrollLines(lines)
      event.preventDefault()
      return false
    })
    void fonts
      .then(() => {
        if (!this.terminal || this.disposed) return
        this.terminal.options.fontFamily = fontFamilyOf(readTerminalAppearance())
        this.enqueue(() => {
          this.fit()
          this.terminal?.refresh(0, this.terminal.rows - 1)
        })
      })
      .catch(() => {
        // The terminal's system monospace fallback remains readable when a font is unavailable.
      })
    if (this.terminal.textarea) this.terminal.textarea.readOnly = true
    root.style.backgroundColor = theme.background
    root.style.color = theme.foreground
    this.jump = document.createElement("button")
    this.jump.type = "button"
    this.jump.className = "q-btn sm q-run-jump"
    this.jump.textContent = "Jump to latest"
    this.jump.hidden = true
    this.jump.addEventListener("click", () => this.terminal?.scrollToBottom())
    root.append(this.jump)
    const updateJump = () => {
      if (this.jump && this.terminal)
        this.jump.hidden =
          this.terminal.buffer.active.viewportY >= this.terminal.buffer.active.baseY
    }
    this.terminal.onScroll(updateJump)
    this.terminal.onWriteParsed(updateJump)
    this.unsubscribeAppearance = subscribeTerminalAppearance(() => {
      if (!this.terminal || !this.root) return
      this.applyAppearance(readTerminalAppearance())
      this.setTheme(this.theme ?? terminalTheme(this.root))
      this.webgl()
      this.enqueue(() => this.fit())
    })
    if (appearance.fontFamily) this.applyAppearance(appearance)
    this.webgl()
    this.transport = new AgentTransport({
      ...this.options,
      onEvent: (frame) => {
        if (frame.type === "replay-begin")
          this.enqueue(() => {
            this.rebuildMouseEncodings = frame.kind === "rebuild" ? new Set() : undefined
          })
        this.options.onEvent?.(frame)
      },
      resizeDisplay: (cols, rows) => this.hostResize(cols, rows),
      onInput: (text) => {
        for (const listener of this.listeners) listener(text)
      },
      onViewer: (state) => {
        const wasResize = this.canResize
        this.canType = state.canType
        this.canResize = state.canResize
        this.syncOverflow()
        root.inert = false
        if (this.terminal) {
          this.terminal.options.disableStdin = !this.canType
          if (this.terminal.textarea) this.terminal.textarea.readOnly = !this.canType
        }
        this.options.onViewer?.(state)
        this.enqueue(() => this.mouseTracking())
        if (!wasResize && this.canResize && this.replayComplete) this.enqueue(() => this.fit())
      },
    })
    this.terminal.onData((text) => this.sendInput(text))
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
    this.terminal.onResize(({ cols, rows }) => {
      if (!this.resizingFromHost) this.tellHostSize(cols, rows)
    })
    // Fit once, in a task of its own: fitting inside the observer's own delivery resizes what it
    // observes and the browser reports a ResizeObserver loop. Not in an animation frame either: a
    // resize clears the WebGL canvas and xterm draws it again on its next frame, so a resize made
    // inside a frame paints that frame empty, a flash each time the pane's height changes.
    this.observer = new ResizeObserver((entries) => {
      // The screen changes size with every resize; only other cells need another fit.
      if (entries.every((entry) => entry.target !== root) && !this.cellChanged()) return
      if (this.fitTimer !== undefined) return
      this.fitTimer = setTimeout(() => {
        this.fitTimer = undefined
        this.enqueue(() => this.fit())
      })
    })
    this.observer.observe(root)
    // The screen too: a fit counts with the cells xterm last drew, the fallback font's until the
    // bundled one is measured, which the resize itself can do. Fitted with the smaller cells, the
    // screen then ran past the pane's bottom (issue #242).
    const screen = this.terminal.element?.querySelector(".xterm-screen")
    if (screen) this.observer.observe(screen)
    this.options.onPresentation?.("connecting")
    this.reconnect = () =>
      this.transport?.connect({
        url: this.options.url,
        callbacks: {
          onData: (text) => this.writeOutput(text),
          onConnect: () => {
            this.replayComplete = true
            if (!this.drawing()) {
              this.markDirty()
              return
            }
            this.enqueue(async () => {
              // Hosts started before this repair send inactive mouse resets after SGR. Repair
              // their rebuilt view locally so the native agent can keep running through updates.
              const encodings = this.rebuildMouseEncodings
              this.rebuildMouseEncodings = undefined
              const encoding = encodings?.has(1016) ? 1016 : encodings?.has(1006) ? 1006 : 0
              if (encoding && this.terminal)
                await new Promise<void>((resolve) =>
                  this.terminal?.write(`\x1b[?${encoding}h`, resolve),
                )
              this.fit()
              this.terminal?.refresh(0, this.terminal.rows - 1)
              this.options.onPresentation?.("ready")
            })
          },
          onDisconnect: () => {
            this.canType = false
            this.replayComplete = false
            root.inert = false
            if (this.terminal) this.terminal.options.disableStdin = true
            if (this.terminal?.textarea) this.terminal.textarea.readOnly = true
          },
        },
      })
    this.reconnect()
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
    if (sent) this.submitted(text)
    return sent
  }
  /**
   * Pastes each image path into the agent's input and resolves once the agent has drawn it, so
   * words and Enter typed after it carry the image. False when the window cannot type, closes, or
   * the agent draws nothing for an image within five seconds.
   */
  async pasteImages(paths: readonly string[]): Promise<boolean> {
    for (const path of paths)
      if (!this.drawn.paths.has(path) && !(await this.pasteImage(path))) return false
    return true
  }
  private pasteImage(path: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.disposed) return resolve(false)
      let seen = ""
      const drawn = this.drawn
      const echo = {
        output: (text: string) => {
          seen = (seen + text).slice(-8192)
          const mark = imageEchoed(seen, drawn.marks)
          if (!mark) return
          drawn.marks.add(mark)
          drawn.paths.add(path)
          echo.done(true)
        },
        done: (ok: boolean) => {
          if (!this.echoes.delete(echo)) return
          clearTimeout(deadline)
          resolve(ok)
        },
      }
      const deadline = setTimeout(() => echo.done(false), 5000)
      this.echoes.add(echo)
      if (!this.sendInput(imagePaste(path))) echo.done(false)
    })
  }
  resize(cols: number, rows: number) {
    if (this.canResize && !this.options.phone) this.enqueue(() => this.terminal?.resize(cols, rows))
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
    this.webgl()
    if (this.terminal)
      this.terminal.options.cursorBlink = this.drawing() && readTerminalAppearance().cursorBlink
    if (this.drawing()) {
      const kept = this.hiddenOutput
      this.hiddenOutput = ""
      if (this.displayDirty && this.reconnect) {
        this.displayDirty = false
        this.replayComplete = false
        this.options.onPresentation?.("connecting")
        this.reconnect()
      } else if (kept) this.draw(kept)
      this.enqueue(() => {
        this.fit()
        this.terminal?.refresh(0, this.terminal.rows - 1)
      })
    }
  }
  retryRenderer() {
    if (this.renderer !== "failed") return
    this.renderer = "basic"
    this.webgl()
  }
  setPhone(phone: boolean) {
    this.options.phone = phone
    this.transport?.setPhone(phone)
    this.syncOverflow()
    if (!phone) this.enqueue(() => this.fit())
  }
  dispose() {
    this.disposed = true
    for (const echo of [...this.echoes]) echo.done(false)
    this.finishWrite?.()
    this.finishWrite = undefined
    this.displayBatch = undefined
    this.pendingOutputBytes = 0
    this.hiddenOutput = ""
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
    this.observer?.disconnect()
    if (this.fitTimer !== undefined) clearTimeout(this.fitTimer)
    for (const stop of [...this.drawWaits]) stop()
    this.hostSize = undefined
    this.transport?.destroy()
    this.releaseWebgl()
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
    if (this.terminal)
      this.terminal.options.theme = {
        foreground: shown.foreground,
        background: shown.background,
        cursor: shown.cursor,
        selectionForeground: shown.background,
        selectionBackground: shown.foreground,
        selectionInactiveBackground: shown.foreground,
      }
  }
  diagnostics() {
    return {
      renderer: "xterm",
      backend: this.addon ? "webgl2" : "dom",
      rendererState: this.renderer,
      connected: this.transport?.isConnected() ?? false,
      state: this.disposed ? "disposed" : "ready",
      pendingWrites: this.pendingWrites,
      pendingOutputBytes: this.pendingOutputBytes,
      fontSize: this.terminal?.options.fontSize,
      lineHeight: this.terminal?.options.lineHeight,
      minimumContrastRatio: this.terminal?.options.minimumContrastRatio,
      fontFamily: this.terminal?.options.fontFamily,
      fontWeight: this.terminal?.options.fontWeight,
      letterSpacing: this.terminal?.options.letterSpacing,
      scrollback: this.terminal?.options.scrollback,
      scrollSensitivity: this.terminal?.options.scrollSensitivity,
      fastScrollSensitivity: this.terminal?.options.fastScrollSensitivity,
      smoothScrollDuration: this.terminal?.options.smoothScrollDuration,
      cursorBlink: this.terminal?.options.cursorBlink,
      theme: this.terminal?.options.theme,
      viewportY: this.terminal?.buffer.active.viewportY,
      baseY: this.terminal?.buffer.active.baseY,
      selectionLength: this.terminal?.getSelection().length,
      mouseTrackingMode: this.terminal?.modes.mouseTrackingMode,
      bufferType: this.terminal?.buffer.active.type,
    }
  }
}

export function createXtermView(options: TerminalOptions): TerminalView {
  return new XtermView(options)
}

/** Ctrl+Enter alone, typed, not composed: Claude Code's "send now". */
const isCtrlEnter = (event: KeyboardEvent): boolean =>
  event.key === "Enter" &&
  event.ctrlKey &&
  !(event.metaKey || event.altKey || event.shiftKey || event.isComposing)

type KeyProtocol = "kitty" | "modify" | null

/** One protocol switch: kitty's push, pop or set (`u`), or modifyOtherKeys (`> 4 ; n m`). */
export function keyProtocolSwitch(
  lead: string,
  params: (number | number[])[],
  final: "u" | "m",
  state: KeyProtocol,
): KeyProtocol {
  const [first = 0, second = 0] = params
  if (typeof first !== "number" || typeof second !== "number") return state
  if (final === "u") {
    if (lead === "=") return first > 0 ? "kitty" : null
    return lead === ">" ? "kitty" : null
  }
  if (lead !== ">" || first !== 4 || state === "kitty") return state
  return second >= 2 ? "modify" : null
}
