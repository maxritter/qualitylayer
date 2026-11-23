#!/usr/bin/env python3
"""QualityLayer concept diagrams: one source, a light and a dark SVG each.

Used by the README and the docs. Regenerate after a change:
    python3 scripts/diagrams.py [static/img/diagrams]
"""
import os
import sys

from diagram_lib.around import (
    agents_mix_ill,
    agents_other_ill,
    architecture,
    artifacts_flow,
    attention_ill,
    band_ill,
    feedback_ill,
    firsttask_ill,
    privacy_ill,
    update_ill,
)
from diagram_lib.guides import decision_ill, diagnose_ill, files_ill, home_ill, install_ill, items_ill, peers, remote_ill
from diagram_lib.primitives import STEPS_PR, Theme
from diagram_lib.workflow import comments_ill, flow, implement_ill, plan_ill, pull_request_ill, review_ill, slices, track, verify_ill

OUT = sys.argv[1] if len(sys.argv) > 1 else 'static/img/diagrams'

THEMES: dict[str, Theme] = {
    'light': dict(text='#1f2328', muted='#59636e', dim='#656d76', line='#d0d7de', card='#f6f8fa', cardline='#d0d7de',
                  bg='#ffffff', blue='#2076c5', blueink='#1a649f', bluef='#e8f1fb', violet='#6f4fc2',
                  violetf='#f0ebfb', amber='#9a5b00', amberf='#fff4dc', amberl='#e0a43a', ok='#6f4fc2',
                  off='#d8dee4', danger='#cf222e', onblue='#ffffff'),
    'dark': dict(text='#e6edf3', muted='#9198a1', dim='#8b949e', line='#3d444d', card='#151b23', cardline='#3d444d',
                 bg='#0d1117', blue='#5da3e5', blueink='#5da3e5', bluef='#132235', violet='#b49aed',
                 violetf='#1e1830', amber='#e8b04f', amberf='#2a2112', amberl='#b07a1c', ok='#b49aed',
                 off='#30363d', danger='#f85149', onblue='#0d1117'),
}

DRAWINGS = [
    ('architecture', architecture),
    ('flow-pr', lambda c: flow(c, pr=True)),
    ('slices', slices),
    ('home', home_ill),
    ('items', items_ill),
    ('decision', decision_ill),
    ('implement', implement_ill),
    ('diagnose', diagnose_ill),
    ('plan', plan_ill),
    ('verify', verify_ill),
    ('review', review_ill),
    ('comments', comments_ill),
    ('pull-request', pull_request_ill),
    ('band', band_ill),
    ('attention', attention_ill),
    ('feedback', feedback_ill),
    ('agents-other', agents_other_ill),
    ('agents-mix', agents_mix_ill),
    ('peers', peers),
    ('install', install_ill),
    ('remote', remote_ill),
    ('firsttask', firsttask_ill),
    ('update', update_ill),
    ('files', files_ill),
    ('privacy', privacy_ill),
    ('artifacts', artifacts_flow),
]
DRAWINGS += [(f'track-{n.lower().replace(" ", "-")}', track(n)) for n, _ in STEPS_PR]

os.makedirs(OUT, exist_ok=True)
for name, fn in DRAWINGS:
    for theme, c in THEMES.items():
        with open(os.path.join(OUT, f'{name}-{theme}.svg'), 'w') as f:
            # Full-size links open the SVG alone, without the article's themed background.
            f.write(fn(c).replace('<svg ', f'<svg style="background:{c["bg"]}" ', 1))
print('ok')
