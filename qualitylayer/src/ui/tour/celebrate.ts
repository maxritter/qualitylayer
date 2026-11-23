// The end of the tour: confetti from the Start button (Full), or a ring of small sparkles round it
// (gentle). It plays once on its own layer above the App, removes itself and never loops; there is no
// dependency. The button answers first with one ring that opens and fades.

import type { Motion } from "../../core/config-values.ts"

export const CONFETTI_LIFE = 1900
export const SPARKLES = 12
const FADE = 1350
const GRAVITY = 0.0016
const ARRIVE = "cubic-bezier(0.16, 1, 0.3, 1)"
const COLOURS = [
  "--ql-accent",
  "--ql-amber",
  "--ql-check",
  "--ql-accent",
  "--ql-amber",
  "--ql-border-strong",
]

export type Bit = {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  vr: number
  flip: number
  vf: number
  w: number
  h: number
  round: boolean
  colour: string
}

/** Where the burst starts: the middle of the button, else the middle of the window a little above centre. */
export function originOf(button: Element | null, width: number, height: number) {
  const box = button?.getBoundingClientRect()
  const b =
    box !== undefined && box.width > 0
      ? box
      : { left: width / 2 - 60, top: height * 0.45, width: 120, height: 36 }
  return { x: b.left + b.width / 2, y: b.top + b.height / 2, width: b.width, height: b.height }
}

/** The pieces of confetti: a fan upwards from the button, as many as the window is wide, between 90 and 150. */
export function confettiBits(
  origin: { x: number; y: number; width: number },
  width: number,
  colours: string[],
  random: () => number = Math.random,
): Bit[] {
  const count = Math.round(Math.min(150, Math.max(90, width / 10)))
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (random() - 0.5) * (Math.PI * 0.62)
    const speed = 0.55 + random() * 0.6
    return {
      x: origin.x + (random() - 0.5) * origin.width * 0.6,
      y: origin.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: random() * Math.PI,
      vr: (random() - 0.5) * 0.018,
      flip: random() * Math.PI,
      vf: 0.008 + random() * 0.01,
      w: 5 + random() * 4,
      h: 8 + random() * 6,
      round: i % 4 === 0,
      colour: colours[i % colours.length] ?? "#2076c5",
    }
  })
}

/** One step of the physics; `dt` is capped so a slow frame cannot throw the pieces across the window. */
export function stepBit(bit: Bit, dt: number): void {
  bit.vy += GRAVITY * dt
  const drag = 0.9985 ** dt
  bit.vx *= drag
  bit.vy *= drag
  bit.x += bit.vx * dt
  bit.y += bit.vy * dt
  bit.r += bit.vr * dt
  bit.flip += bit.vf * dt
}

const fadeOf = (age: number) =>
  age < FADE ? 1 : Math.max(0, 1 - (age - FADE) / (CONFETTI_LIFE - FADE))

function coloursOf(): string[] {
  const css = getComputedStyle(document.documentElement)
  return COLOURS.map((name) => css.getPropertyValue(name).trim()).filter((c) => c !== "")
}

type Origin = ReturnType<typeof originOf>

function playGentleSparkles(
  layer: HTMLElement,
  origin: Origin,
  colours: string[],
  remove: () => void,
): void {
  const rx = origin.width / 2 + 18
  const ry = origin.height / 2 + 16
  const done: Promise<unknown>[] = []
  for (let i = 0; i < SPARKLES; i++) {
    const angle = (i / SPARKLES) * Math.PI * 2 - Math.PI / 2
    const spark = document.createElement("i")
    spark.className = "q-spark"
    spark.style.left = `${origin.x + Math.cos(angle) * rx}px`
    spark.style.top = `${origin.y + Math.sin(angle) * ry}px`
    spark.style.background = colours[i % 3] ?? "currentColor"
    spark.style.setProperty("--k", (i % 2 ? 0.7 : 1).toString())
    layer.appendChild(spark)
    const dx = Math.cos(angle) * 6
    const dy = Math.sin(angle) * 6
    const play = spark.animate?.(
      [
        { transform: "translate(-50%, -50%) scale(0)", opacity: 0 },
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.4 },
        {
          transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.3)`,
          opacity: 0,
        },
      ],
      { duration: 700, delay: i * 28, easing: ARRIVE, fill: "both" },
    )
    if (play !== undefined) done.push(play.finished)
  }
  if (done.length === 0) remove()
  else void Promise.all(done).then(remove, remove)
}

function drawBit(ctx: CanvasRenderingContext2D, bit: Bit, alpha: number): void {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(bit.x, bit.y)
  ctx.rotate(bit.r)
  ctx.scale(1, Math.cos(bit.flip))
  ctx.fillStyle = bit.colour
  if (bit.round) {
    ctx.beginPath()
    ctx.arc(0, 0, bit.w / 2, 0, Math.PI * 2)
    ctx.fill()
  } else ctx.fillRect(-bit.w / 2, -bit.h / 2, bit.w, bit.h)
  ctx.restore()
}

function playConfettiCanvas(args: {
  layer: HTMLElement
  origin: Origin
  width: number
  height: number
  colours: string[]
  isGone: () => boolean
  setFrame: (id: number) => void
  remove: () => void
}): void {
  const { layer, origin, width, height, colours, isGone, setFrame, remove } = args
  const canvas = document.createElement("canvas")
  const scale = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = width * scale
  canvas.height = height * scale
  layer.appendChild(canvas)
  const ctx = canvas.getContext("2d")
  if (ctx === null) {
    remove()
    return
  }
  const bits = confettiBits(origin, width, colours)
  let start = 0
  let last = 0
  const draw = (now: number) => {
    if (isGone()) return
    if (start === 0) {
      start = now
      last = now
    }
    const dt = Math.min(32, now - last)
    const age = now - start
    last = now
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const alpha = fadeOf(age)
    for (const bit of bits) {
      stepBit(bit, dt)
      drawBit(ctx, bit, alpha)
    }
    if (age < CONFETTI_LIFE && !document.hidden) setFrame(requestAnimationFrame(draw))
    else remove()
  }
  setFrame(requestAnimationFrame(draw))
}

/**
 * Play the ending. `button` is the Start button (or the sidebar's +); without one the burst starts
 * near the middle of the window. Returns a function that stops it and removes its layer at once.
 */
export function celebrate(button: HTMLElement | null, mode: Motion): () => void {
  const width = window.innerWidth
  const height = window.innerHeight
  const origin = originOf(button, width, height)
  const colours = coloursOf()
  const layer = document.createElement("div")
  layer.className = "q-fx q-motion-own"
  layer.setAttribute("aria-hidden", "true")
  layer.dataset.mode = mode
  document.body.appendChild(layer)
  let gone = false
  let frame = 0
  const remove = () => {
    gone = true
    cancelAnimationFrame(frame)
    layer.remove()
  }
  const ring = getComputedStyle(document.documentElement)
    .getPropertyValue("--ql-accent-line")
    .trim()
  button?.animate?.(
    [
      { boxShadow: `0 0 0 0 ${ring || colours[0] || "currentColor"}` },
      { boxShadow: "0 0 0 10px transparent" },
    ],
    { duration: mode === "gentle" ? 420 : 520, easing: ARRIVE },
  )
  if (mode === "gentle") {
    playGentleSparkles(layer, origin, colours, remove)
    return remove
  }
  playConfettiCanvas({
    layer,
    origin,
    width,
    height,
    colours,
    isGone: () => gone,
    setFrame: (id) => {
      frame = id
    },
    remove,
  })
  return remove
}
