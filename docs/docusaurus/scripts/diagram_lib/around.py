"""Surrounding App, agent, architecture, privacy, and artifact diagrams."""
from .primitives import T, Theme, arrow, bars, card, curve, diamond, lock, node, pill, svg, switch


def band_ill(c: Theme) -> str:
    W, H = 1000, 250
    b = [card(c, (0, 0, 1000, 246)), T(c, (18, 28), 'Claude Code', size=12, fill='dim', weight=600)]
    rows = [('While it waits for you', 'amber', 'amberf', 'QL · Settings cleanup · Plan · waits for you in the App: Approve the Plan?'),
            ('While it builds', 'blue', 'bluef', 'QL · Settings cleanup · Implement · slice 3 building'),
            ('When your agent asks', 'amber', 'amberf', 'QL · Settings cleanup · a question waits for you')]
    for i, (label, col, fill, text) in enumerate(rows):
        y = 46 + i * 58
        b.extend([
            T(c, (18, y + 25), label, size=12.5, fill='muted', weight=500),
            f'<rect x="190" y="{y}" width="790" height="40" rx="6" fill="{c[fill]}"/>',
            f'<rect x="190" y="{y}" width="4" height="40" fill="{c[col]}"/>',
            T(c, (208, y + 25), text, size=12.5, fill='text', weight=500, mono=True),
        ])
        if i == 1:
            b.append(f'<rect x="846" y="{y + 16}" width="120" height="8" rx="4" fill="{c["line"]}"/>')
            b.append(f'<rect x="846" y="{y + 16}" width="66" height="8" rx="4" fill="{c[col]}"/>')
    b.append(T(c, (190, 230), '>', size=14, fill='muted', weight=600, mono=True))
    b.append(f'<rect x="206" y="218" width="8" height="16" fill="{c["muted"]}"/>')
    return svg((W, H), ''.join(b), 'The band above the Claude Code prompt: what waits for you in the App, how the build runs, or your agent’s questions for you')


def attention_ill(c: Theme) -> str:
    W, H = 1000, 400
    b = []
    cols = [(640, 'The App'), (840, 'Claude Code band')]
    for x, t in cols:
        b.append(T(c, (x, 20), t, size=12.5, fill='text', weight=650, anchor='middle'))
    rows = [('A Plan or a change waits for you', 'you', (1, 1)),
            ('Your agent asks a question', 'you', (1, 1)),
            ('A run stops early', 'you', (1, 1)),
            ('Agent progress and checks', 'never', (0, 0))]
    for i, (t, kind, hits) in enumerate(rows):
        y = 34 + i * 38
        b.append(f'<line x1="0" y1="{y}" x2="{W}" y2="{y}" stroke="{c["cardline"]}"/>')
        b.append(T(c, (0, y + 24), t, size=13, fill='text' if kind != 'never' else 'dim', weight=500))
        for (x, _), on in zip(cols, hits):
            if on:
                b.append(f'<circle cx="{x}" cy="{y + 19}" r="6" fill="{c["blue"]}"/>')
            else:
                b.append(f'<line x1="{x - 6}" y1="{y + 19}" x2="{x + 6}" y2="{y + 19}" stroke="{c["off"]}" stroke-width="2"/>')
        if kind == 'never':
            b.append(T(c, (700, y + 24), 'never', size=12, fill='dim', weight=600, anchor='middle'))
    b.append(T(c, (0, 392), 'A channel speaks only when a person can act. The band and the sidebar show progress quietly.', size=12.5, fill='muted'))
    return svg((W, H), ''.join(b), 'Who hears about what: the App and the Claude Code band speak only when a person can act, and agent progress and checks never notify')


