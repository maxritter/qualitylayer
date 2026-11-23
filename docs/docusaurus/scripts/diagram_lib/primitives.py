"""Shared theme tokens and SVG shape primitives for documentation diagrams."""
from xml.sax.saxutils import escape

Theme = dict[str, str]
Point = tuple[float, float]
Rect = tuple[float, float, float, float]

SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

# The three steps, in order; you approve the Plan and, in Verify, the finished change. Implement needs nothing from you.
STEPS = [('Plan', 'amber'), ('Implement', 'blue'), ('Verify', 'violet')]
STEPS_PR = STEPS + [('Pull request', 'blue')]
GATES = {'Plan', 'Verify'}
DOC_FILES = ['01-plan.md', '02-implement.md', '03-verify.md']


def T(c: Theme, pos: Point, s: str, **opts) -> str:
    """A text element; `fill` is a theme key or a literal colour."""
    x, y = pos
    size = opts.get('size', 14)
    fill = opts.get('fill', 'text')
    weight = opts.get('weight', 400)
    anchor = opts.get('anchor', 'start')
    mono = opts.get('mono', False)
    if fill == 'blue':
        fill = 'blueink'
    return (f'<text x="{x}" y="{y}" font-family="{MONO if mono else SANS}" font-size="{size}" font-weight="{weight}" '
            f'fill="{c.get(fill, fill)}" text-anchor="{anchor}">{escape(s)}</text>')


def svg(size: Point, body: str, title: str) -> str:
    """The canvas, with 2px to spare on every side so edge strokes are not clipped."""
    w, h = size[0] + 4, size[1] + 4
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="-2 -2 {w} {h}" role="img" '
            f'aria-label="{escape(title)}"><title>{escape(title)}</title>{body}</svg>\n')


def node(c: Theme, rect: Rect, title: str, sub, **opts) -> str:
    x, y, w, h = rect
    col = opts['col']
    fill = opts.get('fill')
    dash = opts.get('dash', False)
    d = ' stroke-dasharray="5 4"' if dash else ''
    sw = 1 if col == 'cardline' else 2
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{c[fill] if fill else c["card"]}" stroke="{c[col]}" stroke-width="{sw}"{d}/>']
    out.append(T(c, (x + 16, y + 28), title, size=15, fill='text', weight=650))
    for i, s in enumerate(sub if isinstance(sub, list) else [sub]):
        out.append(T(c, (x + 16, y + 48 + i * 18), s, size=13, fill='muted'))
    return ''.join(out)


def curve(c: Theme, start: Point, end: Point, **opts) -> str:
    x1, y1 = start
    x2, y2 = end
    col = opts.get('col', 'line')
    dash = opts.get('dash', False)
    w = opts.get('w', 2)
    mx = (x1 + x2) / 2
    d = ' stroke-dasharray="4 5"' if dash else ''
    return f'<path d="M{x1} {y1} C{mx} {y1} {mx} {y2} {x2} {y2}" fill="none" stroke="{c[col]}" stroke-width="{w}"{d}/>'


def bars(c: Theme, pos: Point, widths: list, **opts) -> str:
    x, y = pos
    gap = opts.get('gap', 14)
    h = opts.get('h', 6)
    col = opts.get('col', 'line')
    return ''.join(f'<rect x="{x}" y="{y + i * gap}" width="{w}" height="{h}" rx="3" fill="{c[col]}"/>' for i, w in enumerate(widths))


def card(c: Theme, rect: Rect, **opts) -> str:
    x, y, w, h = rect
    stroke = opts.get('stroke', 'cardline')
    fill = opts.get('fill', 'card')
    dash = opts.get('dash', False)
    sw = opts.get('sw', 1)
    d = ' stroke-dasharray="5 4"' if dash else ''
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{c[fill]}" stroke="{c[stroke]}" stroke-width="{sw}"{d}/>'


def arrow(c: Theme, start: Point, end: Point, **opts) -> str:
    x1, y1 = start
    x2, y2 = end
    col = opts.get('col', 'muted')
    dash = opts.get('dash', False)
    d = ' stroke-dasharray="4 4"' if dash else ''
    if y1 == y2:
        s = 1 if x2 > x1 else -1
        head = f'<path d="M{x2 - 7 * s} {y2 - 5} l{7 * s} 5 l{-7 * s} 5" fill="none" stroke="{c[col]}" stroke-width="1.8"/>'
    else:
        s = 1 if y2 > y1 else -1
        head = f'<path d="M{x2 - 5} {y2 - 7 * s} l5 {7 * s} l5 {-7 * s}" fill="none" stroke="{c[col]}" stroke-width="1.8"/>'
    return f'<path d="M{x1} {y1} L{x2} {y2}" stroke="{c[col]}" stroke-width="1.8"{d}/>' + head


def pill(c: Theme, pos: Point, text: str, **opts) -> str:
    x, y = pos
    col = opts.get('col', 'muted')
    mono = opts.get('mono', False)
    fill = opts.get('fill', 'bg')
    stroke = opts.get('stroke', 'cardline')
    w = opts.get('w')
    if w is None:
        w = 18 + len(text) * (7.4 if mono else 6.6)
    return (f'<rect x="{x}" y="{y}" width="{w}" height="22" rx="11" fill="{c[fill]}" stroke="{c[stroke]}"/>'
            + T(c, (x + w / 2, y + 15), text, size=11.5, fill=col, weight=600, anchor='middle', mono=mono))


