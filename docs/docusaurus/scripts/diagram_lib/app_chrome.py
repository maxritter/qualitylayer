"""Shared App chrome components for documentation diagrams."""
from xml.sax.saxutils import escape
from .primitives import GATES, Point, Rect, SANS, STEPS, T, Theme, ring


def _tab_kind(index: int, here: int, done_limit: int) -> str:
    if index < done_limit:
        return 'done'
    if index != here:
        return 'dim'
    return 'you' if STEPS[index][0] in GATES else 'agent'


def tabs(c: Theme, pos: Point, here: int, **opts) -> str:
    """The step tabs: a done dot, the agent's open ring, your amber ring with its count."""
    x, y = pos
    counts = opts.get('counts') or {}
    done_limit = opts.get('done') if opts.get('done') is not None else here
    out, sx = [], x
    for i, (step_name, _) in enumerate(STEPS):
        label = step_name + (f'  {counts[step_name]}' if step_name in counts else '')
        kind = _tab_kind(i, here, done_limit)
        fill = c['text'] if i == here else (c['dim'] if kind == 'dim' else c['muted'])
        weight = 600 if i == here else 400
        out.append(ring(c, (sx + 5, y), kind, 5))
        out.append(f'<text x="{sx + 16}" y="{y + 4}" font-family="{SANS}" font-size="12.5" font-weight="{weight}" '
                   f'fill="{fill}">{escape(label)}</text>')
        sx += 16 + len(label) * 7.0 + 22
    return ''.join(out)


def sidebar(c: Theme, size: Point, groups: list, selected: str | None = None) -> str:
    """The App's sidebar: search, Your turn / Running / Shipped, the foot with Feedback."""
    _, H = size
    out = [f'<path d="M1 41 H221 V{H - 1} H17 a16 16 0 0 1 -16 -16 Z" fill="{c["card"]}"/>',
           f'<line x1="221" y1="41" x2="221" y2="{H - 1}" stroke="{c["cardline"]}"/>',
           T(c, (20, 68), 'QualityLayer', size=14, fill='text', weight=700),
           f'<rect x="150" y="53" width="58" height="22" rx="6" fill="{c["bg"]}" stroke="{c["muted"]}" stroke-opacity="0.6"/>',
           T(c, (179, 68), '+ New', size=11.5, fill='text', weight=600, anchor='middle'),
           f'<rect x="12" y="80" width="198" height="28" rx="7" fill="{c["bg"]}" stroke="{c["cardline"]}"/>',
           T(c, (24, 98), 'Search or jump to a task', size=11.5, fill='dim'),
           T(c, (198, 98), '⌘K', size=10.5, fill='dim', weight=500, anchor='end', mono=True)]
    y = 134
    for title, rows in groups:
        out.append(T(c, (20, y), title, size=11.5, fill='amber' if title.startswith('Your turn') else 'muted', weight=650))
        y += 10
        for name, tail, kind in rows:
            if name == selected:
                out.append(f'<rect x="12" y="{y}" width="198" height="30" rx="7" fill="{c["bg"]}" stroke="{c["cardline"]}"/>')
            out.append(ring(c, (28, y + 15), kind, 4.5))
            out.append(T(c, (40, y + 19), name, size=12.5, fill='text', weight=500))
            out.append(T(c, (200, y + 19), tail, size=10.5, fill='amber' if kind == 'you' else 'dim', weight=500, anchor='end', mono=True))
            y += 32
        y += 14
    fy = H - 66
    out.append(f'<line x1="1" y1="{fy}" x2="221" y2="{fy}" stroke="{c["cardline"]}"/>')
    out.append(f'<circle cx="28" cy="{fy + 20}" r="11" fill="{c["bg"]}" stroke="{c["cardline"]}"/>')
    out.append(T(c, (28, fy + 24), 'MR', size=9.5, fill='muted', weight=650, anchor='middle'))
    out.append(T(c, (46, fy + 18), 'Sam Rivera', size=12, fill='text', weight=600))
    out.append(T(c, (46, fy + 33), 'Business licence', size=10.5, fill='dim'))
    for i in range(3):
        out.append(f'<rect x="{14 + i * 34}" y="{fy + 40}" width="28" height="20" rx="6" fill="{c["bg"]}" stroke="{c["cardline"]}"/>'
                   f'<circle cx="{28 + i * 34}" cy="{fy + 50}" r="3" fill="{c["dim"]}"/>')
    out.append(f'<rect x="120" y="{fy + 40}" width="90" height="20" rx="6" fill="{c["bg"]}" stroke="{c["cardline"]}"/>')
    out.append(T(c, (165, fy + 54), 'Bug / idea', size=11, fill='text', weight=600, anchor='middle'))
    return ''.join(out)


def spill(c: Theme, pos: Point, kind: str, head_: str, rest: str = '') -> tuple[str, float]:
    """A neutral named agent chip; its mark carries the live state."""
    x, y = pos
    text = 'Claude Code · ' + head_ + (f' · {rest}' if rest else '')
    w = 34 + len(text) * 6.2
    out = (f'<rect x="{x}" y="{y}" width="{w}" height="22" rx="11" fill="{c["bg"]}" stroke="{c["cardline"]}"/>'
           + ring(c, (x + 14, y + 11), 'you' if kind == 'you' else 'agent', 4.5)
           + T(c, (x + 25, y + 15), text, size=11.5, fill='text', weight=600))
    return out, w


def rside(c: Theme, rect: Rect, tab: str) -> str:
    """The right sidebar: Conversation, Terminal and Files."""
    x, y, w, h = rect
    out = [f'<line x1="{x}" y1="{y}" x2="{x}" y2="{y + h}" stroke="{c["cardline"]}"/>',
           f'<rect x="{x + 12}" y="{y + 12}" width="{w - 56}" height="28" rx="7" fill="{c["bg"]}" stroke="{c["cardline"]}"/>']
    tab = 'files' if tab == 'artifacts' else tab
    half = (w - 60) / 3
    for i, t in enumerate(['Conversation', 'Terminal', 'Files']):
        bx = x + 14 + i * half
        active = t.lower() == tab
        if active:
            out.append(f'<rect x="{bx}" y="{y + 14}" width="{half}" height="24" rx="6" fill="{c["card"]}" stroke="{c["cardline"]}"/>')
        out.append(T(c, (bx + half / 2, y + 30), t, size=10.5, fill='text' if active else 'muted', weight=600 if active else 500, anchor='middle'))
    out.append(f'<rect x="{x + w - 38}" y="{y + 14}" width="24" height="24" rx="6" fill="{c["bg"]}" stroke="{c["cardline"]}"/>'
               f'<rect x="{x + w - 32}" y="{y + 20}" width="12" height="12" rx="2" fill="none" stroke="{c["dim"]}" stroke-width="1.3"/>')
    return ''.join(out)