def feedback_ill(c: Theme) -> str:
    W, H = 1000, 330
    b = []
    for i, t in enumerate(['Feedback in the sidebar', 'Send feedback in ⌘K', 'Report this on an error']):
        y = 20 + i * 54
        b.append(f'<rect x="0" y="{y}" width="200" height="40" rx="9" fill="{c["bg"]}" stroke="{c["cardline"]}"/>')
        b.append(T(c, (100, y + 25), t, size=12.5, fill='text', weight=500, anchor='middle'))
        b.append(curve(c, (202, y + 20), (250, 118), col='line'))
    b.extend([
        card(c, (252, 0, 330, 220)),
        T(c, (270, 28), 'Send feedback', size=14, fill='text', weight=650),
        pill(c, (270, 40), 'Something doesn’t work', col='blue', w=160, fill='bluef', stroke='blue'),
        pill(c, (438, 40), 'An idea', col='muted', w=70),
        f'<rect x="270" y="74" width="294" height="50" rx="8" fill="{c["bg"]}" stroke="{c["cardline"]}"/>',
        bars(c, (282, 88), [240, 170], gap=14, h=6),
        T(c, (270, 148), 'Screenshots: paste, drop or choose, up to 5', size=12, fill='muted'),
        switch(c, (270, 160), True),
        T(c, (306, 173), 'Include diagnostics', size=12.5, fill='text', weight=500),
        T(c, (440, 173), 'Show what is sent', size=12, fill='blue', weight=600),
        T(c, (270, 204), 'From Priya Shah · from your Business licence', size=12, fill='dim', weight=500),
        arrow(c, (584, 110), (650, 110)),
        node(c, (652, 60, 170, 100), 'qualitylayer.dev', ['Checks your licence', 'or trial, rate limits'], col='cardline'),
        arrow(c, (824, 110), (850, 110)),
        node(c, (852, 60, 148, 100), 'Private issue', ['One per report,', 'reference QL-128'], col='blue', fill='bluef'),
        f'<rect x="252" y="244" width="748" height="64" rx="10" fill="{c["amberf"]}" stroke="{c["amberl"]}" stroke-opacity="0.7"/>',
        T(c, (270, 270), 'Offline', size=12, fill='amber', weight=700),
        T(c, (330, 270), 'The report is saved on this computer and sent by itself when you are back online.', size=12.5, fill='text', weight=500),
        T(c, (270, 292), 'Diagnostics never include code, plan text, task titles, repository names or file paths.', size=12.5, fill='muted'),
    ])
    return svg((W, H), ''.join(b), 'Feedback: from the sidebar, the command box or an error, one sheet with your text, screenshots and diagnostics you can read first; it goes to a private issue, and offline it waits on your computer')


def agents_other_ill(c: Theme) -> str:
    W, H = 1000, 250
    b = [
        node(c, (0, 60, 250, 130), 'Another coding agent', ['Any agent that can run', 'shell commands'], col='cardline'),
        curve(c, (252, 100), (330, 60), col='line'),
        curve(c, (252, 150), (330, 190), col='line'),
        node(c, (332, 20, 300, 80), 'The command line', ['qualitylayer on the agent’s PATH', 'The App sets this up for you'], col='blue', fill='bluef'),
        node(c, (332, 150, 300, 80), 'One prompt from the App', ['+ New, then In my own agent', 'copies the prompt for your agent'], col='blue', fill='bluef'),
        curve(c, (634, 60), (700, 120), col='blue'),
        curve(c, (634, 190), (700, 130), col='blue'),
        node(c, (702, 70, 298, 110), 'The same steps', ['It asks for the next step and records', 'the checks. You decide in the App.'], col='amber', fill='amberf'),
    ]
    return svg((W, H), ''.join(b), 'Connecting another coding agent: any agent that runs shell commands needs the qualitylayer command on its path and one prompt from the App; then it follows the same steps and you decide in the App')


