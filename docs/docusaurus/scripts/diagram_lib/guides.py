"""Getting-started, reference, home, items, decision, and diagnose diagrams."""
from .primitives import T, Theme, abtn_svg, arrow, card, curve, diamond, lock, node, svg, window
from .app_chrome import sidebar


def peers(c: Theme) -> str:
    W, H = 1000, 270
    b = []
    pos = {'a': (60, 40, 'Claude Code', 'Building the export', 'blue'), 'b': (60, 190, 'Claude Code', 'Fixing a flaky test', 'blue'),
           'c': (700, 40, 'Codex', 'Reviewing the Plan', 'violet'), 'd': (700, 190, 'Codex', 'Idle', 'violet')}
    links = [('a', 'c', 'Asks for a review'), ('b', 'd', 'Hands over a task'), ('a', 'b', 'Talks a problem through')]
    for f, t, lab in links:
        x1, y1 = pos[f][0] + 240, pos[f][1] + 36
        x2 = pos[t][0]
        if f == 'a' and t == 'b':
            mid_y = (pos[f][1] + 72 + pos[t][1]) / 2
            b.append(f'<path d="M{pos[f][0] + 120} {pos[f][1] + 72} V{pos[t][1]}" stroke="{c["line"]}" stroke-width="2"/>')
            b.append(f'<rect x="{pos[f][0] + 40}" y="{mid_y - 13}" width="160" height="26" rx="13" fill="{c["bg"]}" stroke="{c["cardline"]}"/>')
            b.append(T(c, (pos[f][0] + 120, mid_y + 4), lab, size=12, fill='muted', weight=500, anchor='middle'))
            continue
        b.append(f'<path d="M{x1} {y1} H{x2}" stroke="{c["line"]}" stroke-width="2"/>')
        b.append(f'<path d="M{x2 - 8} {y1 - 5} l8 5 l-8 5" fill="none" stroke="{c["line"]}" stroke-width="2"/>')
        b.append(f'<rect x="{(x1 + x2) / 2 - 80}" y="{y1 - 13}" width="160" height="26" rx="13" fill="{c["bg"]}" stroke="{c["cardline"]}"/>')
        b.append(T(c, ((x1 + x2) / 2, y1 + 4), lab, size=12, fill='muted', weight=500, anchor='middle'))
    for x, y, name, what, col in pos.values():
        b.append(f'<rect x="{x}" y="{y}" width="240" height="72" rx="12" fill="{c["card"]}" stroke="{c["cardline"]}"/>')
        b.append(f'<circle cx="{x + 22}" cy="{y + 25}" r="6" fill="{c[col]}"/>')
        b.append(T(c, (x + 38, y + 30), name, size=15, fill='text', weight=650))
        b.append(T(c, (x + 22, y + 52), what, size=13, fill='muted'))
    return svg((W, H), ''.join(b), 'Claude Code and Codex sessions on one computer messaging each other')


def install_ill(c: Theme) -> str:
    W, H = 1000, 270
    b = [
        node(c, (0, 85, 220, 100), 'Get QualityLayer', ['Download the App,', 'or set up the browser', 'workspace with the CLI'], col='cardline'),
        arrow(c, (222, 135), (270, 135)),
        diamond(c, (300, 135), 22, fill='amberf', stroke='amber'),
        T(c, (300, 190), 'A screen?', size=13, fill='text', weight=650, anchor='middle'),
        f'<path d="M322 135 C350 135 350 55 378 55" fill="none" stroke="{c["blue"]}" stroke-width="2"/>',
        f'<path d="M322 135 C350 135 350 215 378 215" fill="none" stroke="{c["muted"]}" stroke-width="2"/>',
        T(c, (364, 44), 'yes', size=12, fill='blue', weight=600, anchor='middle'),
        T(c, (364, 236), 'no', size=12, fill='muted', weight=600, anchor='middle'),
        node(c, (380, 10, 300, 90), 'The App', ['macOS, Windows, Linux desktop', 'Sets up the command line too'], col='blue', fill='bluef'),
        node(c, (380, 170, 300, 90), 'Command line only', ['WSL2, dev containers, servers', 'Opens the App in your browser'], col='cardline'),
        arrow(c, (682, 55), (718, 55)),
        arrow(c, (682, 215), (718, 215)),
        node(c, (720, 10, 280, 90), 'Updates itself', ['The App and its command line,', 'together'], col='cardline'),
        card(c, (720, 170, 280, 90)),
        T(c, (736, 198), 'Updates by command', size=15, fill='text', weight=650),
        T(c, (736, 222), 'qualitylayer update', size=13, fill='blue', weight=500, mono=True),
    ]
    return svg((W, H), ''.join(b), 'One rule: a machine with a screen gets the App, which updates itself; WSL2, dev containers and servers get the command line and open the App in a browser')


