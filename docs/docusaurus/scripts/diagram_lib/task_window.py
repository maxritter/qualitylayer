"""Task-window diagram composer shared by Plan, Implement, Verify, and Review illustrations."""
from .primitives import DOC_FILES, Point, Rect, STEPS, T, Theme, abtn_svg, card, svg, window
from .app_chrome import rside, sidebar, spill, tabs


def _question_card(c: Theme, rect: Rect, questions: list, step: int) -> list[str]:
    x, y, w, h = rect
    kind, lines, choices = questions[0]
    b = [
        card(c, (x, y, w, h), stroke='amber', fill='bg'),
        T(c, (x + 20, y + 29), 'Your turn', size=17, fill='text', weight=650),
        T(c, (x + w - 20, y + 29), f'0 of {len(questions)} answered', size=12, fill='muted', weight=500, anchor='end'),
        T(c, (x + 20, y + 57), kind, size=12, fill='muted', weight=500),
    ]
    for k, line in enumerate(lines):
        b.append(T(c, (x + 20, y + 83 + k * 19), line, size=15, fill='text', weight=600))
    for i, label in enumerate(choices):
        cy = y + 118 + i * 44
        recommended = kind == 'Question' and i == 0
        b.append(f'<rect data-choice="{i + 1}" x="{x + 20}" y="{cy}" width="{w - 40}" height="36" rx="8" fill="{c["bg"]}" stroke="{c["blue"] if recommended else c["cardline"]}"/>')
        b.append(T(c, (x + 34, cy + 23), str(i + 1), size=12, fill='muted', weight=500))
        b.append(T(c, (x + 58, cy + 23), label, size=13, fill='text', weight=600))
        if recommended:
            b.append(T(c, (x + w - 34, cy + 23), 'Recommended', size=11.5, fill='blue', weight=600, anchor='end'))
    own_y = y + 118 + len(choices) * 44
    b.append(T(c, (x + 20, own_y + 14), 'Your own answer', size=12, fill='muted', weight=500))
    b.append(f'<rect data-own-words="true" x="{x + 20}" y="{own_y + 26}" width="{w - 130}" height="38" rx="6" fill="{c["bg"]}" stroke="{c["cardline"]}"/>')
    b.append(T(c, (x + 32, own_y + 50), 'Write what works for you…', size=12.5, fill='dim'))
    b.append(abtn_svg(c, (x + w - 96, own_y + 26), 'Send', primary=True, h=38, size=12.5, w=76))
    if kind == 'Question':
        b.append(T(c, (x + 20, own_y + 96), 'Tell me more', size=12, fill='blue', weight=600))
        b.append(T(c, (x + 148, own_y + 96), 'Skip for now', size=12, fill='blue', weight=600))
        b.append(T(c, (x + w - 20, own_y + 96), 'Each answer reaches the agent immediately.', size=12, fill='muted', weight=400, anchor='end'))
    else:
        b.append(T(c, (x + 20, own_y + 96), 'Settle this point, then continue to the next open decision.', size=12, fill='muted'))
        if step == 0:
            b.append(T(c, (x + 20, own_y + 116), 'Answers do not approve the Plan.', size=12, fill='muted'))
    return b


def _document_sections(c: Theme, pos: Point, w: float, step: int, sections: list) -> list[str]:
    dx, dy = pos
    b = [
        T(c, (dx, dy), f'{step + 1:02d}-{STEPS[step][0].lower()}.md  ▾', size=11.5, fill='muted', weight=500, mono=True),
        T(c, (dx + w, dy), 'Read in full', size=12, fill='blue', weight=600, anchor='end'),
        T(c, (dx, dy + 36), STEPS[step][0], size=23, fill='text', weight=650),
    ]
    yy = dy + 65
    for kind, text in sections:
        if kind == 'heading':
            yy += 12
            b.append(T(c, (dx, yy), text, size=14, fill='text', weight=650))
            yy += 29
        else:
            col = 'violet' if kind == 'proof' else ('text' if kind == 'agreed' else 'muted')
            b.append(T(c, (dx, yy), text, size=12.5, fill=col, weight=500))
            yy += 24
    return b


def task_example(c: Theme, step: int, sections: list, questions: list, working: str) -> str:
    """Current App model: two header rows, one focused card above the work, Conversation / Terminal / Files."""
    h = 118 + len(questions[0][2]) * 44 + 132 if questions else 0
    content_height = sum(41 if kind == 'heading' else 24 for kind, _ in sections)
    W, H = 1400, max(860, 138 + h + 32 + 65 + content_height + 62)
    b = [window(c, (W, H), 'Settings cleanup · QualityLayer')]
    group = 'Your turn  1' if questions else 'Running  1'
    b.append(sidebar(c, (W, H), [(group, [('Settings cleanup', STEPS[step][0], 'you' if questions else 'agent')]),
                                 ('Shipped  6', [])], selected='Settings cleanup'))
    b.append(T(c, (238, 67), 'Settings cleanup', size=16, fill='text', weight=650))
    b.append(tabs(c, (238, 104), step))
    p, _ = spill(c, (790, 48), 'you' if working == 'Waits for you' else 'agent', working)
    b.append(p)
    if step == 0 and not questions:
        b.append(abtn_svg(c, (1040, 49), 'Ask agent'))
        b.append(abtn_svg(c, (1174, 49), 'Approve Plan', primary=True))
    b.append(f'<line x1="222" y1="82" x2="{W}" y2="82" stroke="{c["cardline"]}"/>')
    x, y, w = 258, 138, 850
    if questions:
        b.extend(_question_card(c, (x, y, w, h), questions, step))
    b.extend(_document_sections(c, (258, y + h + 32), w, step, sections))
    b.append(rside(c, (1140, 82, 260, H - 82), 'files'))
    b.append(T(c, (1156, 148), 'Settings cleanup', size=12, fill='muted', weight=600))
    for i, label in enumerate(DOC_FILES):
        b.append(T(c, (1156, 184 + i * 30), label, size=12, fill='text' if i <= step else 'dim', weight=500, mono=True))
    b.append(T(c, (1156, 428), 'Artifacts · 1', size=12, fill='muted', weight=600))
    b.append(T(c, (1156, 458), 'Settings page', size=12.5, fill='text', weight=600))
    b.append(T(c, (1156, 480), 'Only on this computer', size=11.5, fill='muted'))
    b.append(T(c, (258, H - 24), 'Illustration · example task, people and results', size=10.5, fill='muted'))
    return svg((W, H), ''.join(b), f'{STEPS[step][0]}: named agent status, one focused Your turn card above the work, visible own words and Send for questions, and Conversation / Terminal / Files with artifacts within Files')
