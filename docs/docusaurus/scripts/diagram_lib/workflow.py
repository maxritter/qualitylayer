"""Workflow step, slice, and pull-request diagrams."""
from .primitives import GATES, STEPS, STEPS_PR, T, Theme, arrow, button, card, curve, diamond, node, svg, vmark
from .task_window import task_example


def _track_node(c: Theme, x: float, step_info: tuple[str, str], state: str) -> list[str]:
    name, col = step_info
    gate = name in GATES
    if state == 'current':
        marker = diamond(c, (x, 52), 9, fill='amber', stroke='amber') if gate else f'<circle cx="{x}" cy="52" r="9" fill="{c[col]}"/>'
        return [
            f'<circle cx="{x}" cy="52" r="17" fill="{c[col]}" fill-opacity="0.16"/>',
            marker,
            T(c, (x, 88), name, size=13, fill='text', weight=700, anchor='middle'),
            T(c, (x, 106), 'This page', size=11, fill=col, weight=600, anchor='middle'),
        ]
    if state == 'past':
        marker = diamond(c, (x, 52), 5.5, fill='blue', stroke='blue') if gate else f'<circle cx="{x}" cy="52" r="6" fill="{c["blue"]}"/>'
    else:
        marker = diamond(c, (x, 52), 5.5, fill='bg', stroke='line') if gate else f'<circle cx="{x}" cy="52" r="6" fill="{c["bg"]}" stroke="{c["line"]}" stroke-width="2"/>'
    return [marker, T(c, (x, 88), name, size=12, fill='muted', weight=500, anchor='middle')]


def track(here: str):
    """The steps and the pull request on one line, with the page's own step highlighted."""
    def draw(c: Theme) -> str:
        W, H = 1000, 112
        xs = [112 + i * 258 for i in range(4)]
        cur = [n for n, _ in STEPS_PR].index(here)
        b = [
            T(c, (0, 16), 'The workflow', size=12, fill='muted', weight=600),
            f'<line x1="{xs[0]}" y1="52" x2="{xs[-1]}" y2="52" stroke="{c["line"]}" stroke-width="2"/>',
        ]
        if cur:
            b.append(f'<line x1="{xs[0]}" y1="52" x2="{xs[cur]}" y2="52" stroke="{c["blue"]}" stroke-width="2.5"/>')
        for i, step_info in enumerate(STEPS_PR):
            state = 'current' if i == cur else ('past' if i < cur else 'future')
            b.extend(_track_node(c, xs[i], step_info, state))
        return svg((W, H), ''.join(b), f'The workflow, with {here} highlighted')
    return draw


def _flow_cells(c: Theme, cx: list[float], bw: float, row_spec: tuple) -> list[str]:
    row_idx, label, col, y, cells = row_spec
    out = [T(c, (0, y + 28), label, size=15, fill=col, weight=700)]
    fill, stroke = ('amberf', 'amberl') if row_idx == 0 else ('card', 'cardline')
    for i, s in enumerate(cells):
        x = cx[i] - bw / 2
        if s is None:
            out.append(f'<rect x="{x}" y="{y}" width="{bw}" height="44" rx="10" fill="none" stroke="{c["off"]}" stroke-dasharray="4 4"/>')
            out.append(T(c, (cx[i], y + 27), 'Nothing to do', size=11.5, fill='dim', weight=500, anchor='middle'))
        else:
            out.append(f'<rect x="{x}" y="{y}" width="{bw}" height="44" rx="10" fill="{c[fill]}" stroke="{c[stroke]}"/>')
            out.append(T(c, (cx[i], y + 27), s, size=11.5, fill='text', weight=500, anchor='middle'))
    return out