def agents_mix_ill(c: Theme) -> str:
    W, H = 1000, 110
    b = [
        node(c, (0, 0, 235, H), 'Plan with Claude Code', ['Asks you, reads the code,', 'writes the Plan'], col='blue', fill='bluef'),
        arrow(c, (237, H / 2), (273, H / 2)),
        node(c, (275, 0, 190, H), 'You approve', ['the Plan in the App'], col='amber', fill='amberf'),
        arrow(c, (467, H / 2), (503, H / 2)),
        node(c, (505, 0, 235, H), 'Build with your agent', ['Another agent, for example', 'one on a local model'], col='blue', fill='bluef'),
        arrow(c, (742, H / 2), (778, H / 2)),
        node(c, (780, 0, 220, H), 'Same checks', ['QualityLayer runs them,', 'then you approve', 'the finished change'], col='violet', fill='violetf'),
    ]
    return svg((W, H), ''.join(b), 'Plan with Claude Code, approve the Plan in the App, build with another agent such as one on a local model, then QualityLayer runs the same checks and you approve the finished change')


def firsttask_ill(c: Theme) -> str:
    """The first task left to right: three moves in Plan, the agents' Implement and Verify, then the merge."""
    w, gap, y, h = 134, 18, 44, 156
    W, H = 6 * w + 5 * gap, 240
    moves = [('amber', 'You', 'Describe', ['the change'], False),
             ('amber', 'You', 'Answer', ['the questions'], False),
             ('amber', 'You', 'Approve', ['the Plan'], True),
             ('blue', 'Agents', 'Implement', ['build it', 'test first'], False),
             ('violet', 'Agents, you', 'Verify', ['agents check,', 'you review', 'and approve'], True),
             ('blue', 'You', 'Merge', ['the pull', 'request'], False)]
    fills = {'amber': 'amberf', 'blue': 'bluef', 'violet': 'violetf'}
    b = []
    for name, col, first, last in [('Plan', 'amber', 0, 2), ('Implement', 'blue', 3, 3), ('Verify', 'violet', 4, 4), ('Pull request', 'blue', 5, 5)]:
        x1, x2 = first * (w + gap), last * (w + gap) + w
        b.append(f'<line x1="{x1}" y1="26" x2="{x2}" y2="26" stroke="{c[col]}" stroke-width="3" stroke-linecap="round"/>')
        b.append(T(c, ((x1 + x2) / 2, 16), name, size=16, fill=col, weight=700, anchor='middle'))
    for i, (col, who, title, lines, gate) in enumerate(moves):
        x = i * (w + gap)
        b.append(card(c, (x, y, w, h), stroke=col, fill=fills[col], sw=2))
        b.append(T(c, (x + 16, y + 30), who, size=14, fill=col, weight=700))
        if gate:
            b.append(diamond(c, (x + w - 17, y + 25), 7))
        b.append(T(c, (x + 16, y + 66), title, size=19, fill='text', weight=700))
        for k, line in enumerate(lines):
            b.append(T(c, (x + 16, y + 94 + k * 21), line, size=15, fill='muted'))
        if i < 5:
            b.append(arrow(c, (x + w + 3, y + h / 2), (x + w + gap - 3, y + h / 2)))
    ly = H - 8
    b.append(diamond(c, (8, ly - 5), 6))
    b.append(T(c, (24, ly), 'Your approval', size=15, fill='muted'))
    return svg((W, H), ''.join(b), 'Your first task: in Plan you describe the change, answer the questions and approve the Plan; agents implement it test first; in Verify agents check it, then you review and approve; you merge the pull request')