def remote_ill(c: Theme) -> str:
    W, H = 1000, 250
    b = [
        card(c, (0, 20, 300, 210)),
        T(c, (20, 52), 'Your computer', size=15, fill='text', weight=650),
        T(c, (20, 72), 'macOS, Windows or Linux', size=13, fill='muted'),
        node(c, (20, 100, 260, 100), 'Browser', ['The App’s pages: answer,', 'read, approve'], col='blue', fill='bluef'),
        arrow(c, (532, 150), (302, 150), col='blue'),
        arrow(c, (302, 150), (532, 150), col='blue'),
        T(c, (417, 132), 'One forwarded port', size=13, fill='text', weight=650, anchor='middle'),
    ]
    for i, how in enumerate(['VS Code forwards it', 'WSL2 forwards it', 'Over SSH: ssh -L']):
        b.append(T(c, (417, 178 + i * 18), how, size=12.5, fill='muted', anchor='middle'))
    b.extend([
        card(c, (534, 20, 466, 210), stroke='blue', fill='card', dash=True, sw=1.5),
        T(c, (554, 52), 'Where your agent runs', size=15, fill='text', weight=650),
        T(c, (554, 72), 'Dev container, WSL2 or a server', size=13, fill='muted'),
        node(c, (554, 100, 200, 100), 'Your agent', ['Claude Code, Codex, Cursor,', 'Grok, Antigravity, Pi,', 'OpenCode or GitHub Copilot'], col='cardline', fill='bg'),
        node(c, (772, 100, 208, 100), 'QualityLayer', ['Command line and', 'the App’s server'], col='cardline', fill='bg'),
    ])
    return svg((W, H), ''.join(b), 'Install QualityLayer where your agent runs, in a dev container, WSL2 or on a server. Its pages open in the browser on your computer through one forwarded port')


def files_ill(c: Theme) -> str:
    W, H = 1000, 320
    b = [card(c, (0, 0, 640, 316)), T(c, (18, 30), 'docs/plans/2026-10-06-csv-export/', size=13.5, fill='text', weight=700, mono=True)]
    rows = [('01-plan.md', 'What you approve: questions, decisions, Done means', 'amber'),
            ('02-implement.md', 'The build as it runs, slice by slice', 'amber'),
            ('03-verify.md', 'What was checked, with its proof', 'amber'),
            ('artifacts/', 'Interactive pages · local, out of Git', 'lock'),
            ('reviews/', 'What the other agents said, as written', 'blue'),
            ('records/', 'The output of every command', 'blue'),
            ('evidence/', 'Pictures and recordings', 'violet')]
    for i, (f, what, kind) in enumerate(rows):
        y = 50 + i * 34
        b.append(f'<line x1="26" y1="{y - 10}" x2="26" y2="{y + 14}" stroke="{c["line"]}"/>')
        b.append(f'<line x1="26" y1="{y + 6}" x2="38" y2="{y + 6}" stroke="{c["line"]}"/>')
        b.append(lock(c, (49, y - 1), 'muted') if kind == 'lock' else f'<circle cx="54" cy="{y + 6}" r="4.5" fill="{c[kind]}"/>')
        b.append(T(c, (74, y + 10.5), f, size=12.5, fill='text', weight=600 if kind == 'amber' else 500, mono=True))
        b.append(T(c, (622, y + 10.5), what, size=12, fill='muted', weight=400, anchor='end'))
    b.extend([
        T(c, (18, 300), 'Files lists documents, artifacts, reviews and local records.', size=12, fill='dim', weight=500),
        card(c, (660, 0, 340, 316)),
        T(c, (678, 30), 'What you can read', size=14, fill='text', weight=650),
    ])
    leg = [('amber', 'One document per step'), ('blue', 'Reviews and command output,'),
           (None, 'opened from Files'), ('violet', 'Evidence the checks kept'), ('lock', 'Interactive artifacts stay local')]
    for i, (k, t) in enumerate(leg):
        y = 56 + i * 30
        if k == 'lock':
            b.append(lock(c, (681, y - 7), 'muted'))
        elif k:
            b.append(f'<circle cx="686" cy="{y}" r="5" fill="{c[k]}"/>')
        b.append(T(c, (700, y + 4.5), t, size=12.5, fill='text' if k else 'muted', weight=500))
    for offset, line in [(230, 'The three documents read as plain'), (250, 'Markdown on GitHub. They live in your'),
                         (270, 'repository and go into Git with'), (290, 'the change.')]:
        b.append(T(c, (678, offset), line, size=12.5, fill='muted'))
    return svg((W, H), ''.join(b), 'A task folder in docs/plans: three documents, one per step, local interactive artifacts out of Git, reviews, command output and evidence. Files lists documents, artifacts and reviews')