def flow(c: Theme, pr: bool = False) -> str:
    """The three steps; with `pr`, the pull request as a fourth column (the README and the website count it)."""
    steps = STEPS_PR if pr else STEPS
    W, H = 1000, 280
    x0, cw, bw = (130, 216, 196) if pr else (130, 290, 260)
    cx = [x0 + i * cw + cw / 2 for i in range(len(steps))]
    b = [f'<line x1="{cx[0]}" y1="62" x2="{cx[-1]}" y2="62" stroke="{c["line"]}" stroke-width="2"/>']
    for i, (n, col) in enumerate(steps):
        b.append(T(c, (cx[i], 30), n, size=15, fill='text', weight=700, anchor='middle'))
        b.append(diamond(c, (cx[i], 62), 10) if n in GATES else f'<circle cx="{cx[i]}" cy="62" r="10" fill="{c[col]}"/>')
    you = ['Answer, approve the Plan', None, 'Approve the change'] + (['Merge it'] if pr else [])
    agent = ['Writes the Plan', 'Builds test first', 'Agents check it'] + (['Answers reviews'] if pr else [])
    b.extend(_flow_cells(c, cx, bw, (0, 'You', 'amber', 100, you)))
    b.extend(_flow_cells(c, cx, bw, (1, 'Your agent', 'blue', 166, agent)))
    ly = H - 8
    b.append(diamond(c, (x0 + 8, ly - 5), 6))
    b.append(T(c, (x0 + 24, ly), 'You approve here', size=13, fill='muted'))
    b.append(f'<circle cx="{x0 + 178}" cy="{ly - 5}" r="7" fill="{c["blue"]}"/>')
    b.append(T(c, (x0 + 192, ly), 'Your agent works on its own', size=13, fill='muted'))
    if pr:
        return svg((W, H), ''.join(b), 'The steps of a QualityLayer task: Plan, Implement, Verify and the pull request. You approve the Plan before any code and the finished change in Verify, and you merge the pull request; your agent does the rest')
    return svg((W, H), ''.join(b), 'The three steps of a QualityLayer task: Plan, Implement and Verify. You approve the Plan before any code and the finished change in Verify; your agent does the rest')


def _slice_card(c: Theme, rect: tuple[float, float, float], title: str, line2: tuple[str, str], check: str) -> str:
    x, y, w = rect
    text2, col2 = line2
    return ''.join([
        card(c, (x, y, w, 80), stroke='blue', sw=1.6),
        T(c, (x + 14, y + 24), title, size=13.5, fill='text', weight=650),
        T(c, (x + 14, y + 44), text2, size=12, fill=col2, weight=600 if col2 == 'amber' else 400),
        vmark(c, (x + 20, y + 61)),
        T(c, (x + 32, y + 66), check, size=11, fill='blue', weight=500, mono=True),
    ])


def slices(c: Theme) -> str:
    W, H = 1000, 292
    b = []
    for name, xa, xz, col in [('Implement', 0, 570, 'blue'), ('Verify', 600, 1000, 'violet')]:
        b.append(f'<rect x="{xa}" y="0" width="{xz - xa}" height="4" rx="2" fill="{c[col]}"/>')
        b.append(T(c, (xa, 26), name, size=15, fill=col, weight=650))
    b.append(_slice_card(c, (0, 74, 170), 'Slice 1 · Export', ('T1, T2, test first', 'muted'), 'tests · exit 0'))
    b.append(arrow(c, (172, 114), (198, 114)))
    b.append(_slice_card(c, (200, 74, 170), 'Slice 2 · Filter', ('T3, T4, test first', 'muted'), 'tests · exit 0'))
    b.append(arrow(c, (372, 114), (398, 114)))
    b.append(_slice_card(c, (400, 74, 170), 'Slice 3 · Reports', ('Risky: new mail service', 'amber'), 'tests · exit 0'))
    b.append(T(c, (0, 188), 'One session builds the slices in the Plan’s order and fixes what fails.', size=12.5, fill='muted'))
    b.append(node(c, (606, 44, 186, 80), 'Security review', ['Only when it crosses', 'a trust boundary'], col='cardline', dash=True))
    b.append(node(c, (606, 144, 186, 80), 'Project checks', ['Run once on the', 'committed build'], col='cardline'))
    b.append(curve(c, (792, 84), (812, 134), col='muted'))
    b.append(curve(c, (792, 184), (812, 134), col='muted'))
    b.append(node(c, (814, 94, 186, 80), 'Independent review', ['Adds missing tests,', 'checks every point'], col='violet', fill='violetf'))
    b.append(T(c, (W / 2, 258), 'An agent that did not write the code checks every point on the running program.', size=13, fill='muted', weight=400, anchor='middle'))
    b.append(T(c, (W / 2, 278), 'Fixes and focused rechecks run automatically; then the page is your review, and you approve the change.', size=13, fill='muted', weight=400, anchor='middle'))
    return svg((W, H), ''.join(b), 'Implement and Verify: one session builds the slices in order, test first, and fixes what fails; then a security review when the change crosses a trust boundary, the project checks, and an agent that did not write the code adds missing tests and checks every point on the running program; after fixes and focused rechecks the Verify page is your review')