def update_ill(c: Theme) -> str:
    W, H = 1000, 190
    b = []
    cards = [('Checks daily', ['Once a day, in', 'the background'], 'cardline', None),
             ('Downloads quietly', ['Checked against the', 'release signature'], 'cardline', None),
             ('A line in the sidebar', ['Update ready, with the', 'release notes one click away'], 'amber', 'amberf'),
             ('Restart and update', ['The App reopens on', 'the page you were on'], 'blue', 'bluef')]
    for i, (t, s, col, fill) in enumerate(cards):
        x = i * 256
        b.append(node(c, (x, 0, 230, 96), t, s, col=col, fill=fill))
        if i < 3:
            b.append(arrow(c, (x + 232, 48), (x + 254, 48)))
    b.extend([
        T(c, (0, 134), 'Agents keep working and keep calling the same command. On Windows the update waits', size=13, fill='muted'),
        T(c, (0, 154), 'for running commands. With the command line only, run', size=13, fill='muted'),
        T(c, (390, 154), 'qualitylayer update', size=13, fill='blue', weight=500, mono=True),
    ])
    return svg((W, H), ''.join(b), 'Updating the App: it checks daily and downloads in the background, a line in the sidebar says an update is ready, and Restart and update reopens the App on the same page')


def privacy_ill(c: Theme) -> str:
    W, H = 1000, 300
    b = [card(c, (0, 0, 420, 296)), T(c, (18, 30), 'Stays on your computer', size=14, fill='text', weight=650)]
    for i, t in enumerate(['Your code and the diff', 'Every plan document', 'Build evidence and logs', 'The App and its cost view']):
        y = 52 + i * 32
        b.append(f'<path d="M{24} {y + 8} l4 4 l8 -9" fill="none" stroke="{c["muted"]}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>')
        b.append(T(c, (46, y + 13), t, size=13, fill='text', weight=500))
    b.extend([
        T(c, (18, 200), 'Your agent sends your code to its own provider,', size=12, fill='muted'),
        T(c, (18, 218), 'as it always does. QualityLayer does not change that.', size=12, fill='muted'),
        card(c, (440, 0, 560, 100)),
        T(c, (458, 28), 'Daily licence check · qualitylayer.dev', size=14, fill='text', weight=650),
        T(c, (458, 50), 'The licence and this machine\'s identity confirm access.', size=12.5, fill='muted'),
        T(c, (458, 68), 'App updates contact QualityLayer; workflow texts are local.', size=12.5, fill='muted'),
        T(c, (458, 89), 'No usage events are queued or sent.', size=12, fill='text', weight=500),
        card(c, (440, 108, 560, 84)),
        T(c, (458, 134), 'Your own remote connection', size=14, fill='text', weight=650),
        T(c, (458, 156), 'Own machines and paired browsers use local authentication.', size=12.5, fill='muted'),
        T(c, (458, 176), 'No hosted task, artifact or memory workspace.', size=12.5, fill='text', weight=600),
        card(c, (440, 200, 560, 96)),
        T(c, (458, 228), 'Feedback · only when you send it', size=14, fill='text', weight=650),
        T(c, (458, 249), 'Your text, the screenshots you add and diagnostics you can read first,', size=12.5, fill='muted'),
        T(c, (458, 267), 'in a private issue. Never code, plan or document text, task titles,', size=12.5, fill='text', weight=600),
        T(c, (458, 285), 'repository or branch names, or file paths.', size=12.5, fill='text', weight=600),
    ])
    return svg((W, H), ''.join(b), 'What stays on your computer, what the licence check sends, your personal remote access, and what a feedback report sends to a private issue')