def home_ill(c: Theme) -> str:
    W, H = 1100, 540
    b = [
        window(c, (W, H), 'Home · QualityLayer'),
        sidebar(c, (W, H), [('Your turn  1', [('Settings cleanup', 'Plan', 'you')]),
                            ('Running  1', [('Links', 'Verify', 'agent')]), ('Shipped  6', [])]),
        T(c, (242, 76), 'Home', size=22, fill='text', weight=650),
        T(c, (1076, 76), 'Notifications · 2', size=12, fill='blue', weight=600, anchor='end'),
    ]
    groups = [
        (238, 120, 444, 'Needs attention', 'Settings cleanup', 'Plan · 2 questions', 'Open →'),
        (238, 270, 444, 'Running', 'Links', 'Verify · checking point 2', 'Open →'),
        (706, 120, 374, 'Spent on agents', '$18.40', 'Known estimate · this week', 'About the estimate ▸'),
        (706, 270, 374, 'Shipped', 'CSV export', '42 min · $4.20 estimated', 'Open →'),
    ]
    for x, y, w, title, task, detail, action in groups:
        b.extend([
            T(c, (x, y), title, size=14, fill='text', weight=650),
            card(c, (x, y + 18, w, 110), stroke='cardline', fill='bg'),
            T(c, (x + 18, y + 48), task, size=17, fill='text', weight=650),
            T(c, (x + 18, y + 75), detail, size=12.5, fill='muted'),
            T(c, (x + 18, y + 104), action, size=12, fill='blue', weight=500),
        ])
    b.append(T(c, (242, H - 20), 'Illustration · example tasks and costs', size=10.5, fill='muted'))
    return svg((W, H), ''.join(b), 'Home: compact task destinations under Needs attention and Running, with spending and Shipped beside them')


def items_ill(c: Theme) -> str:
    W, H = 1000, 300
    fams = [('Decide', ['Agree', 'Change'], ['Engineering decision', 'Decided by the agent', 'Out of scope', 'Extra review', 'Done means']),
            ('Look', ['Looks right', 'Change (pin a spot)'], ['Mockup', 'A diagram', 'Look at the result']),
            ('Confirm', ['I confirm', 'Ask the agent to record it'], ['Only you can confirm']),
            ('Fix', ['Accept · Fix it', 'Fine · Ask why', 'Add · Skip it'], ['Found while checking', 'Decided while building', 'Add to the Plan']),
            ('Answer', ['In Your turn', 'Looks right · Suggest', 'a change · Reply'], ['The agent’s question', 'A question from your agent'])]
    cw, gap = 188, 15
    out = []
    for i, (name, ans, kinds) in enumerate(fams):
        x = i * (cw + gap)
        out.extend([
            card(c, (x, 0, cw, H - 4), stroke='cardline'),
            f'<rect x="{x}" y="0" width="{cw}" height="4" rx="2" fill="{c["amber"]}"/>',
            T(c, (x + 16, 34), name, size=16, fill='text', weight=700),
            T(c, (x + 16, 62), 'Answers', size=11, fill='dim', weight=700),
        ])
        for k, a in enumerate(ans):
            if name in ('Answer', 'Fix'):
                out.append(T(c, (x + 16, 84 + k * 18), a, size=12.5, fill='text', weight=600))
            else:
                out.append(abtn_svg(c, (x + 16, 72 + k * 32), a, primary=False, h=26, size=11.5, w=cw - 32))
        out.append(T(c, (x + 16, 168), 'Kinds', size=11, fill='dim', weight=700))
        for k, t in enumerate(kinds):
            out.append(T(c, (x + 16, 190 + k * 20), t, size=12.5, fill='muted'))
    return svg((W, H), ''.join(out), 'Five families of items, each with its own answers: Decide, Look, Confirm, Fix and Answer')