def plan_ill(c: Theme) -> str:
    return task_example(c, 0, [
        ('heading', 'Interface'), ('row', 'Read the full-size artifact and comment on a spot.'),
        ('heading', 'Engineering decisions'), ('agreed', '✓ The Plan determines what each agent builds.'),
        ('heading', 'Done means · proposed'), ('row', '1 · Every setting names what it changes.'),
        ('row', '2 · A risky Plan gets a second opinion.'),
        ('heading', 'Slices and checks'), ('row', '1 · Simplify the settings · types, tests and build.'),
        ('row', '2 · Keep every link working · end-to-end scenarios.'),
        ('proof', 'Plan review recorded · read the evidence for who checked it'),
    ], [], 'Ready for review')


def implement_ill(c: Theme) -> str:
    return task_example(c, 1, [
        ('heading', 'The build'), ('agreed', '✓ Slice 1 · Clearer settings · committed'),
        ('row', 'Slice 2 · Sign-in · waiting for your login'),
        ('row', 'Slice 3 · Links · building and checking'),
        ('heading', 'Decided while building'), ('row', 'Kept the current settings file · Ask why'),
        ('heading', 'Checks'), ('proof', 'Slice 1 · tests, types and lint passed'),
        ('row', 'Other slices keep building while your login waits.'),
    ], [
        ('Slice 2 · Only you can provide', ['Sign in to the test service.', 'Set the login in your environment.'], ['Done, it’s set']),
    ], 'Building slice 3')


def verify_ill(c: Theme) -> str:
    return task_example(c, 2, [
        ('heading', 'Done means · 1'), ('row', 'Every setting names what it changes.'),
        ('proof', 'Passed · scenario 1 · open output and screenshot'),
        ('heading', 'Done means · 2'), ('row', 'A risky Plan gets a second opinion.'),
        ('row', 'Checking now · scenario 2 on the running program'),
        ('heading', 'Done means · 3'), ('row', 'Every link opens the right page.'),
        ('row', 'Waiting · scenarios 3 and 4'),
        ('heading', 'Project checks and agent reviews'), ('proof', 'Types, lint and tests passed · open the evidence'),
    ], [], 'Checking point 2')


def review_ill(c: Theme) -> str:
    """Verify turned to you: every point settled, your questions and the one approval."""
    return task_example(c, 2, [
        ('heading', 'What changed'), ('row', 'Settings are clearer and links keep their destination.'),
        ('heading', 'How to try it'), ('row', 'Open Settings, then follow a link to a task.'),
        ('heading', 'Done means · 1'), ('row', 'Every setting names what it changes.'),
        ('proof', 'Passed · scenario 1 · output and screenshot'),
        ('heading', 'Done means · 2'), ('row', 'A risky Plan gets a second opinion.'),
        ('proof', 'Passed · scenario 2 · recorded command'),
        ('heading', 'Done means · 3'), ('row', 'Every link opens the right page.'),
        ('proof', 'Passed · scenarios 3 and 4 · evidence available'),
    ], [
        ('Only you can confirm · point 1', ['Do the settings read clearly to you?'], ['I confirm', 'Change']),
        ('Final approval', ['After settling the open items:', 'approve and open a pull request.'], ['Approve only']),
    ], 'Waits for you')