def button(c: Theme, rect: Rect, text: str, primary: bool = False) -> str:
    x, y, w, h = rect
    if primary:
        return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{c["blue"]}"/>'
                + T(c, (x + w / 2, y + h / 2 + 4.5), text, size=13, fill='onblue', weight=650, anchor='middle'))
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{c["bg"]}" stroke="{c["cardline"]}"/>'
            + T(c, (x + w / 2, y + h / 2 + 4.5), text, size=13, fill='text', weight=600, anchor='middle'))


def switch(c: Theme, pos: Point, on: bool = True) -> str:
    x, y = pos
    if on:
        return (f'<rect x="{x}" y="{y}" width="28" height="18" rx="9" fill="{c["blue"]}"/>'
                f'<circle cx="{x + 19}" cy="{y + 9}" r="6" fill="#ffffff"/>')
    return (f'<rect x="{x}" y="{y}" width="28" height="18" rx="9" fill="{c["bg"]}" stroke="{c["cardline"]}"/>'
            f'<circle cx="{x + 9}" cy="{y + 9}" r="6" fill="{c["dim"]}"/>')


def diamond(c: Theme, pos: Point, r: float, **opts) -> str:
    x, y = pos
    fill = opts.get('fill', 'amberf')
    stroke = opts.get('stroke', 'amber')
    return (f'<rect x="{x - r}" y="{y - r}" width="{2 * r}" height="{2 * r}" rx="3" transform="rotate(45 {x} {y})" '
            f'fill="{c[fill]}" stroke="{c[stroke]}" stroke-width="2"/>')


def window(c: Theme, size: Point, title: str = 'QualityLayer') -> str:
    W, H = size
    return (f'<rect x="1" y="1" width="{W - 2}" height="{H - 2}" rx="16" fill="{c["bg"]}" stroke="{c["cardline"]}" stroke-width="1.5"/>'
            f'<path d="M1 17 a16 16 0 0 1 16 -16 H{W - 17} a16 16 0 0 1 16 16 V40 H1 Z" fill="{c["card"]}"/>'
            f'<line x1="1" y1="40" x2="{W - 1}" y2="40" stroke="{c["cardline"]}"/>'
            + ''.join(f'<circle cx="{22 + i * 18}" cy="21" r="5" fill="{c["line"]}"/>' for i in range(3))
            + T(c, (W / 2, 26), title, size=12, fill='dim', weight=500, anchor='middle'))


def ring(c: Theme, pos: Point, kind: str, r: float = 6) -> str:
    """Who acts: an amber ring for you, a blue open ring for agents, a filled dot when done."""
    x, y = pos
    if kind == 'you':
        return f'<circle cx="{x}" cy="{y}" r="{r}" fill="none" stroke="{c["amber"]}" stroke-width="2"/>'
    if kind == 'agent':
        return (f'<circle cx="{x}" cy="{y}" r="{r}" fill="none" stroke="{c["blue"]}" stroke-width="2" '
                f'stroke-dasharray="{r * 5.2:.1f} {r * 1.2:.1f}" stroke-linecap="round"/>')
    if kind == 'dim':
        return f'<circle cx="{x}" cy="{y}" r="{r}" fill="none" stroke="{c["off"]}" stroke-width="2"/>'
    return f'<circle cx="{x}" cy="{y}" r="{r - 0.5}" fill="{c["text"]}"/>'


def vmark(c: Theme, pos: Point) -> str:
    """A check made by agents: violet."""
    x, y = pos
    return (f'<path d="M{x - 6} {y} l4 4 l8 -9" fill="none" stroke="{c["violet"]}" stroke-width="2.4" '
            f'stroke-linecap="round" stroke-linejoin="round"/>')


def abtn_svg(c: Theme, pos: Point, text: str, **opts) -> str:
    x, y = pos
    primary = opts.get('primary', False)
    h = opts.get('h', 26)
    size = opts.get('size', 12)
    w = opts.get('w')
    if w is None:
        w = 18 + len(text) * (size * 0.52)
    if primary:
        return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="7" fill="{c["blue"]}"/>'
                + T(c, (x + w / 2, y + h / 2 + 4), text, size=size, fill='onblue', weight=650, anchor='middle'))
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="7" fill="{c["bg"]}" stroke="{c["cardline"]}"/>'
            + T(c, (x + w / 2, y + h / 2 + 4), text, size=size, fill='text', weight=600, anchor='middle'))


def lock(c: Theme, pos: Point, col: str = 'text') -> str:
    x, y = pos
    return (f'<rect x="{x}" y="{y + 4}" width="10" height="8" rx="1.5" fill="none" stroke="{c[col]}" stroke-width="1.5"/>'
            f'<path d="M{x + 2} {y + 4} v-2.5 a3 3 0 0 1 6 0 v2.5" fill="none" stroke="{c[col]}" stroke-width="1.5"/>')