def decision_ill(c: Theme) -> str:
    W, H = 1000, 300
    b = [
        card(c, (0, 0, 620, 296)),
        T(c, (18, 28), 'Example · retrying a webhook', size=12, fill='dim', weight=600),
        T(c, (18, 52), 'Return the same result when a request is retried', size=14.5, fill='text', weight=650),
        f'<rect x="24" y="108" width="130" height="44" rx="9" fill="{c["bg"]}" stroke="{c["cardline"]}"/>',
        T(c, (89, 135), 'Retry arrives', size=13, fill='text', weight=600, anchor='middle'),
        arrow(c, (156, 130), (214, 130)),
        diamond(c, (244, 130), 33, fill='amberf', stroke='amber'),
        T(c, (244, 120), 'Already', size=11.5, fill='text', weight=600, anchor='middle'),
        T(c, (244, 134), 'handled', size=11.5, fill='text', weight=600, anchor='middle'),
        T(c, (244, 148), '?', size=11.5, fill='text', weight=600, anchor='middle'),
        curve(c, (277, 130), (420, 86), col='blue'),
        curve(c, (244, 160), (420, 200), col='muted'),
        T(c, (340, 98), 'yes', size=12, fill='blue', weight=600, anchor='middle'),
        T(c, (330, 202), 'no', size=12, fill='muted', weight=600, anchor='middle'),
        f'<rect x="422" y="62" width="176" height="48" rx="9" fill="{c["bluef"]}" stroke="{c["blue"]}" stroke-width="1.8"/>',
        T(c, (510, 91), 'Saved result', size=13, fill='text', weight=600, anchor='middle'),
        f'<rect x="422" y="178" width="176" height="48" rx="9" fill="{c["bg"]}" stroke="{c["cardline"]}"/>',
        T(c, (510, 207), 'Process request', size=13, fill='text', weight=600, anchor='middle'),
        f'<rect x="188" y="244" width="240" height="38" rx="10" fill="{c["bg"]}" stroke="{c["amberl"]}" stroke-width="1.5"/>',
        f'<path d="M244 196 L244 244" stroke="{c["amberl"]}" stroke-width="1.5" stroke-dasharray="3 3"/>',
        f'<circle cx="244" cy="196" r="5" fill="{c["amberf"]}" stroke="{c["amber"]}" stroke-width="1.8"/>',
        T(c, (208, 268), 'Ask agent', size=12, fill='amber', weight=600),
        card(c, (640, 0, 360, 296), stroke='amberl'),
        T(c, (658, 28), 'Conversation · editable draft', size=12, fill='dim', weight=600),
        f'<circle cx="676" cy="62" r="13" fill="{c["amberf"]}" stroke="{c["amber"]}" stroke-width="1.5"/>',
        T(c, (676, 66.5), 'A', size=11.5, fill='amber', weight=700, anchor='middle'),
        T(c, (698, 58), 'You', size=13, fill='text', weight=650),
    ]
    for i, t in enumerate(['Explain how a retried webhook', 'reuses the stored result.']):
        b.append(T(c, (658, 94 + i * 19), t, size=13, fill='text'))
    b.extend([
        f'<line x1="658" y1="140" x2="982" y2="140" stroke="{c["cardline"]}"/>',
        f'<circle cx="676" cy="170" r="13" fill="{c["bluef"]}" stroke="{c["blue"]}" stroke-width="1.5"/>',
        T(c, (676, 174.5), 'AI', size=10.5, fill='blue', weight=700, anchor='middle'),
        T(c, (698, 166), 'Context attached', size=13, fill='text', weight=650),
    ])
    for i, t in enumerate(['Plan · Retry handling · revision 3', 'Selected diagram and request']):
        b.append(T(c, (658, 202 + i * 19), t, size=13, fill='text'))
    b.append(abtn_svg(c, (658, 252), 'Send'))
    b.append(abtn_svg(c, (712, 252), 'Edit draft'))
    return svg((W, H), ''.join(b), 'An example retry decision diagram: Ask agent opens an editable contextual Conversation draft, which you explicitly send')


def diagnose_ill(c: Theme) -> str:
    W, H = 1000, 250
    b = []
    cols = [('When', 'blue'), ('Today', 'danger'), ('Expected', 'blue'), ('Must keep working', 'blue')]
    cw = 232
    for i, (t, col) in enumerate(cols):
        x = i * (cw + 24)
        b.append(card(c, (x, 0, cw, 190)))
        b.append(f'<rect x="{x}" y="0" width="{cw}" height="4" rx="2" fill="{c[col]}"/>')
        b.append(T(c, (x + 16, 34), t, size=15, fill='text', weight=650))
    lines = [['Someone opens', '/reports?page=2'], ['The page shows 49 of', '50 rows. The last one', 'is missing.'],
             ['Every page shows all', 'of its rows.'], ['Page size stays 50.', 'The first page does', 'not change.']]
    for i, ls in enumerate(lines):
        x = i * (cw + 24)
        for k, t in enumerate(ls):
            b.append(T(c, (x + 16, 66 + k * 20), t, size=13, fill='text' if i != 1 else 'danger', weight=500, mono=(i == 0 and k == 1)))
    b.append(T(c, (0, 220), 'The cause, found in the code before anything is planned: an off-by-one in the page query.', size=13, fill='muted'))
    b.append(T(c, (0, 240), 'Done means adds the checks the fix must pass, starting with a test that fails today.', size=13, fill='muted'))
    return svg((W, H), ''.join(b), 'A bug in the Plan: when it happens, what happens today, what is expected, and what must keep working')