def comments_ill(c: Theme) -> str:
    W, H = 1000, 330
    b = [card(c, (0, 0, 640, 326)), T(c, (20, 32), 'Review the change', size=18, fill='text', weight=650)]
    for y, text in [(64, 'Read the code and the recorded acceptance test.'),
                    (96, 'Select a passage or code line and choose Ask agent.'),
                    (128, 'The context opens as an editable Conversation draft.'),
                    (160, 'Check it, edit it, then explicitly send it.'),
                    (218, 'Approve the displayed change separately.'),
                    (250, 'A request never approves scope or the final approval.')]:
        b.append(T(c, (20, y), text, size=14, fill='text'))
    b.extend([
        card(c, (660, 0, 340, 326)),
        T(c, (678, 30), 'Conversation', size=15, fill='text', weight=650),
        T(c, (678, 68), 'Draft · settings.tsx:42', size=12, fill='muted'),
        T(c, (678, 110), 'Explain why this check runs here.', size=13, fill='text'),
        T(c, (678, 146), 'Selected context and revision attached', size=11.5, fill='muted'),
        button(c, (678, 190, 110, 34), 'Send', primary=True),
        T(c, (678, 256), 'Or use the explicit terminal handoff.', size=12, fill='muted'),
    ])
    return svg((W, H), ''.join(b), 'Ask agent prepares an editable contextual draft in Conversation; you send it explicitly and approve separately')


def pull_request_ill(c: Theme) -> str:
    """After Verify: QualityLayer opens the pull request, follows it, and brings back what waits; you merge."""
    W, H = 1000, 316
    b = []
    top = [(0, 'You approve', ['Approve and open', 'a pull request'], 'amber', 'amberf'),
           (207, 'It opens on GitHub', ['From your branch, with', 'the change as its text'], 'blue', 'bluef'),
           (414, 'QualityLayer follows it', ['Checks and reviewers,', 'every two minutes'], 'cardline', 'card'),
           (621, 'You merge it', ['On GitHub, your own way.', 'QualityLayer never merges'], 'amber', 'amberf'),
           (828, 'The task closes', ['Its documents and its', 'cost stay in your repo'], 'violet', 'card')]
    for x, title, sub, col, fill in top:
        sw = 1 if col == 'cardline' else 1.8
        b.append(f'<rect x="{x}" y="20" width="172" height="84" rx="12" fill="{c[fill]}" stroke="{c[col]}" stroke-width="{sw}"/>')
        b.append(T(c, (x + 14, 46), title, size=14, fill='text', weight=650))
        for i, line in enumerate(sub):
            b.append(T(c, (x + 14, 68 + i * 17), line, size=12, fill='muted'))
    for x in (172, 379, 586, 793):
        b.append(arrow(c, (x + 2, 62), (x + 33, 62)))
    loop = [(207, 'Your turn', ['The thread or the failing', 'check, with a command'], 'amber', 'amberf'),
            (414, 'Open the task', ['Review the feedback', 'beside your agent'], 'blue', 'bluef'),
            (621, 'Push the fix', ['One click from you.', 'It pushes nothing by itself'], 'amber', 'amberf')]
    for x, title, sub, col, fill in loop:
        b.append(f'<rect x="{x}" y="166" width="172" height="84" rx="12" fill="{c[fill]}" stroke="{c[col]}" stroke-width="1.8"/>')
        b.append(T(c, (x + 14, 192), title, size=14, fill='text', weight=650, mono=title.startswith('/')))
        for i, line in enumerate(sub):
            b.append(T(c, (x + 14, 214 + i * 17), line, size=12, fill='muted'))
    b.extend([
        arrow(c, (381, 208), (412, 208)),
        arrow(c, (588, 208), (619, 208)),
        f'<path d="M470 106 V126 H293 V164" fill="none" stroke="{c["muted"]}" stroke-width="1.8"/>',
        f'<path d="M288 157 l5 7 l5 -7" fill="none" stroke="{c["muted"]}" stroke-width="1.8"/>',
        f'<path d="M707 166 V140 H560 V108" fill="none" stroke="{c["muted"]}" stroke-width="1.8" stroke-dasharray="4 4"/>',
        f'<path d="M555 115 l5 -7 l5 7" fill="none" stroke="{c["muted"]}" stroke-width="1.8"/>',
        T(c, (207, 282), 'This loop runs each time a thread, a request for changes or a failing check arrives.', size=12, fill='dim'),
        T(c, (207, 300), 'GitHub then runs the checks again, and QualityLayer keeps following.', size=12, fill='dim'),
    ])
    return svg((W, H), ''.join(b), 'The pull request step: you approve and QualityLayer opens the pull request on GitHub and follows its checks and reviewers. When a thread, a request for changes or a failing check arrives, it waits in Your turn; your agent goes through it with you and you push the fix. You merge the pull request yourself, and the task closes')