def architecture(c: Theme) -> str:
    """How the parts fit: your agent, the command line, the Markdown files and the App on your computer; your chosen agent contacts its provider; ancillary services stay separate."""
    W, H = 1100, 380
    b = [
        f'<rect x="0" y="0" width="720" height="{H}" rx="16" fill="none" stroke="{c["cardline"]}" stroke-width="1.5" stroke-dasharray="6 5"/>',
        T(c, (20, 30), 'Your computer', size=13, fill='muted', weight=650),
        card(c, (20, 52, 680, 192), stroke='blue', fill='bg'),
        T(c, (38, 80), 'QualityLayer App or browser', size=15, fill='text', weight=650),
        node(c, (38, 100, 306, 124), 'Your task', ['Questions, diagrams and artifacts', 'Read the Plan, ask your agent', 'and approve the change'], col='cardline'),
        node(c, (364, 100, 318, 124), 'Agent sidebar', ['Claude Code, Codex, Cursor, Grok,', 'Antigravity, Pi, OpenCode, GitHub Copilot', 'Your agent’s own conversation', 'and subscription'], col='cardline'),
        node(c, (20, 278, 328, 76), 'CLI integration', ['Also connects external agents', 'in a terminal, VS Code or another IDE'], col='cardline'),
        node(c, (372, 278, 328, 76), 'Task files in your repository', ['Plans, decisions and recorded checks'], col='cardline'),
        f'<path d="M184 278 V258 H536 V278" fill="none" stroke="{c["muted"]}" stroke-width="1.8"/>',
        f'<path d="M536 258 V246" fill="none" stroke="{c["muted"]}" stroke-width="1.8"/>',
        arrow(c, (702, 174), (818, 174), col='blue'),
        node(c, (820, 74, 260, 124), 'Your chosen agent provider', ['Your own account and settings', 'Relevant request and code context'], col='cardline'),
        node(c, (820, 228, 260, 124), 'QualityLayer services', ['Licence, trial, billing and updates', 'Reports you choose to send', 'No hosted project workspace'], col='cardline'),
    ]
    return svg((W, H), ''.join(b), 'QualityLayer keeps tasks, artifacts and memories on your machines. Your agent uses its provider; licence, billing, updates and optional support are separate services')


def artifacts_flow(c: Theme) -> str:
    """What an artifact is: you ask, your agent draws one page, the App shows it, you comment, it changes the same page."""
    W, H = 1000, 236
    steps = [('You', 'amber', 'amberf', 'Ask your agent', ['“Mock up the', 'settings page”']),
             ('Your agent', 'blue', 'bluef', 'Draws one page', ['One HTML file', 'in your project']),
             ('The App', 'cardline', 'card', 'Lists it', ['Inside Files,', 'with a New dot']),
             ('You', 'amber', 'amberf', 'Open it full size', ['Click a spot, say', 'what should change']),
             ('Your agent', 'blue', 'bluef', 'Changes it', ['Edits the same page', 'and says what changed']),
             ('The App', 'cardline', 'card', 'Shows the update', ['A quiet notice.', 'Always the latest'])]
    b = []
    for i, (who, col, fill, t, s) in enumerate(steps):
        x = i * 168
        b.append(card(c, (x, 0, 156, 118), stroke=col, fill=fill if col != 'cardline' else 'card', sw=1.5 if col != 'cardline' else 1))
        b.append(T(c, (x + 14, 24), who, size=11.5, fill=col if col != 'cardline' else 'muted', weight=650))
        b.append(T(c, (x + 14, 50), t, size=13.5, fill='text', weight=650))
        for k, line in enumerate(s):
            b.append(T(c, (x + 14, 74 + k * 18), line, size=12, fill='muted'))
        if i < 5:
            b.append(arrow(c, (x + 157, 59), (x + 167, 59)))
    b.extend([
        f'<path d="M{3 * 168 + 78} 120 V138 H{5 * 168 + 78} V120" fill="none" stroke="{c["muted"]}" stroke-width="1.5" stroke-dasharray="4 4"/>',
        T(c, (4 * 168 + 78, 156), 'and again, until it looks right', size=12, fill='muted', weight=500, anchor='middle'),
        f'<rect x="0" y="180" width="996" height="50" rx="10" fill="{c["card"]}" stroke="{c["cardline"]}"/>',
        lock(c, (18, 197)),
        T(c, (38, 210), 'Your choice.', size=13, fill='text', weight=650),
        T(c, (136, 210), 'Artifacts stay on your machines. Ask agent prepares a draft; you review and send it.', size=12.5, fill='muted'),
    ])
    return svg((W, H), ''.join(b), 'Artifacts: ask your agent, review its page and comment on a spot; artifacts stay local and contextual requests open an editable draft')
