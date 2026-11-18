// The shell: left sidebar, top bar, the step's own track, right sidebar (Files · Feedback),
// the status panel, notifications, the cost and share popovers, ⌘K and dialogs.
(function () {
  const QL = (window.QL = window.QL || {});
  const { useState, useEffect, useRef } = React;
  const { Icon, Mark, Logo, Btn, IconBtn, Popover, Resizer, AgentChip, fmt, Pips, Cmd, Seg, Select, Tile, Origin } = QL;
  // App hints name its native-window shortcut; this artifact's browser keeps its own keys.
  const navigationHint = (label, key) => label + " · " + (/Mac/.test(navigator.platform) ? "⌘" : "Ctrl+") + key;
  // The model's finer moments, in order, inside the three steps: questions and reading the code are the Plan's, writing
  // the cards Implement's, the person's review Verify's. Every name a person reads is the step's (STEP_LABEL).
  const STEPS = ["discuss", "research", "plan", "outline", "implement", "verify", "review"];
  const STEP_LABEL = { discuss: "Plan", research: "Plan", plan: "Plan", outline: "Implement", implement: "Implement", verify: "Verify", review: "Verify" };
  /** The two steps where the person approves: the Plan before any code, the change before it ships. */
  const APPROVES = { plan: "You approve the Plan here, the one approval before any code", review: "You approve the change here, before it ships" };

  /* ── left sidebar ──
     Top row: hide · logo + word · bell · New. Three places without subtitles (their words are the tooltips): Home, Team, Artifacts.
     Then the list under "Projects" (or "Tasks" when grouped by status) with Find, the View menu and Add a project beside it:
     a header per project (fold chevron, tile, mono name; folded: what waits on you, else a working ring, else the open count;
     + and ⋯ on hover), its open tasks indented under it, one fold row for what shipped, a line for a project with nothing open,
     and the hidden projects folded at the bottom. As src/ui/sidebar/ProjectList.tsx draws it (the built App wins over the boards).
     Foot: update line only when true · you · Settings, Docs, Theme · Feedback (with its word while the pane is wide enough). */
  const AGENT_WORD = { claude: "Claude Code", codex: "Codex", pi: "Pi", opencode: "OpenCode", cursor: "Cursor", grok: "Grok", antigravity: "Antigravity", copilot: "GitHub Copilot" };
  const SHOW_WORD = { "": "All open", you: "What needs you", running: "Running", shipped: "Shipped" };
  const NOTHING_WORD = { "": "matches", you: "needs you", running: "is running", shipped: "shipped" };
  const PAST_SHOWN = 12;
  const NAV_ACTIVITY = [{ value: "any", label: "Any time" }, { value: "24h", label: "Last 24 hours" }, { value: "3d", label: "Last 3 days" }, { value: "7d", label: "Last 7 days" }];
  const NAV_WINDOW = { "24h": 86400000, "3d": 259200000, "7d": 604800000 };
  const activityOf = (app) => app.s.sidebarActivity || "any";
  function navRecent(t, period) {
    if (period === "any") return true;
    const age = QL.AgentFacts.factsOf(t).age;
    const parsed = /^(\d+)\s*(s|min|h|d)$/.exec(age || "");
    const elapsed = age === "now" ? 0 : parsed ? Number(parsed[1]) * { s: 1000, min: 60000, h: 3600000, d: 86400000 }[parsed[2]] : Infinity;
    if (elapsed <= NAV_WINDOW[period]) return true;
    return t.group !== "shipped" && t.group !== "archived" && (t.mark === "work" || t.mark === "quiet" || t.also || t.alsoRunning);
  }
  // The step a row names is one of the three (QL.STEP3 folds the model's finer stages); other ends keep their word.
  const step3 = (word) => QL.STEP3_LABEL[QL.STEP3[String(word || "").toLowerCase()]];
  const navStage = (t) => t.earlier ? "Earlier workflow" : t.group === "archived" ? "Archived" : t.group === "shipped" ? (t.approved ? "Approved" : "Shipped") : t.id === "billing" && window.QL_CHAT_PREVIEW ? "Chat" : step3(t.step) || step3(t.end) || t.end || t.work || "Stage unavailable";
  /** The third line's step: the current step's mark from the header's three icons, in the tone of whose move it is (the App's RowMeta).
      A chat, an archived or handed-back task keeps its word; an earlier-workflow task says so. */
  const VM_MARK = { you: "you", running: "work", shipped: "done" };
  const NAV_TONE = { you: "you", work: "work", quiet: "quiet", stop: "stop", err: "stop", done: "done" };
  const navStrip = (t, stage) => {
    if (t.earlier) return <span className="nav-stage">Earlier workflow</span>;
    const raw = t.group === "archived" || stage === "Chat" ? null : String(t.step || t.end || stage).toLowerCase();
    const shipped = t.group === "shipped";
    const step = raw && QL.STEP3[raw];
    if (!shipped && !step) return <span className="nav-stage">{stage}</span>;
    const id = shipped ? "verify" : step;
    const tone = shipped ? "done" : NAV_TONE[t.mark] || "done";
    const words = (shipped ? stage : QL.STEP3_LABEL[id]) + (shipped ? "" : ", " + (t.mark === "you" ? "needs you" : t.mark === "work" ? "agent working" : t.mark === "quiet" ? "quiet" : t.mark === "done" ? "done" : "stopped"));
    return <span className="tm-step" data-testid="task-item-step"><QL.StepMark step={id} tone={tone} title={words} named /></span>;
  };
  /** Every badge counts what its destination lists: Home and the task-list toggle the rows of Needs you, Team its My attention tab. */
  const needsYouOf = (app) => app.v.yourTurnCount || 0;
  const navStatus = (t) => {
    const stage = navStage(t);
    const words = t.sub.slice(0, stage.length + 3).toLowerCase() === (stage + " · ").toLowerCase() ? t.sub.slice(stage.length + 3) : t.sub;
    return words + (t.cont && !words.includes("Continue") ? " · Continue" : "");
  };
  const matches = (text, q) => q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => text.toLowerCase().includes(w));
  const pastLabel = (sh, ar) => (!sh && !ar ? null : !sh ? "Archived " + ar : !ar ? "Shipped " + sh : "Shipped " + sh + " · archived " + ar);
  /** Your turn and stopped first, then working, quiet, a pull request with nothing waiting last; ties keep their order. */
  const bySeat = (a, b) => a.attention - b.attention;

  /** The list as the person sees it: each project's rows, fold row and sign, the hidden ones, and the note for the ones a filter left out. */
  function buildView(app) {
    const { s, v } = app;
    const looks = s.looks;
    const query = s.findText.trim();
    const searching = query !== "";
    const need = s.filter, agent = s.agentFilter;
    const filtering = need !== "" || agent !== "" || searching || activityOf(app) !== "any";
    const active = v.activeTask;
    const facts = (p) => QL.projectFacts(looks, p);
    const ordered = looks.order.map((id) => v.projects.find((p) => p.id === id)).filter(Boolean).concat(v.projects.filter((p) => !looks.order.includes(p.id)));
    const hiddenIds = new Set(ordered.filter((p) => looks.hidden[p.id] && s.project !== p.id && !(active && active.project === p.id)).map((p) => p.id));
    const groups = [];
    let quiet = 0;
    for (const p of ordered) {
      if (hiddenIds.has(p.id)) continue;
      if (s.project !== "" && s.project !== p.id) continue;
      const all = v.navTasks.filter((t) => t.project === p.id);
      const mine = all.filter((t) => agent === "" || t.agent === agent);
      const open = mine.filter((t) => t.group === "you" || t.group === "running").sort(bySeat);
      const shipped = mine.filter((t) => t.group === "shipped"), archived = mine.filter((t) => t.group === "archived");
      const pool = need === "you" ? open.filter((t) => t.group === "you")
        : need === "running" ? mine.filter((t) => t.group === "running" || t.alsoRunning).sort(bySeat)
        : need === "shipped" ? shipped
        : searching ? open.concat(shipped, archived) : open;
      const f = facts(p);
      const hits = pool.filter((t) => navRecent(t, activityOf(app)) && (!searching || matches(t.title + " " + f.label, query)));
      const kept = active ? all.find((t) => t.id === active.id) : undefined;
      if (filtering && hits.length === 0 && !kept) { quiet++; continue; }
      const folded = !!s.folded[p.id] && !searching;
      const past = shipped.concat(archived).sort((a,b) => (b.archivedAt || Date.parse(b.closedAt || "") || b.created || 0) - (a.archivedAt || Date.parse(a.closedAt || "") || a.created || 0));
      const showFold = !filtering && !folded && past.length > 0;
      const foldOpen = showFold && !!s.doneOpen[p.id];
      const pastRows = foldOpen ? past.slice(0, PAST_SHOWN) : [];
      const rows = folded ? [] : hits.slice();
      if (kept && !rows.includes(kept) && !pastRows.includes(kept)) rows.push(kept);
      const youN = open.filter((t) => t.group === "you").length;
      const working = open.some((t) => t.attention !== 4 && t.mark === "work");
      groups.push(Object.assign({}, f, {
        folded, rows, pastRows, pastMore: foldOpen ? Math.max(0, past.length - PAST_SHOWN) : 0,
        foldLabel: showFold ? pastLabel(shipped.length, archived.length) : null, foldOpen,
        // The fold names each kind with its icon and count, in the rows' mark column.
        foldParts: showFold ? [["git-merge", "Shipped", shipped.length], ["archive", "Archived", archived.length]].filter(([, , n]) => n > 0) : [],
        sign: youN > 0 ? { kind: "you", n: youN } : working ? { kind: "working" } : open.length ? { kind: "open", n: open.length } : null,
        empty: !folded && !filtering && open.length === 0 && !kept ? (mine.length === 0 ? "No tasks yet" : "Nothing open") : null,
        quiet: open.length === 0,
      }));
    }
    const hidden = ordered.filter((p) => hiddenIds.has(p.id)).map(facts);
    const quietNote = filtering && s.project === "" && quiet > 0 ? quiet + (quiet === 1 ? " project has" : " projects have") + " nothing that " + NOTHING_WORD[need] + "." : null;
    return { groups, hidden, quietNote, filtering, query, searching };
  }

  /** Status grouping: today's four lists across projects, each row ending in its project's tile. */
  function buildStatus(app) {
    const { s, v } = app;
    const looks = s.looks;
    const query = s.findText.trim();
    const searching = query !== "";
    const need = s.filter, agent = s.agentFilter;
    const active = v.activeTask;
    const facts = (id) => v.projectTile(id);
    const shown = v.navTasks.filter((t) => (agent === "" || t.agent === agent) && (s.project === "" || t.project === s.project) && (!looks.hidden[t.project] || (active && t.id === active.id) || t.project === s.project));
    const listed = shown.filter((t) => navRecent(t, activityOf(app)) && (!searching || matches(t.title + " " + facts(t.project).label, query)));
    const you = listed.filter((t) => t.group === "you").sort(bySeat);
    const running = listed.filter((t) => t.group === "running").sort(bySeat);
    const shipped = listed.filter((t) => t.group === "shipped"), archived = listed.filter((t) => t.group === "archived");
    const show = (k) => need === "" || need === k;
    const shippedOpen = !!s.shippedOpen || need === "shipped" || searching;
    const archivedOpen = !!s.archivedOpen || searching;
    const current = active && !((show("you") && you.includes(active)) || (show("running") && running.includes(active)) || (show("shipped") && shippedOpen && shipped.includes(active)) || (need === "" && archivedOpen && archived.includes(active))) ? active : null;
    return { you, running, shipped, archived, show, shippedOpen, archivedOpen, current, searching, filtering: searching || need !== "" || agent !== "" || activityOf(app) !== "any", query, empty: you.length + running.length + shipped.length + archived.length === 0 };
  }

  function FoldedSign({ g }) {
    if (!g.folded || !g.sign) return null;
    if (g.sign.kind === "you") return <span className="pj-you" title="Waiting for you" role="img" aria-label={g.sign.n + " waiting for you"}>{g.sign.n}</span>;
    if (g.sign.kind === "working") return <span role="img" aria-label="An agent is working" title="An agent is working" style={{ display: "inline-flex" }}><Mark state="work" sm /></span>;
    return <span title="Open tasks" role="img" aria-label={g.sign.n + " open"}>{g.sign.n}</span>;
  }

  /** The swatches of the project menu and of Add a project: eight colors, the pressed one is the project's. */
  function Swatches({ color, onPick }) {
    return (
      <fieldset aria-label="Color" className="pj-swatches">
        {QL.data.PROJECT_COLORS.map((c) => (
          <button key={c} type="button" className="pj-swatch" aria-label={QL.COLOR_NAME[c]} aria-pressed={color === c} title={QL.COLOR_NAME[c]} data-color={c} style={{ background: "var(--proj-" + c + "-bg)", color: "var(--proj-" + c + "-ink)" }} onClick={() => onPick(c)} />
        ))}
      </fieldset>
    );
  }

  /** The row of one task: its mark, its name and under it what it is doing (or, on one line, the step word); nested under its project.
      Detailed rows (the default) add the last change on the right, an unread dot when something changed since
      you looked, and a third line with the branch, the pull request and its checks, and the agent's mark. */
  function TaskRow({ t, nested, tile, oneLine, app }) {
    const f = tile ? app.v.projectTile(t.project) : null;
    const detail = !oneLine && app.s.rows === "detail";
    const facts = QL.AgentFacts.factsOf(t);
    const stage = navStage(t), full = navStatus(t);
    // A row whose agent is live reads its state from the agent's hooks.
    const live = !oneLine && QL.liveOf ? QL.liveOf(t, app) : null;
    const sub = live ? live.line : !detail && t.mark === "stop" && full.includes("Continue") ? "Stopped · Continue" : full === "Running in the App" ? "Working" : full;
    const unread = facts.unread && !t.on;
    const label = t.title + ". " + (stage.toLowerCase() === full.toLowerCase() ? stage : stage + " · " + full) + ". " + (facts.age ? "Last changed " + facts.age + " ago." : "Last change not reported.") + (unread ? " Changed since you looked." : "");
    const id = React.useId(), ref = useRef(null), tip = app.s.navTip;
    const showTip = () => { const r = ref.current.getBoundingClientRect(); app.set({ navTip: { id, label, left: Math.max(12, Math.min(r.left, innerWidth - 352)), ...(r.bottom + 130 > innerHeight ? { bottom: Math.max(12, innerHeight - r.top + 8) } : { top: r.bottom + 8 }) } }); };
    const closeTip = () => { if (app.s.navTip?.id === id) app.set({ navTip: null }); };
    return (<>
      <button ref={ref} type="button" className={"trow nav-task" + (live ? " ses-row ses-" + live.state : "") + (oneLine ? " one" : "") + (detail ? " detail" : "") + (t.on ? " on" : "") + (nested ? " pj-row" : "") + (tile ? " has-tile" : "") + (t.group === "shipped" || t.group === "archived" ? " past" : "")} aria-current={t.on ? "page" : undefined} aria-label={label} aria-describedby={tip?.id === id ? id : undefined} onClick={t.go} onFocus={showTip} onBlur={closeTip} onMouseEnter={showTip} onMouseLeave={() => { if (document.activeElement !== ref.current) closeTip(); }} onKeyDown={(e) => { if (e.key === "Escape" && tip?.id === id) { e.stopPropagation(); closeTip(); } }} data-nav="1" data-group={t.group}>
        <Mark state={live ? live.mark : t.mark} />
        <span className="tt">{t.title}</span>
        {oneLine ? null : <span className="age">{t.also ? <Mark state="work" sm /> : null}{unread ? <i className="unread" aria-hidden="true" /> : null}{facts.age || ""}</span>}
        {tile ? <Tile f={f} xs label className="pj-row-tile" /> : null}
        {oneLine ? <span className="end">{t.also ? <Mark state="work" sm /> : null}{stage}</span> : (
          <span className={"ts" + (t.mark === "stop" ? " stop" : "")}>
            {live ? null : !detail && stage.toLowerCase() !== sub.toLowerCase() ? <><span className="nav-stage">{stage}</span><span aria-hidden="true"> · </span></> : null}<span className="nav-status">{sub}</span>
          </span>
        )}
        {detail ? <span className="nav-meta">{navStrip(t, stage)}<QL.TaskMeta t={t} /></span> : null}
      </button>
      {live && detail && QL.LiveCard ? <QL.LiveCard live={live} t={t} app={app} /> : null}
      {tip?.id === id && ref.current ? ReactDOM.createPortal(<div id={id} role="tooltip" className="nav-row-tip" style={{ left: tip.left, top: tip.top, bottom: tip.bottom }}>{tip.label}</div>, ref.current.closest(".ql")) : null}
    </>);
  }

  /** The project's menu, drawn under its ⋯ and at the pointer on a right-click: the same choices. */
  function ProjectMenu({ app, ctx, groups }) {
    const f = groups.find((g) => g.id === ctx.id) || app.v.projectTile(ctx.id);
    const idx = groups.findIndex((g) => g.id === ctx.id);
    const done = (fn) => () => { app.set({ ctx: null }); fn(); };
    const item = (icon, label, fn, o) => (
      <button type="button" role="menuitem" className="mi" disabled={o && o.disabled} onClick={done(fn)}>
        <Icon name={icon} size={14} /><span>{label}</span><span className="pj-menu-key">{o && o.key || ""}</span>
      </button>
    );
    return (
      <div className="pop menu pj-menu" role="menu" aria-label={f.label + " options"} style={{ left: ctx.x, top: ctx.y, width: "max-content", minWidth: 232 }}>
        {item("plus", "New task here", () => app.newTaskIn(ctx.id))}
        {item("pencil", "Rename", () => app.set({ renaming: ctx.id, folded: Object.assign({}, app.s.folded, { [ctx.id]: false }) }))}
        <p className="pj-menu-sh">Color</p>
        <Swatches color={f.color} onPick={(c) => app.look(ctx.id, { color: c })} />
        <div className="menu-sep" />
        {item("arrow-up", "Move up", () => app.moveProject(ctx.id, -1), { key: "⌥↑", disabled: idx <= 0 })}
        {item("arrow-down", "Move down", () => app.moveProject(ctx.id, 1), { key: "⌥↓", disabled: idx === groups.length - 1 })}
        {item("chevrons-down-up", "Fold the others", () => app.foldOthers(ctx.id))}
        <div className="menu-sep" />
        {item("folder-open", "Open in Finder", () => app.toast("Reveals " + f.folder + " in Finder"))}
        {item("copy", "Copy path", () => { app.copy("projpath", f.folder); app.toast("Copied " + f.folder); })}
        {item("eye-off", "Hide from the list", () => { app.look(ctx.id, { hidden: true }); app.toast(f.label + " is hidden. Hidden projects at the bottom bring it back."); })}
        <p className="pj-menu-path" title={f.folder}>{f.folder}</p>
      </div>
    );
  }

  /** Rename in place: the header turns into a field. Enter or leaving it saves (empty goes back to the folder's name), Esc cancels. */
  function RenameRow({ app, f }) {
    const [text, setText] = useState(f.label);
    const done = React.useRef(false);
    const settle = (label) => { if (done.current) return; done.current = true; app.set({ renaming: null, refocus: f.id }); if (label !== undefined) app.look(f.id, { label }); };
    const commit = () => { const name = text.replace(/\s+/g, " ").trim(); settle(name === f.label ? undefined : name === "" ? null : name); };
    return (
      <div className="pj-ren">
        <Tile f={f} />
        <input className="pj-ren-input" aria-label="Project name" value={text} maxLength={40} spellCheck={false} autoFocus onFocus={(e) => e.target.select()} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); settle(undefined); } }} onBlur={commit} />
      </div>
    );
  }

  /** The View menu: Group by, Show with its counts, Agent, Rows, Fold all and Unfold all, the keys. Group by, rows and folds are the viewer's own. */
  function ViewMenu({ app }) {
    const { s, v } = app;
    const byStatus = s.groupBy === "status";
    const agentOk = (t) => s.agentFilter === "" || t.agent === s.agentFilter;
    const list = v.navTasks.filter((t) => agentOk(t) && navRecent(t, activityOf(app)) && (s.project === "" || t.project === s.project));
    const counts = { "": list.filter((t) => t.group === "you" || t.group === "running").length, you: list.filter((t) => t.group === "you").length, running: list.filter((t) => t.group === "running" || t.alsoRunning).length, shipped: list.filter((t) => t.group === "shipped").length };
    const changed = s.findText.trim() !== "" || s.filter !== "" || s.agentFilter !== "" || activityOf(app) !== "any";
    const close = () => app.set({ pop: null });
    const kbd = (k) => <kbd className="vm-kbd">{k}</kbd>;
    return (
      <>
        <IconBtn icon="sliders-horizontal" label="View options" side="left" sm on={changed || s.pop === "view"} data-pop-anchor onClick={() => app.togglePop("view")} aria-haspopup="dialog" aria-expanded={s.pop === "view"} />
        <Popover className="nav-view-options" open={s.pop === "view"} onClose={close} align="left" style={{ top: 0, left: "calc(100% + 18px)", width: 256, maxHeight: "calc(100dvh - 220px)", overflowY: "auto" }}>
          <div className="vm" aria-label="View options" onMouseDownCapture={(event) => { if (event.target.closest('[role="listbox"]')) event.stopPropagation(); }}>
            <div className="vm-head"><b>View options</b><IconBtn icon="x" label="Close view options" sm onClick={close} /></div>
            <input type="text" className="vm-find" aria-label="Filter by name" placeholder="Filter by name" value={s.findText} autoComplete="off" spellCheck={false} onChange={(e) => app.set({ findText: e.target.value })} />
            <div className="vm-filter-heading"><p className="vm-sh">Show</p><button type="button" className="vm-reset" disabled={!changed} onClick={() => app.set({ findText: "", filter: "", agentFilter: "", sidebarActivity: "any" })}>Reset filters</button></div>
            <div role="radiogroup" aria-label="Show">
            {Object.keys(SHOW_WORD).map((need) => (
              <button key={need || "all"} type="button" className="vm-item vm-radio" role="radio" aria-checked={s.filter === need} tabIndex={s.filter === need ? 0 : -1} onClick={() => app.set({ filter: need })} onKeyDown={(event) => { const choices = Object.keys(SHOW_WORD); const index = choices.indexOf(need); const next = event.key === "ArrowDown" || event.key === "ArrowRight" ? (index + 1) % choices.length : event.key === "ArrowUp" || event.key === "ArrowLeft" ? (index + choices.length - 1) % choices.length : -1; if (next >= 0) { event.preventDefault(); app.set({ filter: choices[next] }); event.currentTarget.parentElement.children[next].focus(); } }}>
                <span className="vm-mark" aria-hidden="true">{VM_MARK[need] ? <Mark state={VM_MARK[need]} sm /> : null}</span><span>{SHOW_WORD[need]}</span><span className="vm-count">{counts[need]}</span><span className="vm-check">{s.filter === need ? <Icon name="check" size={13} /> : null}</span>
              </button>
            ))}
            </div>
            <p className="vm-sh">Agent</p>
            <Select width="100%" label="Agent" marks value={s.agentFilter || "any"} options={[{ value: "any", label: "Any" }, ...["claude", "codex", "pi", "opencode", "cursor", "grok", "antigravity", "copilot"].map((a) => ({ value: a, label: QL.AgentFacts.agentName(a) }))]} onChange={(a) => app.set({ agentFilter: a === "any" ? "" : a })} />
            <p className="vm-sh vm-sh-info">Last activity<QL.InfoHint text="Task changes, plus tasks working now" /></p>
            <Select width="100%" label="Last activity" value={activityOf(app)} options={NAV_ACTIVITY} onChange={(sidebarActivity) => app.set({ sidebarActivity })} />
            <div className="vm-sep" />
            <p className="vm-sh">Group by</p>
            <Seg value={s.groupBy} options={[{ value: "project", label: "Project", icon: QL.ICON["view.byProject"], hint: "Project" }, { value: "status", label: "Status", icon: QL.ICON["view.byStatus"], hint: "Status" }]} onChange={(groupBy) => app.set({ groupBy })} />
            <p className="vm-sh">Rows</p>
            <Seg value={s.rows} options={[{ value: "detail", label: "Detailed", icon: QL.ICON["rows.detail"], hint: "Detailed" }, { value: "two", label: "Two lines", icon: QL.ICON["rows.two"], hint: "Two lines" }, { value: "one", label: "One line", icon: QL.ICON["rows.one"], hint: "One line" }]} onChange={(rows) => app.set({ rows })} />
            {!byStatus ? <>
            <div className="vm-sep" />
            <button type="button" className="vm-item" onClick={() => { app.foldAll(true); }}><Icon name="chevrons-down-up" size={15} /><span>Fold all projects</span></button>
            <button type="button" className="vm-item" onClick={() => { app.foldAll(false); }}><Icon name="chevrons-up-down" size={15} /><span>Unfold all projects</span></button>
            </> : null}
            <div className="vm-sep" />
            <details className="vm-keys"><summary>Keyboard shortcuts</summary><p className="vm-hint">{kbd("↑")} {kbd("↓")} move · {kbd("←")} {kbd("→")} fold<br />{kbd("⌥↑")} {kbd("⌥↓")} move a project</p></details>
          </div>
        </Popover>
      </>
    );
  }

  /** Add a project: the folder first (the folder picker the App already has), then its name and color. A machine's
      page has no screen to show a folder dialog on: there its folder is typed, as in Setup, and Choose folder… is not drawn. */
  function AddProject({ app }) {
    const { s } = app;
    const folders = ["ledger-web", "dotfiles", "notes"];
    const add = s.addProject;
    const onMachine = (s.machine || "this") !== "this";
    const [typed, setTyped] = React.useState("");
    const useTyped = () => { const path = typed.trim(); if (path) app.set({ addProject: { folder: path.split("/").filter(Boolean).pop() || path, name: path.split("/").filter(Boolean).pop() || path, color: "olive" } }); };
    const taken = app.v.projects.map((p) => p.folder);
    const left = folders.filter((f) => !taken.includes(f));
    const close = () => app.set({ pop: null, addProject: null });
    const pick = (folder) => app.set({ addProject: { folder, name: folder, color: "olive" } });
    return (
      <>
        <IconBtn icon="folder-plus" label="Add a project" side="left" sm on={s.pop === "add"} data-pop-anchor onClick={() => { app.set({ addProject: null }); app.togglePop("add"); }} />
        <Popover open={s.pop === "add"} onClose={close} align="left" style={{ width: 280, maxWidth: "100%" }}>
          <div className="pj-add">
            <div className="pj-add-h"><b>Add a project</b><span className="sp" /><button type="button" className="lnk" onClick={close}>Close · Esc</button></div>
            {!add ? (
              <>
                <p className="pj-add-lead">{onMachine ? "A repository on this machine. Type its folder’s path. Its tasks group under it." : "A project is a repository on this computer. Choose its folder."}</p>
                <div className="menu">
                  <label className="pj-add-field">Existing project<select className="field" value="" onChange={(event) => { const project = app.v.projects.find((item) => item.id === event.target.value); if (project) pick(project.folder); }}><option value="">Choose a project</option>{app.v.projects.map((project) => <option key={project.id} value={project.id}>{app.v.projectTile(project.id).label}</option>)}</select></label>
                  {onMachine ? (
                    <form className="pj-add-field" onSubmit={(event) => { event.preventDefault(); useTyped(); }}>Folder path<span style={{ display: "flex", gap: 6 }}><input className="field mono" placeholder="Absolute folder path" aria-label="Folder path" value={typed} spellCheck={false} autoComplete="off" onChange={(event) => setTyped(event.target.value)} /><Btn sm type="submit" disabled={!typed.trim()}>Use folder</Btn></span></form>
                  ) : (
                    <button type="button" className="mi" onClick={() => { app.toast("Native folder picker opens · simulated selection"); pick(left[0] || "ledger-web"); }}><Icon name="folder-open" size={14} /><span>Choose folder…</span><span className="n" /></button>
                  )}
                </div>
              </>
            ) : (
              <div className="pj-add-form">
                <p className="pj-add-folder">~/repos/{add.folder}</p>
                <label className="pj-add-field">Name<input className="pj-add-name" value={add.name} maxLength={40} spellCheck={false} onChange={(e) => app.set({ addProject: Object.assign({}, add, { name: e.target.value }) })} /></label>
                <div><p className="pj-menu-sh" style={{ padding: 0 }}>Color</p><Swatches color={add.color} onPick={(color) => app.set({ addProject: Object.assign({}, add, { color }) })} /></div>
                <div className="pj-add-actions"><Btn sm onClick={() => app.set({ addProject: null })}>Back</Btn><Btn sm pri disabled={!add.name.trim()} onClick={() => app.addProject(add)}>Add</Btn></div>
              </div>
            )}
          </div>
        </Popover>
      </>
    );
  }

  function Nav({ app, sheet }) {
    const { data } = QL;
    const { s, v, go } = app;
    const narrow = !sheet && app.navWidth < 200; // the word and the name go; logo, dots and icons stay
    const wide = sheet || app.navWidth >= 224; // room for the word "Feedback"
    const byProject = s.groupBy === "project";
    const oneLine = s.rows === "one";
    const filter = s.filter;
    const navRef = React.useRef(null);
    const renderedNavWidth = QL.useWidth(navRef);
    const reportWidth = sheet ? renderedNavWidth : app.navWidth;
    const listRef = React.useRef(null);
    useEffect(() => {
      const p = new URLSearchParams(window.QL_PREVIEW_QUERY ?? location.search), next = {};
      if (NAV_ACTIVITY.some((choice) => choice.value === p.get("nav-activity"))) next.sidebarActivity = p.get("nav-activity");
      if (["detail", "two", "one"].includes(p.get("nav-rows"))) next.rows = p.get("nav-rows");
      if (["project", "status"].includes(p.get("nav-group"))) next.groupBy = p.get("nav-group");
      if (["232", "320"].includes(p.get("nav-width"))) next.navWidth = Number(p.get("nav-width"));
      if (p.get("nav-menu") === "open") next.pop = "view";
      if (Object.keys(next).length) app.set(next);
    }, []);
    const view = byProject ? buildView(app) : null;
    const status = byProject ? null : buildStatus(app);
    // The Team badge counts the For you rows, as Home and the task-list toggle do: teammates' asks and your own turns.
    const openAsks = data.team.asks.filter((a) => !(s.teamAnswered || {})[a.id]);
    const teamOpen = openAsks.length + (v.yourTurnCount || 0);
    const needsYou = needsYouOf(app);
    // The Team space keeps the projects tree as on Home: the team's questions and shared tasks live in its My attention and Everyone tabs only.
    const inTeam = s.route.view === "team" && s.licenceTier === "team"; // the account line under the avatar names the team here
    // A header the list redrew takes the focus back (after a move or a rename).
    useEffect(() => {
      if (!s.refocus) return;
      const el = listRef.current && Array.from(listRef.current.querySelectorAll("[data-proj]")).find((x) => x.getAttribute("data-proj") === s.refocus);
      if (el) el.focus();
      app.set({ refocus: null });
    });
    // The project's menu closes on a click anywhere else (Esc closes it too).
    useEffect(() => {
      if (!s.ctx) return;
      const onDown = (e) => { if (!e.target.closest(".pj-menu") && !e.target.closest(".pj-act")) app.set({ ctx: null }); };
      document.addEventListener("mousedown", onDown);
      return () => document.removeEventListener("mousedown", onDown);
    }, [!!s.ctx]);
    const openMenu = (id, e) => {
      e.preventDefault();
      const nav = navRef.current.getBoundingClientRect();
      if (e.type === "contextmenu") return app.set({ ctx: { id, x: Math.max(8, Math.min(e.clientX - nav.left, nav.width - 24)), y: e.clientY - nav.top + 2 } });
      const b = e.currentTarget.getBoundingClientRect();
      app.set({ ctx: s.ctx && s.ctx.id === id ? null : { id, x: Math.max(8, b.right - nav.left - 232), y: b.bottom - nav.top + 4 } });
    };
    const keys = (e) => {
      const list = listRef.current, t = e.target;
      if (!list || !list.contains(t) || t.closest("input, textarea")) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      const project = t.getAttribute("data-proj");
      const vertical = e.key === "ArrowUp" || e.key === "ArrowDown";
      if (e.altKey) { if (vertical && project) { e.preventDefault(); app.moveProject(project, e.key === "ArrowUp" ? -1 : 1); } return; }
      if (vertical) {
        const items = Array.from(list.querySelectorAll("[data-nav]"));
        const at = items.indexOf(t.closest("[data-nav]") || (t.closest(".pj-head") && t.closest(".pj-head").querySelector("[data-nav]")));
        if (at === -1) return;
        e.preventDefault();
        const next = items[Math.max(0, Math.min(items.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))];
        if (next) next.focus();
        return;
      }
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && project) {
        const g = view && view.groups.find((x) => x.id === project);
        if (!g) return;
        e.preventDefault();
        if (g.folded !== (e.key === "ArrowLeft")) app.toggleFold(project);
      }
    };
    const showAll = () => app.set({ filter: "", agentFilter: "", sidebarActivity: "any", project: "", findText: "" });
    const chip = [(s.findText.trim()) ? "Name has “" + s.findText.trim() + "”" : "", s.filter ? SHOW_WORD[s.filter] : "", s.agentFilter ? QL.AgentFacts.agentName(s.agentFilter) : "", s.project ? v.projectTile(s.project).label : "", activityOf(app) !== "any" ? NAV_ACTIVITY.find((choice) => choice.value === activityOf(app)).label : ""].filter(Boolean);
    const matching = v.navTasks.filter((t) => (s.filter ? t.group === s.filter || s.filter === "running" && t.alsoRunning : t.group === "you" || t.group === "running" || s.findText.trim()) && (s.agentFilter === "" || t.agent === s.agentFilter) && (s.project === "" || t.project === s.project) && navRecent(t, activityOf(app)) && (!s.findOpen || matches(t.title + " " + v.projectTile(t.project).label, s.findText.trim())));
    const outside = v.navTasks.filter((t) => (t.group === "you" || t.group === "running") && !matching.includes(t) && t !== v.activeTask).length;
    const emptyFiltered = chip.length > 0 && matching.length === 0;
    const body = (g) => (
      <>
        {g.rows.map((t) => <TaskRow key={t.id} t={t} nested oneLine={oneLine} app={app} />)}
        {g.empty ? <p className="pj-empty">{g.empty} · <button type="button" className="lnk" onClick={() => app.newTaskIn(g.id)}>New task</button></p> : null}
        {g.foldLabel ? (
          <button type="button" className={"pj-fold ses-past" + (app.navWidth < 240 || g.foldParts.length > 2 ? " narrow" : "")} aria-expanded={g.foldOpen} aria-label={(g.foldOpen ? "Hide " : "Show ") + g.foldLabel.replace(/ · /g, ", ").toLowerCase()} title={g.foldLabel} onClick={() => app.toggleDone(g.id)} data-nav="1">
            <Icon name="chevron-right" size={12} className="pj-chev" />
            {g.foldParts.map(([icon, label, n]) => <span key={label} className="ses-past-part"><Icon name={icon} size={12} /><span className="ses-past-w">{label}</span><b>{n}</b></span>)}
          </button>
        ) : null}
        {g.pastRows.map((t) => <TaskRow key={t.id} t={t} nested oneLine={oneLine} app={app} />)}
        {g.pastMore > 0 ? <p className="pj-empty">{g.pastMore} more. Search finds them.</p> : null}
      </>
    );
    const projectList = !view ? null : (
      <div ref={listRef} className="pj-list" data-testid="project-list" onKeyDown={keys}>
        {view.groups.map((g) => {
          const dropLine = s.dragId && s.dropOn === g.id && s.dragId !== g.id ? (s.looks.order.indexOf(s.dragId) < s.looks.order.indexOf(g.id) ? " drop-after" : " drop-before") : "";
          return (
            <section key={g.id} className={"pj" + (g.folded ? "" : " open") + (g.quiet ? " quiet" : "") + (s.dragId === g.id ? " dragging" : "") + dropLine} data-project={g.id}
              onDragOver={s.dragId ? (e) => { if (s.dragId === g.id) return; e.preventDefault(); if (s.dropOn !== g.id) app.set({ dropOn: g.id }); } : undefined}
              onDrop={s.dragId ? (e) => { e.preventDefault(); app.dropProject(s.dragId, g.id); } : undefined}>
              {s.renaming === g.id ? <RenameRow app={app} f={g} /> : (
                <div className={"pj-head has-actions" + (view.groups.length > 1 ? " can-drag" : "")} onContextMenu={(e) => openMenu(g.id, e)}
                  draggable={view.groups.length > 1} onDragStart={(e) => { try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", g.id); } catch (err) {} app.set({ dragId: g.id, dropOn: null }); }} onDragEnd={() => app.set({ dragId: null, dropOn: null })}>
                  <button type="button" className="pj-toggle" aria-expanded={!g.folded} title={[g.label, g.folder, g.folded ? "unfold" : "fold"].join(" · ")} onClick={() => app.toggleFold(g.id)} data-nav="1" data-proj={g.id}>
                    <Icon name="chevron-right" size={14} className="pj-chev" />
                    <span className="pj-tilebox"><Tile f={g} /><Icon name="grip-vertical" size={12} className="pj-grip" /></span>
                    <span className="pj-name">{g.label}</span>
                    <span className="pj-count"><FoldedSign g={g} /></span>
                  </button>
                  <button type="button" className="pj-act" aria-label={"New task in " + g.label} title={"New task in " + g.label} data-pop-anchor onClick={() => app.newTaskIn(g.id)}><Icon name="plus" size={14} /></button>
                  <button type="button" className="pj-act" aria-label={g.label + " options"} title={g.label + " options"} aria-haspopup="menu" data-pop-anchor onClick={(e) => openMenu(g.id, e)}><Icon name="ellipsis" size={14} /></button>
                </div>
              )}
              {body(g)}
            </section>
          );
        })}
        {view.quietNote && !emptyFiltered ? <p className="pj-quiet-note">{view.quietNote} <button type="button" className="lnk" onClick={showAll}>Show all</button></p> : null}
        {view.hidden.length ? (
          <div className="pj-hid">
            <button type="button" className="pj-fold pj-hid-toggle" aria-expanded={!!s.hiddenOpen} onClick={() => app.set({ hiddenOpen: !s.hiddenOpen })} data-nav="1">
              <Icon name="chevron-right" size={12} className="pj-chev" />Hidden projects · {view.hidden.length}
            </button>
            {s.hiddenOpen ? view.hidden.map((h) => (
              <div className="pj-hrow" key={h.id}><Tile f={h} /><span className="pj-name">{h.label}</span><button type="button" className="lnk pj-show" aria-label={"Show " + h.label + " again"} onClick={() => app.look(h.id, { hidden: false })}>Show again</button></div>
            )) : null}
          </div>
        ) : null}
      </div>
    );
    const statusList = !status ? null : (
      <div className="pj-list">
        {status.current ? <div className="grp"><div className="gh"><span>Open now</span></div><TaskRow t={status.current} tile oneLine={oneLine} app={app} /></div> : null}
        {status.show("you") && (!status.filtering || status.you.length) ? <div className="grp" data-group="you"><div className="gh you"><span>Your turn</span><span className="n">{status.you.length}</span></div>{status.you.map((t) => <TaskRow key={t.id} t={t} tile oneLine={oneLine} app={app} />)}{status.you.length === 0 ? <div className="nav-empty">Nothing right now</div> : null}</div> : null}
        {status.show("running") && (!status.filtering || status.running.length) ? <div className="grp" data-group="running"><div className="gh"><span>Running</span><span className="n">{status.running.length}</span></div>{status.running.map((t) => <TaskRow key={t.id} t={t} tile oneLine={oneLine} app={app} />)}{status.running.length === 0 ? <div className="nav-empty">No agent is working</div> : null}</div> : null}
        {status.show("shipped") && (!status.filtering || status.shipped.length) ? (
          <div className="grp" data-group="shipped">
            <button type="button" className="gh folds" aria-expanded={status.shippedOpen} onClick={() => app.set({ shippedOpen: !s.shippedOpen })}><span>Shipped</span><span className="n">{status.shipped.length}<Icon name={status.shippedOpen ? "chevron-down" : "chevron-right"} size={12} /></span></button>
            {status.shippedOpen ? status.shipped.slice(0, PAST_SHOWN).map((t) => <TaskRow key={t.id} t={t} tile oneLine={oneLine} app={app} />) : null}
          </div>
        ) : null}
        {filter === "" && (!status.filtering || status.archived.length) ? (
          <div className="grp" data-group="archived">
            <button type="button" className="gh folds" aria-expanded={status.archivedOpen} onClick={() => app.set({ archivedOpen: !s.archivedOpen })}><span>Archived</span><span className="n">{status.archived.length}<Icon name={status.archivedOpen ? "chevron-down" : "chevron-right"} size={12} /></span></button>
            {status.archivedOpen ? status.archived.map((t) => <TaskRow key={t.id} t={t} tile oneLine={oneLine} app={app} />) : null}
          </div>
        ) : null}
      </div>
    );
    // Settings takes over the sidebar (Back, its sections, search), so there is one left column, not two.
    if (s.route.view === "settings") return <QL.SettingsNav app={app} sheet={sheet} navRef={navRef} />;
    QL.lastRoute = s.route;
    return (
      <aside ref={navRef} id={sheet ? "projects-navigation-sheet" : "projects-navigation"} data-screen-label="Projects navigation" className={"nav" + (narrow ? " narrow" : "") + (app.navWidth >= 340 ? " wide" : "") + (sheet ? " sheet" : "")} aria-label="Tasks" style={sheet ? undefined : { width: app.navWidth }}>
        <div className="nav-in">
          <div className="nav-top">
            <IconBtn icon={sheet ? "x" : "panel-left"} label={sheet ? "Close the task list · Esc" : navigationHint("Hide the task list", "B")} side="right" onClick={() => sheet ? app.set({ sheet: false }) : app.set({ navOpen: false })} />
            {/* Machines, sidebar variant: with a machine added, the chosen machine and its menu take the product name's place (machines.jsx). */}
            {QL.machineSwitchShown && QL.machineSwitchShown(s) ? <QL.MachineSwitch app={app} /> : <button type="button" className="row" style={{ background: "none", border: 0, padding: "0 4px", gap: 7, minWidth: 0, flex: 1, textAlign: "left" }} onClick={() => go({ view: "home" })} title="QualityLayer">
              <Logo />
              <span className="wm">QualityLayer</span>
            </button>}
            {/* No bell anywhere (Max, 2 November 2026): Home lists what needs you, and while the sidebar is collapsed the
                task-list toggle carries the count. One + opens a labelled menu, Chat or Task, each opening the same card. */}
            <NewMenu app={app} />
          </div>
          <button type="button" className="nav-search" onClick={() => app.set({ search: true })} aria-label="Search tasks, projects, files and actions · ⌘K">
            <Icon name="search" size={14} /><span>Search</span><kbd>⌘K</kbd>
          </button>
          <button type="button" className={"nav-place" + (s.route.view === "home" ? " on" : "")} onClick={() => go({ view: "home" })} aria-current={s.route.view === "home" ? "page" : undefined} title={navigationHint("Home · your tasks on this computer", "1")}>
            <Icon name="house" size={16} />
            <span className="t">Home</span>
            {needsYou ? <span className="n">{needsYou}</span> : null}
          </button>
          <button type="button" className={"nav-place" + (s.route.view === "artifacts" || s.route.view === "lasting" ? " on" : "")} onClick={() => go({ view: "artifacts" })} aria-current={s.route.view === "artifacts" || s.route.view === "lasting" ? "page" : undefined} title={navigationHint("Artifacts · every project's lasting artifacts and the drafts in open tasks", "3")} data-testid="artifacts-place">
            <Icon name="shapes" size={16} />
            <span className="t">Artifacts</span>
          </button>
          <div className="lh" data-testid="task-list-header">
            <h2 className="pj-label">{byProject ? "Projects" : "Tasks"}</h2>
            <ViewMenu app={app} />
            <AddProject app={app} />
          </div>
          <div className="nav-scroll">
            {(
              <>
                {chip.length ? (
                  <div className="chipf" data-testid="filter-note">
                    <span className="truncate">{chip.join(" · ")}</span>
                    <button type="button" className="lnk" onClick={showAll}>Clear filters</button>
                  </div>
                ) : null}
                <span className="sr" role="status">{matching.length} matching tasks. {outside} other open tasks outside this view.</span>
                {emptyFiltered ? (s.findText.trim() ? <p className="pj-quiet-note">Nothing here matches “{s.findText.trim()}”. <button type="button" className="lnk" onClick={() => app.set({ search: true })}>Search everything</button></p> : <p className="pj-quiet-note">No tasks match this view. <button type="button" className="lnk" onClick={showAll}>Clear filters</button></p>) : null}
                {s.loading && s.route.view === "home" ? <QL.NavLoading /> : byProject ? projectList : statusList}
                {chip.length && outside > 0 ? <p className="pj-quiet-note">{outside} other open tasks outside this view.</p> : null}
              </>
            )}
          </div>
          <div className="nav-foot">
            <UpdateLine app={app} />
            <div className="foot-id">
            <div style={{position:"relative"}}>
            <button type="button" className="me team-upgrade-account" data-pop-anchor title={data.me.name + " · " + (s.licenceTier === "trial" ? "Trial · 7 days left" : s.licenceTier === "solo" ? "Individual licence" : "Business licence")} aria-label="Account" aria-expanded={s.pop === "account"} onClick={()=>app.set({pop:s.pop === "account"?null:"account"})}>
              <span className="av">{data.me.initials}</span>
            </button>
            <Popover open={s.pop === "account"} onClose={()=>app.set({pop:null})} align="left" label="Account" style={{top:"auto",bottom:"calc(100% + 8px)",width:232}}>
              <div className="menu">
                <div className="pj-menu-path"><div className="me-n">{data.me.name}</div><div className="me-l">{s.licenceTier === "trial" ? "Trial · 7 days left" : s.licenceTier === "solo" ? "Individual licence" : "Business licence"}</div></div>
                <div className="menu-sep"/>
                <a className="mi" href="https://qualitylayer.dev/pricing" target="_blank" rel="noopener noreferrer"><Icon name={QL.ICON["link.external"]} size={14}/><span>Plans and pricing</span></a>
                <button type="button" className="mi" onClick={()=>{app.set({pop:null});go({view:"settings",tab:"licence"});}}><Icon name={QL.ICON["data.licence"]} size={14}/><span>Licence and billing</span></button>
                <div className="menu-sep"/><div className="pj-menu-path">QualityLayer {QL.settingsModelVersion}</div>
              </div>
            </Popover>
            </div>
            {QL.UsageFoot ? <QL.UsageFoot app={app} /> : null}
            </div>
            {s.licenceTier === "trial" ? <a className={"btn team-upgrade-trial-plan"+(s.route.view === "team"?"":" pri")} href="https://qualitylayer.dev/pricing" target="_blank" rel="noopener noreferrer">Choose a plan</a> : null}
            <div className="foot-row">
              <IconBtn icon="settings" label={navigationHint("Settings", ",")} side="right" on={s.route.view === "settings"} onClick={() => go({ view: "settings", tab: "workflow" })} />
              <IconBtn icon="book-open" label="Docs" side="top" onClick={() => app.toast("Opens qualitylayer.dev/docs in the browser")} />
              <IconBtn icon={s.theme === "dark" ? "sun" : "moon"} label={s.theme === "dark" ? "Light theme" : "Dark theme"} side="top" onClick={() => app.set({ theme: s.theme === "dark" ? "light" : "dark" })} />
              <span className="sp" />
              <button type="button" className={"proposal-report-inline" + (reportWidth < 200 ? " compact" : "")} title="Report a bug or suggest an improvement" aria-label="Report a bug or suggest an improvement" aria-haspopup="dialog" aria-expanded={s.dialog === "feedback"} onClick={() => app.set({ dialog: "feedback" })}>
                {reportWidth >= 200 ? <Icon name="message-square-plus" size={16} /> : null}<span>{reportWidth >= 260 ? "Report bug / idea" : reportWidth >= 200 ? "Bug / idea" : "Report"}</span>
              </button>
            </div>
          </div>
        </div>
        {s.ctx && byProject && view ? <ProjectMenu app={app} ctx={s.ctx} groups={view.groups} /> : null}
        
      </aside>
    );
  }

  /* ── The task rail (issue #231, Max 3 November 2026; task-rail.html) ──
     When the task list is collapsed on a window 900 px and wider, a 52 px rail stays in its place, on every page but
     Settings and a full-screen artifact. Top: the expand toggle, then Home (Needs-you count), Team (its count) and
     Artifacts. Tiles: the tasks that need you, then the running ones; the open task always shows. Each tile is the
     project's colour with the task's initials and its status mark; its name and state show beside it on hover or focus.
     Foot: usage (one ring, the agent nearest its plan limit) and Settings (a dot when an update is ready).
     Expanded is the full list as before; the person's choice holds on every page until they change it. Below 1100 px
     the expanded list shares one slot with the right sidebar; the rail never takes that slot. */
  const navRailShown = (app) => !app.s.navOpen && app.s.route.view !== "settings" && app.width >= 900;
  const railInitials = (title) => title.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

  /** One tooltip for the rail, drawn beside it above the page so the scrolling tile column never clips it. */
  function useRailTip(app) {
    const [tip, setTip] = useState(null);
    const show = (label) => (e) => {
      const r = e.currentTarget.getBoundingClientRect(), root = app.rootRef.current.getBoundingClientRect();
      setTip({ label, top: r.top - root.top + r.height / 2, left: r.right - root.left + 8 });
    };
    const hide = () => setTip(null);
    const props = (label, key) => { const hint = key ? navigationHint(label, key) : label; return { "aria-label": label, onMouseEnter: show(hint), onMouseOver: show(hint), onMouseLeave: hide, onFocus: show(hint), onBlur: hide }; };
    const node = tip && app.rootRef.current ? ReactDOM.createPortal(<div className="rail-tip" role="tooltip" style={{ top: tip.top, left: tip.left }}>{tip.label}</div>, app.rootRef.current) : null;
    return { props, node };
  }

  /** A ring filled by the share used, as the Conversation footer's context ring; amber from 80 %. */
  function RailRing({ pct, size }) {
    const r = size / 2 - 2.5, c = 2 * Math.PI * r;
    return (
      <svg className={"rail-ring" + (pct >= 80 ? " near" : "")} width={size} height={size} viewBox={"0 0 " + size + " " + size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} />
        <circle cx={size / 2} cy={size / 2} r={r} className="rail-ring-on" strokeDasharray={(c * pct / 100).toFixed(1) + " " + c.toFixed(1)} transform={"rotate(-90 " + size / 2 + " " + size / 2 + ")"} />
      </svg>
    );
  }

  /** Usage: the agent nearest its plan limit as one ring with its mark inside; the popover lists every agent. */
  function RailUsage({ app, tip }) {
    const s = app.s, L = QL.AgentFacts.LIMITS;
    const credits = s.limitsState === "credits" ? "credits" : null;
    const failed = s.limitsState === "failed";
    const agents = L.agents.map((a) => ({ key: a.agent, used: 100 - QL.AgentFacts.tightest(QL.AgentFacts.usedUp(a, credits)).left }));
    const top = agents.slice().sort((x, y) => y.used - x.used)[0];
    const name = (k) => ({ claude: "Claude Code", codex: "Codex", copilot: "GitHub Copilot" })[k] || k;
    const label = failed || !top ? "Plan limits: couldn't read usage" : "Plan limits · " + agents.map((a) => name(a.key) + " " + a.used + " %").join(" · ");
    const open = s.pop === "limits";
    return (
      <div style={{ position: "relative" }}>
        <button type="button" className={"rail-usage" + (open ? " on" : "")} data-pop-anchor aria-haspopup="dialog" aria-expanded={open} {...tip.props(label)} onClick={() => app.togglePop("limits")}>
          {failed || !top ? <Icon name="gauge" size={16} /> : <span className="rail-usage-ring"><RailRing pct={top.used} size={28} /><span className="rail-usage-in"><QL.AgentMark agent={top.key} size={13} /></span></span>}
        </button>
        {QL.UsagePopover ? <QL.UsagePopover app={app} style={{ top: "auto", bottom: 0, left: "calc(100% + 10px)", width: 320 }} /> : null}
      </div>
    );
  }

  function NavRail({ app }) {
    const { s, v, go } = app;
    const tip = useRailTip(app);
    const needs = needsYouOf(app);
    const openAsks = QL.data.team.asks.filter((a) => !(s.teamAnswered || {})[a.id]);
    const teamOpen = openAsks.length + (v.yourTurnCount || 0);
    const all = v.navTasks;
    const you = all.filter((t) => t.group === "you");
    const running = all.filter((t) => t.group === "running");
    const current = all.find((t) => t.on && !you.includes(t) && !running.includes(t));
    const place = (icon, label, view, on, count, tipLabel) => (
      <button type="button" className={"rail-ib" + (on ? " on" : "")} aria-current={on ? "page" : undefined} {...tip.props(tipLabel || label, { home: "1", team: "2", artifacts: "3" }[view])} onClick={() => go({ view })}>
        <Icon name={icon} size={16} />
        {count ? <span className="rail-count">{count > 9 ? "9+" : count}</span> : null}
      </button>
    );
    const task = (t) => {
      const project = v.projectTile(t.project || QL.data.task.project);
      const live = QL.liveOf ? QL.liveOf(t, app) : null;
      const status = live ? live.line : t.sub || "";
      // Title first; what it is doing and its project on the second line.
      const label = t.title + "\n" + [status, project.label].filter(Boolean).join(" · ");
      return (
        <button key={t.id} type="button" className={"rail-task" + (t.on ? " on" : "")} aria-current={t.on ? "page" : undefined} {...tip.props(label)} onClick={t.go}>
          <span className="pj-tile" data-color={project.color} style={{ "--pj-bg": "var(--proj-" + project.color + "-bg)", "--pj-ink": "var(--proj-" + project.color + "-ink)" }} aria-hidden="true">{railInitials(t.title) || project.letters}</span>
          <span className="rail-mark"><Mark state={live ? live.mark : t.mark} sm /></span>
        </button>
      );
    };
    // ?rail=tip names one tile, as hover does.
    const tilesRef = useRef(null);
    useEffect(() => {
      if (new URLSearchParams(window.QL_PREVIEW_QUERY ?? location.search).get("rail") !== "tip" || !tilesRef.current) return;
      const el = [...tilesRef.current.querySelectorAll(".rail-task")].find((b) => !b.classList.contains("on"));
      if (el) el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    }, []);
    return (
      <aside className="nav rail-nav" id="task-rail" data-screen-label="Task rail" aria-label="Tasks">
        <button type="button" className="rail-ib" aria-expanded="false" {...tip.props("Expand the task list", "B")} onClick={() => app.set({ navOpen: true })}>
          <Icon name="panel-left" size={16} />
        </button>
        {/* Machines, with the sidebar collapsed: one tile with what waits on the other machines; it opens the sidebar with the switcher's menu. */}
        {QL.machineSwitchShown && QL.machineSwitchShown(s) ? <div className="rail-sep" /> : null}
        {QL.machineSwitchShown && QL.machineSwitchShown(s) ? <button type="button" className="rail-ib" id="machine-switch-rail" aria-haspopup="menu" aria-expanded="false" {...tip.props("Machines · " + ((QL.MachineSwitch.nameOf && QL.MachineSwitch.nameOf(s)) || "This computer"))} onClick={() => app.set({ navOpen: true, machineMenu: true })}>
          <Icon name={QL.ICON[(s.machine || "this") === "this" ? "machine.this" : "machine.remote"]} size={16} />
          {QL.MachineSwitch.elsewhere && QL.MachineSwitch.elsewhere(s) ? <span className="rail-count">{QL.MachineSwitch.elsewhere(s)}</span> : null}
        </button> : null}
        <div className="rail-sep" />
        <nav className="rail-places" aria-label="Places">
          {place("house", "Home", "home", s.route.view === "home", needs, "Home" + (needs ? " · " + needs + " need you" : ""))}
          {place("shapes", "Artifacts", "artifacts", ["artifacts", "lasting"].includes(s.route.view), 0)}
        </nav>
        <div className="rail-sep" />
        <div className="rail-tiles" ref={tilesRef}>
          {current ? <div className="rail-group" role="group" aria-label="Open now">{task(current)}</div> : null}
          {you.length ? <div className="rail-group" role="group" aria-label="Your turn">{you.map(task)}</div> : null}
          {you.length && running.length ? <div className="rail-sep thin" /> : null}
          {running.length ? <div className="rail-group" role="group" aria-label="Running">{running.map(task)}</div> : null}
        </div>
        <div className="rail-foot">
          <RailUsage app={app} tip={tip} />
          <button type="button" className={"rail-ib" + (s.route.view === "settings" ? " on" : "")} {...tip.props(s.updateReady ? "Settings · update ready" : "Settings", ",")} onClick={() => go(s.updateReady ? { view: "settings", tab: "about" } : { view: "settings", tab: "workflow" })}>
            <Icon name="settings" size={16} />
            {s.updateReady ? <i className="rail-dot" aria-hidden="true" /> : null}
          </button>
        </div>
        {tip.node}
      </aside>
    );
  }

  /** The projects in the person's order: the saved order, then any the order does not name. */
  function looks_order(looks, projects) {
    return looks.order.map((id) => projects.find((p) => p.id === id)).filter(Boolean).concat(projects.filter((p) => !looks.order.includes(p.id)));
  }

  /* ── New task: Feature and Bugfix start planning; Chat starts the same agent directly in Conversation.
     The initial request, attachments and chosen project travel with every kind.
     The settings come from Settings › Workflow › Planning; one line shows them, "Change" opens them. ── */
  function NewTaskPop({ app, page = false }) {
    return page && app.s.pop === "new" ? <QL.TaskLaunchCard app={app}/> : page && app.s.pop === "new-chat" ? <QL.TaskLaunchCard app={app} chat /> : null;
  }

  /* The sidebar's one +. Its menu names both kinds in words, so no icon has to be told apart: Chat (a conversation,
     no steps) or Task (the workflow). Each row opens the same card with its kind chosen. */
  function NewMenu({ app }) {
    const s = app.s, open = s.pop === "new-menu", close = () => app.set({ pop: null });
    // Each kind: its icon, its name and a short subtitle that says what it is for.
    const row = (kind, icon, label, hint, pick) => (
      <button type="button" role="menuitem" className="mi ses-new-mi" data-kind={kind} onClick={pick}>
        <span className="ses-new-tile" aria-hidden="true"><Icon name={icon} size={14} /></span>
        <span className="ses-new-text"><b>{label}</b><small>{hint}</small></span>
      </button>
    );
    return (
      <span style={{ position: "relative" }}>
        <button type="button" className={"btn sm" + (open || s.pop === "new" || s.pop === "new-chat" ? " on" : "")} aria-label="New" aria-haspopup="menu" aria-expanded={open} data-tip="New" data-tip-side="left" data-pop-anchor style={{ width: 28, height: 28, padding: 0, justifyContent: "center" }} onClick={() => app.set({ pop: open ? null : "new-menu" })}><Icon name="plus" size={13} /></button>
        <Popover open={open} onClose={close} label="New" className="ses-new-menu" style={{ width: 208 }}>
          <div className="menu" role="menu">
            {row("task", "list-checks", "Task", "Feature or bug fix", () => app.set({ newProject: null, pop: "new" }))}
            {row("chat", QL.ICON["kind.chat"], "Chat", "Free-form, no steps", () => app.set({ pop: "new-chat" }))}
          </div>
        </Popover>
      </span>
    );
  }

  /* ── the status panel, from the agent chip ── */
  function StatusPop({ app }) {
    const { s, v } = app;
    const a = v.agent;
    return (
      <Popover open={s.pop === "status"} onClose={() => app.set({ pop: null })} style={{ width: 420 }}>
        <div className="pop-hd">
          <div className="pop-who">
            <Mark state={a.mark} />
            {a.name}
            <span className="role">{a.role}</span>
            <span className="since">{a.since ? "since " + fmt.clock(a.since) : a.stoppedAt ? fmt.clock(a.startedAt) + " to " + fmt.clock(a.stoppedAt) : ""}</span>
          </div>
          <div className="pop-now">{a.now}</div>
          {a.state === "stopped" ? (
            <div style={{ marginTop: 10 }}><Cmd text={v.resumeCommand} copied={s.copied === "resume"} onCopy={() => app.copy("resume", v.resumeCommand)} /></div>
          ) : (
            <div className="pop-sig">
              <span><i className={a.state === "stopped" ? "sig-bad" : "sig-ok"} />{a.state === "stopped" ? "process gone" : "process alive"}</span>
              <span>last step {a.lastStep}</span>
              <span>{a.waitsOn}</span>
            </div>
          )}
        </div>
        {a.helpers && a.helpers.length ? (
          <div className="pop-sec">
            <div className="pop-sh">Working with it</div>
            {a.helpers.map((h, i) => (
              <div key={i} className="hr">
                <Mark state={h.state} sm />
                <span className="r">{h.what}</span>
                <span className="s">{h.when}</span>
                {h.sub ? <span className="sub">{h.sub}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
        {a.finished ? (
          <button type="button" className="pop-sec row" style={{ width: "100%", background: "none", border: 0, borderBottom: "1px solid var(--line)", textAlign: "left", fontSize: 13, color: "var(--muted)", cursor: "pointer" }} onClick={() => app.set({ finishedOpen: !s.finishedOpen })}>
            <Icon name={s.finishedOpen ? "chevron-down" : "chevron-right"} size={14} />
            <span>{a.finished}</span>
            <span className="sp" />
            <span style={{ fontSize: 12, color: "var(--dim)" }}>{s.finishedOpen ? "hide" : "show"}</span>
          </button>
        ) : null}
        {s.finishedOpen && a.finishedList ? (
          <div className="pop-sec" style={{ paddingTop: 6 }}>
            {a.finishedList.map((h, i) => (
              <div key={i} className="hr"><Mark state="done" sm /><span className="r" style={{ fontWeight: 450, color: "var(--muted)" }}>{h[0]}</span><span className="s">{h[1]}</span></div>
            ))}
          </div>
        ) : null}
        <div className="pop-ft">
          <span>{a.foot}</span>
          <span className="sp" />
          <button type="button" className="lnk" onClick={() => app.set({ pop: "cost" })}>What it cost</button>
        </div>
      </Popover>
    );
  }

  /* ── what it cost ── */
  /** What it cost: the total, a bar split by step, and per step its time, tokens and cost, with every helper named by its work. */
  /* One neutral ramp from light to dark: the App's amber, blue and violet keep their meanings. Only the step running now is blue (UI review, SHELL-14). */
  const RAMP = ["discuss", "research", "plan", "outline", "implement", "verify", "review"];
  const STEP_TINT = Object.fromEntries(RAMP.map((id, i) => [id, "color-mix(in oklab, var(--text) " + (24 + i * 12) + "%, var(--bg))"]));
  const tok = (n) => (n == null ? "–" : n >= 1e6 ? (n >= 1e7 ? Math.round(n / 1e6) : (n / 1e6).toFixed(1)) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "K" : String(n));
  const money = (usd) => (usd != null ? fmt.usd(usd) : "—");

  function CostPop({ app }) {
    const { s, v } = app;
    const c = QL.data.task.cost;
    const [open, setOpen] = useState({});
    const [all, setAll] = useState({});
    useEffect(() => { if (s.pop === "cost") { setOpen({}); setAll({}); } }, [s.pop === "cost"]);
    const total = c.steps.reduce((n, st) => n + st.all, 0);
    const allTokens = total;
    const totalUsd = c.priced === 0 && allTokens > 0 && c.tokens >= allTokens ? null : c.priced;
    const live = v.stage && v.stage !== "shipped" && !s.archived ? v.stage : null;
    const tint = (id) => (id === live ? "var(--accent)" : STEP_TINT[id]);
    return (
      <Popover open={s.pop === "cost"} onClose={() => app.set({ pop: null })} style={{ width: 580 }}>
        <div className="ct">
          <div className="ct-hd">
            <span className="ct-amt">{money(totalUsd)}</span>
            <span className="ct-sub">{c.nativeCredits?.amount !== undefined ? (c.estimateUsd !== undefined ? "Usage value + list estimate" : "AI-credit usage value") : "so far"} · {fmt.min(c.sinceMs)}<QL.InfoHint text={c.nativeCredits?.amount !== undefined ? "Copilot credit value; not an additional charge. Other usage at API prices." : "Estimated at list price."} /></span>
          </div>
          <div className="ct-bar" role="img" aria-label={"Tokens by step: " + c.steps.map((st) => st.step + " " + tok(st.all)).join(", ")}>{c.steps.map((st) => <i key={st.id} style={{ flexGrow: Math.max(st.all / total, 0.02), background: tint(st.id) }} title={st.step + " · " + tok(st.all) + " tokens"} />)}</div>
          <table className="ct-t">
            <thead><tr><th>Step</th><th>time</th><th>tokens</th><th>cost</th></tr></thead>
            <tbody>
              {c.steps.map((st) => {
                const isOpen = !!open[st.id];
                const shown = st.shown || st.rows.length;
                const rows = all[st.id] ? st.rows : st.rows.slice(0, shown);
                const hidden = st.rows.length - rows.length;
                return (
                  <React.Fragment key={st.id}>
                    <tr className="step" onClick={() => setOpen((o) => Object.assign({}, o, { [st.id]: !isOpen }))} aria-expanded={isOpen}>
                      <td><span className="ct-c"><span className="ct-dot" style={{ background: tint(st.id) }} /><b>{st.step}</b><span className="k">{st.rows.length - 1 ? st.rows.length - 1 + (st.rows.length === 2 ? " helper" : " helpers") : ""}</span><Icon name="chevron-down" size={13} className={isOpen ? "" : "turn"} /></span></td>
                      <td>{fmt.min(st.ms)}</td><td>{tok(st.all)}</td><td>{money(st.usd)}</td>
                    </tr>
                    {isOpen ? rows.map((r, i) => (
                      <tr key={i} className="sub"><td title={r[0]}><span className="truncate">{r[0]}</span></td><td>{r[1] ? fmt.min(r[1]) : ""}</td><td>{tok(r[2])}</td><td>{money(r[3])}</td></tr>
                    )) : null}
                    {isOpen && st.checks ? <tr className="sub"><td><span className="truncate">{st.checks[0]}</span></td><td>{fmt.min(st.checks[1])}</td><td>–</td><td>$0</td></tr> : null}
                    {isOpen && (hidden > 0 || all[st.id]) ? <tr className="sub more"><td colSpan={4}><button type="button" className="lnk" onClick={() => setAll((a) => Object.assign({}, a, { [st.id]: !a[st.id] }))}>{all[st.id] ? "Show the first " + shown : "Show all " + st.rows.length + " · " + hidden + " more"}</button></td></tr> : null}
                  </React.Fragment>
                );
              })}
              <tr className="total"><td>Total</td><td>{fmt.min(c.sinceMs)}</td><td>{tok(allTokens)}</td><td>{money(totalUsd)}</td></tr>
            </tbody>
          </table>
          {c.worth ? <div className="ct-worth"><Mark state="you" /><div><b>Worth a look.</b> {c.worth}</div></div> : null}
        </div>
        <div className="pop-ft"><span /><a href="#/settings/usage" className="lnk" onClick={(e) => { e.preventDefault(); app.set({ pop: null }); app.go({ view: "settings", tab: "usage" }); }}>Usage history</a></div>
      </Popover>
    );
  }

  /* ── Ask the team: from a passage, a diagram or an artifact in your task. Each person gets a Slack message
     and sees it under Team › Questions for you; the answer lands in this task's Feedback, where your agent reads it. ── */
  function AskTeamDialog({ app }) {
    const { s } = app;
    const team = QL.data.team.members.filter((m) => !m.you);
    if (s.dialog !== "ask-team") return null;
    return (
      <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) app.set({ dialog: null }); }}>
        <div className="dialog" role="dialog" aria-labelledby="ask-h" style={{ width: 480 }}>
          <h3 id="ask-h">Give feedback</h3>
          <QL.FeedbackComposer quote={s.quote} recipients={[{ value: "agent", label: "The agent", kind: "agent" }].concat(team.map((person) => ({ value: person.name, label: person.name.split(" ")[0], kind: "person" })), [{ value: "audience", label: "Everyone on the task", kind: "audience" }])} send={(recipient, text, need, files) => { if (recipient.kind === "agent") { app.comment(text, files); app.set({ dialog: null }); } else app.askTeam({ to: recipient.kind === "audience" ? "Everyone on the task" : recipient.label, q: text, need: need === "before" ? "needed before approval" : "opinion only", quote: s.quote, files }); }} reachLine={(recipient, need) => recipient.kind === "agent" ? "Your feedback is saved for " + app.v.agent.name + "." : recipient.label + " finds it in Needs you." + (need === "before" ? " Approval waits for the answer." : " The answer returns to this passage.")} onCancel={() => app.set({ dialog: null })} />
        </div>
      </div>
    );
  }

  const reportParameters = new URLSearchParams(window.QL_REPORTING_PREVIEW ? (window.QL_PREVIEW_QUERY ?? location.search) : "");
  function useReportPreviewState(onState) { useEffect(() => { if (!window.QL_REPORTING_PREVIEW) return; const listener = (event) => onState(event.detail); window.addEventListener("prototype-state", listener); return () => window.removeEventListener("prototype-state", listener); }, [onState]); }
  if (!document.getElementById("reporting-model-style")) { const style = document.createElement("style"); style.id = "reporting-model-style"; style.textContent = ".ql .rp-sheet{padding:0;width:600px;max-width:calc(100vw - 32px);max-height:calc(100vh - 76px);display:flex;flex-direction:column;overflow:hidden}\n.ql .rp-head{padding:20px 22px 16px;border-bottom:1px solid var(--border);flex:none}\n.ql .rp-head-top{display:flex;align-items:flex-start;gap:14px;justify-content:space-between}\n.ql .rp-head h2{font-size:18px;line-height:1.35;font-weight:600;margin:0}\n.ql .rp-head p{font-size:13px;color:var(--muted);margin-top:8px;line-height:1.5}\n.ql .rp-destination{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:3px 7px;border:1px solid var(--border);border-radius:6px;flex:none;color:var(--muted)}\n\n.ql .rp-body{padding:18px 22px;overflow:auto;display:grid;gap:16px;min-height:0;align-content:start;grid-auto-rows:max-content}\n.ql .rp-field{display:grid;gap:7px;font-size:13px;font-weight:500}\n.ql .rp-field input,.ql .rp-field textarea,.ql .rp-field select{width:100%;font-size:13.5px;font-weight:400;line-height:1.5;padding:9px 11px;background:var(--bg);border:1px solid var(--bstrong);border-radius:8px;color:var(--text)}\n.ql .rp-field textarea{resize:vertical;min-height:112px}\n.ql .rp-field input::placeholder,.ql .rp-field textarea::placeholder{color:var(--dim)}\n.ql .rp-notice{display:flex;align-items:flex-start;gap:9px;font-size:13px;line-height:1.55;color:var(--muted)}\n.ql .rp-notice svg{margin-top:3px}\n.ql .rp-notice p{margin:0}\n.ql .rp-notice strong{font-weight:500;color:var(--text)}\n.ql .rp-settings{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}\n.ql .rp-settings b{font-size:13px;font-weight:500}\n.ql .rp-settings p{color:var(--muted);font-size:12.5px;line-height:1.5;margin-top:3px}\n.ql .rp-details{margin-top:9px;font-size:12.5px;color:var(--muted)}\n.ql .rp-details summary{cursor:pointer;color:var(--accent);width:fit-content}\n.ql .rp-details dl{display:grid;grid-template-columns:110px minmax(0,1fr);gap:5px 12px;margin:10px 0 0;padding:11px;background:var(--sunk);border:1px solid var(--border);border-radius:8px}\n.ql .rp-details dt{color:var(--dim)}\n.ql .rp-details dd{margin:0;overflow-wrap:anywhere}\n.ql .rp-support{padding-top:13px;border-top:1px solid var(--border);font-size:12.5px;color:var(--muted)}\n.ql .rp-support button{margin-top:5px}\n.ql .rp-foot{padding:14px 22px;border-top:1px solid var(--border);display:flex;align-items:center;gap:9px;justify-content:flex-end;flex:none;background:var(--bg)}\n.ql .rp-foot .rp-foot-note{font-size:12px;line-height:1.4;color:var(--muted);margin-right:auto;max-width:240px}\n.ql .rp-preview{border:1px solid var(--border);border-radius:8px;overflow:hidden}\n.ql .rp-preview-head{padding:11px 14px;background:var(--sunk);border-bottom:1px solid var(--border);font-size:12px;color:var(--muted)}\n.ql .rp-preview article{padding:17px;display:grid;gap:13px}\n.ql .rp-preview h3{font-size:17px;font-weight:600;line-height:1.4;overflow-wrap:anywhere}\n.ql .rp-preview pre{font:13px/1.6 Geist,system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}\n.ql .rp-preview .rp-system{font-size:12px;color:var(--muted);padding-top:12px;border-top:1px solid var(--border);line-height:1.6}\n.ql .rp-state{padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;line-height:1.5;display:flex;gap:8px;align-items:flex-start}\n.ql .rp-state svg{flex:none;margin-top:2px}\n.ql .rp-state.error{color:var(--danger);border-color:var(--danger-line);background:var(--danger-soft)}\n.ql .rp-state.accepted{color:var(--text);background:var(--sunk)}\n.ql .rp-success{padding:12px 0;display:grid;justify-items:start;gap:14px}\n.ql .rp-success h3{font-size:18px}\n.ql .rp-success p{font-size:13px;line-height:1.6;color:var(--muted)}\n.ql .rp-foot{flex-wrap:wrap}\n.ql .rp-foot .rp-foot-note{flex-basis:100%;max-width:none}\n.ql .rp-head,.ql .rp-body,.ql .rp-foot{padding-left:16px;padding-right:16px}\n.ql .rp-head-top{flex-wrap:wrap}\n\n.ql .rp-heading{display:flex;align-items:center;gap:10px;min-width:0}\n.ql .rp-heading-icon{width:30px;height:30px;border:1px solid var(--border);border-radius:8px;display:grid;place-items:center;background:var(--sunk);color:var(--muted);flex:none}\n.ql .rp-head .rp-head-top{align-items:center}\n.ql .rp-body>.seg{display:flex;gap:4px;padding:4px;border:1px solid var(--border);border-radius:9px;background:var(--sunk)}\n.ql .rp-body>.seg button{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;min-height:34px;padding:6px 10px;font-size:12.5px;line-height:1.3;border-radius:6px}\n.ql .rp-body>.seg .seg-ic{color:var(--dim)}\n.ql .rp-body>.seg .on .seg-ic{color:var(--text)}\n.ql .rp-section-name{display:flex;align-items:center;gap:7px}\n.ql .rp-section-name .ic{color:var(--muted)}\n.ql .rp-support>p{display:flex;align-items:center;gap:7px}\n.ql .rp-support>button{margin-left:21px}\n.ql .rp-preview-head{display:flex;align-items:center;gap:7px}\n.ql .rp-success>.ic{color:var(--accent)}\n\n.ql .proposal-report-inline{height:30px;padding:4px 7px;display:inline-flex;align-items:center;gap:6px;flex:none;border:0;border-radius:7px;background:transparent;color:var(--muted);font:500 12px/1.3 Geist,system-ui,sans-serif;white-space:nowrap;cursor:pointer}\n.ql .proposal-report-inline:hover{background:var(--s2);color:var(--text)}\n.ql .proposal-report-inline .ic{color:var(--muted);stroke-width:1.65}\n.ql .proposal-report-inline:focus-visible{outline:2px solid var(--accent);outline-offset:2px}\n.ql .foot-row:has(.proposal-report-inline){gap:3px}\n.ql .foot-row:has(.proposal-report-inline.compact)>.ib{width:26px}\n\n.ql .rp-attachments{display:grid;gap:8px}\n.ql .rp-attachment-label{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12.5px}\n.ql .rp-attachment-label b{font-weight:500}\n.ql .rp-attachment-label span{color:var(--dim);font-size:11.5px}\n.ql .rp-shot-list{display:flex;align-items:stretch;gap:8px;flex-wrap:wrap}\n.ql .rp-add-shot{width:108px;min-height:64px;padding:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;border:1px dashed var(--bstrong);border-radius:8px;background:var(--sunk);color:var(--muted);font-size:12px}\n.ql .rp-add-shot:hover{color:var(--text);border-color:var(--accent)}\n.ql .rp-shot{position:relative;width:108px;height:72px;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--sunk)}\n.ql .rp-shot img{width:100%;height:100%;object-fit:contain}\n.ql .rp-shot>button{position:absolute;top:3px;right:3px;width:22px;height:22px;display:grid;place-items:center;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text)}\n.ql .rp-included{margin-top:0}\n.ql .rp-included summary{display:flex;align-items:center;gap:7px;font-size:12.5px;list-style:none}\n.ql .rp-included summary::after{content:'\u25be';color:var(--dim);font-size:10px}\n.ql .rp-included[open] summary::after{content:'\u25b4'}\n.ql .rp-private-link{font-size:12px}\n.ql .rp-private-reply{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);line-height:1.5;flex-wrap:wrap}\n.ql .rp-public-shots{display:grid;gap:10px}\n.ql .rp-public-shots figure{margin:0}\n.ql .rp-public-shots img{max-width:100%;max-height:280px;display:block;border:1px solid var(--border);border-radius:6px}\n.ql .rp-public-shots figcaption{font-size:11.5px;color:var(--muted);margin-top:5px}\n\n.ql .rp-utility-row{display:flex;align-items:center;gap:16px;min-height:26px;color:var(--muted);font:400 13px/1.5 Geist,system-ui,sans-serif}\n.ql .rp-utility-row .rp-privacy{display:inline-flex;align-items:center;gap:7px;margin:0;white-space:nowrap;font:inherit;color:inherit}\n.ql .rp-system-disclosure{position:relative;margin-left:auto;font:inherit;color:inherit}\n.ql .rp-system-disclosure summary{display:inline-flex;align-items:center;gap:6px;cursor:pointer;list-style:none;white-space:nowrap;font:inherit;color:inherit}\n.ql .rp-system-disclosure summary::-webkit-details-marker{display:none}\n.ql .rp-system-disclosure summary:hover,.ql .rp-utility-link:hover{color:var(--text)}\n.ql .rp-system-disclosure[open] summary>.ic:last-child{transform:rotate(180deg)}\n.ql .rp-system-disclosure dl{position:absolute;right:0;bottom:calc(100% + 10px);z-index:3;width:280px;max-width:calc(100vw - 64px);display:grid;grid-template-columns:90px minmax(0,1fr);gap:8px 12px;padding:14px;margin:0;border:1px solid var(--border);border-radius:8px;background:var(--bg);box-shadow:var(--pop);font:inherit;color:var(--text)}\n.ql .rp-system-disclosure dt{color:var(--muted)}\n.ql .rp-system-disclosure dd{margin:0;overflow-wrap:anywhere}\n.ql .rp-utility-link{display:inline-flex;align-items:center;gap:4px;padding:0;border:0;background:none;cursor:pointer;white-space:nowrap;font:inherit;color:inherit}\n.ql .rp-foot .btn{font-size:13px}\n.ql .rp-foot{gap:8px}\n.ql .rp-utility-row{justify-content:space-between;gap:12px;font-size:12px}\n.ql .rp-support-action{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;padding:0;color:var(--muted);font:400 13px/1.5 Geist,system-ui,sans-serif;cursor:pointer}\n.ql .rp-support-action:hover{color:var(--text)}\n.ql .rp-shot-list:not(:has(.rp-shot)) .rp-add-shot{width:100%;min-height:42px;flex-direction:row;gap:8px}\n\n.ql .scrim:has(>.rp-sheet){padding:24px;align-items:center;overflow:hidden}\n.ql .rp-sheet{max-height:calc(100dvh - 92px)}\n.ql .rp-body{flex:1 1 auto;min-height:0;overflow:auto}\n\n.ql .rp-body{align-content:start;grid-auto-rows:max-content;scrollbar-width:thin;scrollbar-color:var(--bstrong) var(--sunk)}\n.ql .rp-body::-webkit-scrollbar{width:8px}\n.ql .rp-body::-webkit-scrollbar-track{background:var(--sunk)}\n.ql .rp-body::-webkit-scrollbar-thumb{background:var(--bstrong);border-radius:4px}\n.ql .rp-preview article{padding-bottom:22px}"; document.head.append(style); }
  function FeedbackDialog ({ app }) {
    const [stage, setStage] = useState(reportParameters.get("state") === "background-created" ? "sent" : reportParameters.get("state") === "preview-images" ? "preview" : ["images", "idea", "update"].includes(reportParameters.get("state")) ? "form" : reportParameters.get("state") || "form");
    const [kind, setKind] = useState(reportParameters.get("state") === "idea" ? "idea" : "bug");
    const [title, setTitle] = useState(reportParameters.get("state") === "idea" ? "Connect the App to a remote server" : "New task closes when I reopen the agent list");
    const [text, setText] = useState(reportParameters.get("state") === "idea" ? "My projects and coding agents run on a separate server. I want to use the desktop App as its frontend through my existing SSH connection." : "I opened New task and clicked the agent list twice.\n\nThe whole New task dialog closed. I expected only the list to close, with my request still there.");
    const system = true;
    const [screenshots, setScreenshots] = useState(["images", "preview-images"].includes(reportParameters.get("state")) ? [{ name: "example-screenshot.png", source: "report-example.png" }] : []);
    const imageInput = useRef(null);
    const addScreenshots = (files) => { for (const file of Array.from(files || []).slice(0, 5 - screenshots.length)) { if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) { app.toast("Choose a PNG, JPEG or WebP image up to 5 MB."); continue; } const reader = new FileReader(); reader.onload = () => setScreenshots((held) => held.length < 5 ? held.concat({ name: file.name, source: reader.result }) : held); reader.readAsDataURL(file); } };
    const [error, setError] = useState(false);
    const container = useRef(null);
    const open = app.s.dialog === "feedback";
    // A retained queued result reads its current owner-bound receipt on reopen; no submit or timer.
    useEffect(() => { if (open && stage === "queued" && app.s.reportingBackgroundCreated) setStage("sent"); }, [open, stage, app.s.reportingBackgroundCreated]);
    const close = () => { if (stage === "sent" || stage === "private-copy-pending" || stage === "private-sent") { setStage("form"); setTitle(""); setText(""); setScreenshots([]); } app.set({ dialog: null }); };
    useReportPreviewState((next) => { setError(next === "error"); if (["images", "preview-images"].includes(next)) setScreenshots([{ name: "example-screenshot.png", source: "report-example.png" }]); if (next === "idea") { setKind("idea"); setTitle("Connect the App to a remote server"); setText("My projects and coding agents run on a separate server. I want to use the desktop App as its frontend through my existing SSH connection."); } setStage(next === "background-created" ? "sent" : next === "error" || next === "preview-images" ? "preview" : ["images", "idea"].includes(next) ? "form" : next); app.set({ dialog: "feedback" }); });
    useEffect(() => {
      if (!open) return;
      const previous = document.activeElement;
      (container.current?.querySelector('input:not([type="file"]),textarea') || container.current?.querySelector("button"))?.focus();
      const keyboard = (event) => {
        if (event.key === "Escape") { event.stopPropagation(); close(); }
        if (event.key !== "Tab") return;
        const controls = [...(container.current?.querySelectorAll("button:not([disabled]),input,textarea,select,a[href],summary") || [])].filter((element) => element.getClientRects().length);
        if (!controls.length) return;
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
      };
      document.addEventListener("keydown", keyboard);
      return () => { document.removeEventListener("keydown", keyboard); if (previous?.isConnected) previous.focus(); };
    }, [open, stage]);
    if (!open) return null;
    const isPrivate = stage === "private" || stage === "private-sent";
    const heading = stage === "preview" ? "Review your public issue" : stage === "sent" ? "Issue created" : stage === "uncertain" ? "Check your report status" : stage === "private-copy-pending" ? "Issue created" : stage === "queued" ? "Saved to send when you’re online" : stage === "private-sent" ? "Sent to Max" : isPrivate ? "Contact Max privately" : "Bugs and ideas";
    return <div className="scrim"><section ref={container} className="dialog rp-sheet" role="dialog" aria-modal="true" aria-labelledby="report-title" data-screen-label="Reporting" id="reporting-flow">
      <header className="rp-head"><div className="rp-head-top"><div className="rp-heading"><span className="rp-heading-icon"><Icon name={isPrivate ? "lock" : stage === "preview" ? "scan-eye" : stage === "sent" ? "circle-check" : stage === "queued" ? "clock" : kind === "idea" ? "sparkles" : "bug"} size={18} /></span><h2 id="report-title">{heading}</h2></div></div><p>{isPrivate ? stage === "private-sent" ? "Your report was delivered privately." : "For account details, private screenshots or a security concern." : <>Public issue in <a href="https://github.com/maxritter/qualitylayer/issues" target="_blank" rel="noopener noreferrer">maxritter/qualitylayer</a>. Anyone can read it.</>}</p></header>
      <div className="rp-body">
        {stage === "form" && kind === "bug" ? <ReportUpdateNote app={app} /> : null}
        {stage === "form" ? <>
          <Seg label="Kind of report" value={kind} options={[{ value: "bug", label: "Report a bug", icon: "bug" }, { value: "idea", label: "Suggest an improvement", icon: "sparkles" }]} onChange={setKind} />
          <label className="rp-field">Title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={kind === "bug" ? "A short description of the problem" : "A short name for the idea"} autoFocus /></label>
          <label className="rp-field">{kind === "bug" ? "What happened?" : "What would you like to improve?"}<textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} placeholder={kind === "bug" ? "What you did, what happened and what you expected." : "What you want to do and how this would help."} /></label>
          <section className="rp-attachments" aria-label="Screenshots"><div className="rp-attachment-label"><b>Screenshots</b><span>Optional · public</span></div><div className="rp-shot-list">{screenshots.map((shot, index) => <div className="rp-shot" key={index}><img src={shot.source} alt={shot.name} /><button type="button" aria-label={"Remove screenshot " + shot.name} onClick={() => setScreenshots((held) => held.filter((_, at) => at !== index))}><Icon name="x" size={12} /></button></div>)}{screenshots.length < 5 ? <button type="button" className="rp-add-shot" onClick={() => imageInput.current?.click()}><Icon name="image" size={17} /><span>Add screenshot</span></button> : null}<input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { addScreenshots(event.target.files); event.target.value = ""; }} /></div></section>
          <div className="rp-utility-row"><p className="rp-privacy"><Icon name="eye" size={14} />Keep private information out.</p><details className="rp-system-disclosure"><summary aria-label="Show system details, always included"><Icon name="cpu" size={14} />System details · included<Icon name="chevron-down" size={12} /></summary><dl><dt>QualityLayer</dt><dd>12.1.0</dd><dt>System</dt><dd>macOS 26.6 · arm64</dd><dt>Agent</dt><dd>Claude Code 2.1.308</dd></dl></details></div>
        </> : stage === "preview" ? <>
          <div className="rp-notice"><Icon name="eye" size={15} /><p>This is everything that will appear publicly. Your account name and email are not added.</p></div>
          <div className="rp-preview"><div className="rp-preview-head"><Icon name={kind === "bug" ? "bug" : "sparkles"} size={14} />{kind === "bug" ? "Bug report" : "Improvement"} · maxritter/qualitylayer</div><article><h3>{title}</h3><pre>{text}</pre>{screenshots.length ? <div className="rp-public-shots">{screenshots.map((shot, at) => <figure key={at}><img src={shot.source} alt={shot.name} /><figcaption>Screenshot {at + 1}</figcaption></figure>)}</div> : null}{system ? <div className="rp-system">QualityLayer 12.1.0 · macOS 26.6 · arm64<br />Claude Code 2.1.308</div> : null}</article></div>
          {error ? <div className="rp-state error" role="alert"><Icon name="circle-alert" size={15} /><span>The issue could not be created. Your report is still here. Try again or go back to edit it.</span></div> : null}
        </> : (stage === "sent" || stage === "private-copy-pending") ? <div className="rp-success"><h3>{title}</h3><p>I’ll reply in the GitHub issue. You can add details there too.</p><button type="button" className="btn pri" onClick={() => app.toast("Prototype: the production response supplies the actual issue link.")}>View your GitHub issue<Icon name="arrow-up-right" size={14} /></button></div>
        : stage === "uncertain" ? <div className="rp-success"><Icon name="circle-alert" size={24} /><p>GitHub may have received your report. Automatic retry is paused and your draft is kept. Check the issue tracker before sending again.</p></div>  : stage === "queued" ? <div className="rp-success"><Icon name="clock" size={24} /><p>The public issue you reviewed is saved on this computer for up to 30 days. The App will send this exact version when the connection returns, using the same licence or trial.</p><button type="button" className="lnk" onClick={() => setStage("form")}>Edit the report before it is sent</button><button type="button" className="lnk" onClick={() => { setStage("form"); app.toast("Queued publication cancelled in this prototype. The draft is kept."); }}>Cancel sending and keep the draft</button></div>
        : stage === "private-sent" ? <div className="rp-success"><p>Thanks for taking the time to report this. I’ll read your message and attachments. — Max</p><p className="rp-private-reply">Reference <b>QL-42</b></p></div>
        : <><Seg label="Kind of report" value={kind} options={[{ value: "bug", label: "Report a bug", icon: "bug" }, { value: "idea", label: "Suggest an improvement", icon: "sparkles" }]} onChange={setKind} /><label className="rp-field">Your message<textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} /></label><div className="rp-utility-row"><details className="rp-system-disclosure"><summary aria-label="Show system details, always included"><Icon name="cpu" size={14} />System details · included<Icon name="chevron-down" size={12} /></summary><dl><dt>QualityLayer</dt><dd>12.1.0</dd><dt>System</dt><dd>macOS 26.6 · arm64</dd><dt>Agent</dt><dd>Claude Code 2.1.308</dd></dl></details></div><p className="rp-private-reply">From <b>{QL.data.me.email}</b>, the email on your licence.</p><button type="button" className="btn" onClick={() => app.toast("Prototype: a private attachment picker opens here.")}><Icon name="paperclip" size={14} />Add a private attachment</button><p className="rp-notice">Your message and attachments go privately to Max. Avoid passwords, API keys and other credentials.</p></>}
        {stage !== "preview" ? <p className="rp-private-reply"><span>You can also email me at <a href="mailto:hello@qualitylayer.dev">hello@qualitylayer.dev</a>.</span></p> : null}
      </div>
      <footer className="rp-foot">{stage === "form" ? <><button type="button" className="rp-support-action" onClick={() => setStage("private")}><Icon name="lock" size={14} />Private support</button><span className="sp" /><Btn onClick={close}>Cancel</Btn><Btn pri icon="scan-eye" disabled={!title.trim() || !text.trim()} onClick={() => { setError(false); setStage("preview"); }}>Preview public issue</Btn></> : stage === "preview" ? <><Btn onClick={() => setStage("form")}>Back to edit</Btn><Btn pri icon="send" onClick={() => setStage("sent")}>{error ? "Try again" : "Create public GitHub issue"}</Btn></> : stage === "private" ? <><Btn onClick={() => setStage("form")}>Back</Btn><Btn pri icon="mail" disabled={!text.trim()} onClick={() => setStage("private-sent")}>Send privately</Btn></> : <Btn pri onClick={close}>Done</Btn>}</footer>
    </section></div>;
  };

  /** Who a task is shared with. A task starts "Not shared" (as the App does); a page that previews teammates reading it (teamPreview, ?seen) starts shared with the team. */
  const audienceOf = (app) => app.s.shareAudience || (app.s.teamPreview || new URLSearchParams(window.QL_PREVIEW_QUERY ?? location.search).get("seen") ? "team" : "only");
  function taskReaders(app) {
    const state = ["empty", "many"].includes(app.s.teamPreview) ? app.s.teamPreview : new URLSearchParams(window.QL_PREVIEW_QUERY ?? location.search).get("seen");
    if (app.s.teamSeenUnknown || state === "unknown") return null;
    if (state === "empty" || audienceOf(app) === "only") return [];
    return state === "many" ? QL.data.team.large.slice(0, 4) : QL.data.team.members.filter(person => !person.you).slice(0, 1);
  }

  function SharePop({ app }) {
    const { s } = app;
    const [reviewPicked, setReviewPicked] = useState({});
    const [reviewError, setReviewError] = useState(false);
    const sheet = React.useRef(null);
    useEffect(() => {
      if (s.pop !== "share") return;
      const close = (event) => {
        if (event.key === "Escape") { event.stopPropagation(); app.set({ pop: null }); }
        if (event.key !== "Tab" || !sheet.current) return;
        const controls = [...sheet.current.querySelectorAll("button:not([disabled]),select,input")];
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      };
      document.addEventListener("keydown", close);
      return () => { document.removeEventListener("keydown", close); document.querySelector('[aria-label="Share"]')?.focus(); };
    }, [s.pop]);
    const team = audienceOf(app);
    const link = !!s.shareLink;
    const readers = taskReaders(app);
    const unknown = readers === null;
    const people = s.teamPreview === "many" && !unknown ? readers : QL.data.team.members.filter((person) => !person.you && (team !== "only" || s.shareReviews?.[person.name]));
    const artifacts = !!s.shareArtifacts;
    const setArtifacts = (on) => app.set({ shareArtifacts: on });
    if (s.pop !== "share") return null;
    return (
      <div className="scrim team-share-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) app.set({ pop: null }); }} onKeyDown={(event) => { if (event.key === "Escape") app.set({ pop: null }); }}>
        <div ref={sheet} className="dialog team-share-sheet" role="dialog" aria-modal="true" aria-labelledby="team-share-title">
          <header className="row"><h3 id="team-share-title">Share {QL.data.task.title}</h3></header>
          {/* One row per section, led by its meaning-map mark; the helper sentence is behind the info mark (SHELL-19). The select takes the first focus; Close is the last stop. */}
          <section className="ts-row" data-testid="share-team">
            <span className="ts-l"><Icon name="users" size={14} /><span>Your team</span><QL.InfoHint id="team-share-team-hint" label="Your team" text={team === "only" ? "Not shared yet. Pick who can read it and answer questions" : "Everyone " + (team === "group" ? "in Platform" : "on the team") + " can read it and answer questions"} /></span>
            <QL.Select label="Who can see it" value={team} options={[{ value: "only", label: "Not shared" }, { value: "group", label: "Platform group" }, { value: "team", label: "Whole team" }]} onChange={(value) => app.set({ shareAudience: value })} />
          </section>

          <section><h4>People with access</h4><ul className="team-share-people"><li data-testid="share-you"><span className="av">{(QL.data.team.members.find((person) => person.you) || {}).initials || "SR"}</span><span>You</span></li>{people.map(person => <li key={person.name}><span className="av">{person.initials || person.name.split(" ").map(word => word[0]).slice(0, 2).join("")}</span><span>{person.name}{s.shareReviews?.[person.name] ? <small>Review asked</small> : null}</span>{!unknown ? <span className="dim">{readers.some(reader => reader.name === person.name) ? "Seen 25 min ago" : "Not opened yet"}</span> : null}</li>)}</ul></section>
          <section data-testid="share-review"><div className="ts-l"><Icon name="messages-square" size={14} /><span>Ask for a review</span><QL.InfoHint id="team-share-review-hint" label="Ask for a review" text="They review the Plan. Your approval waits for their answers." /></div><p className="team-share-note">Your approval waits for their answers</p><div className="team-share-review" data-testid="review-picker">{QL.data.team.members.filter((person) => !person.you).map((person) => <label key={person.name}><input type="checkbox" className="ts-check" checked={!!reviewPicked[person.name]} onChange={(event) => setReviewPicked(Object.assign({}, reviewPicked, { [person.name]: event.target.checked }))} /><span className="av" aria-hidden="true">{person.initials || person.name.split(" ").map(word => word[0]).slice(0, 2).join("")}</span>{person.name}</label>)}{reviewError ? <p role="alert">The request was not sent. Try again.</p> : null}{(() => { const asked = Object.keys(reviewPicked).filter((name) => reviewPicked[name]); return <Btn sm pri={asked.length > 0} disabled={!asked.length} onClick={() => { if (s.teamSendFailure) { app.set({teamSendFailure:false}); setReviewError(true); return; } setReviewError(false); app.set({ shareReviews: Object.assign({}, s.shareReviews, reviewPicked) }); app.toast("Review requested · simulated. Their answers return to this task."); }}>{asked.length === 0 ? "Ask for a review" : asked.length === 1 ? "Ask " + asked[0].split(" ")[0] : "Ask " + asked.length + " people"}</Btn>; })()}</div></section>
          <div className="ts-row" data-testid="share-artifacts"><span className="ts-l"><Icon name="shapes" size={14} /><span>Task artifacts</span><QL.InfoHint id="team-share-artifacts-hint" label="Sharing limits" text="With this task's team copy and outside link. Shared previews run without scripts. Up to 12 artboards; 160 KB each, within the workflow's total size limit." /></span><label className="ts-pick"><input type="checkbox" className="ts-check" aria-label="Include task artifacts in sharing" aria-describedby="team-share-artifacts-hint" checked={artifacts} onChange={(event) => setArtifacts(event.target.checked)} /><span>Include artifacts</span></label></div>
          <section data-testid="share-link"><div className="ts-l"><Icon name="link" size={14} /><span>Link for people outside the team</span><QL.InfoHint id="team-share-link-hint" label="Link for people outside the team" text="Anyone with the link reads the plan and gives feedback; project source code is kept private." /></div><div className="ts-row"><p className="team-share-note">Read and give feedback only{link ? " · runs out in 14 days" : ""} · encrypted before it leaves this computer</p><div className="row">{link ? <><Btn sm onClick={() => app.copy("share", "https://qualitylayer.dev/s/8f2kq1")}>{s.copied === "share" ? "Copied" : "Copy link"}</Btn><Btn sm quiet onClick={() => app.toast("Link renewed for 14 days · simulated")}>Renew</Btn><Btn sm quiet onClick={() => app.set({ shareLink: false })}>Revoke</Btn></> : <Btn sm onClick={() => app.set({ shareLink: true })}>Create link</Btn>}</div></div></section>
          <IconBtn icon="x" sm label="Close" className="ts-close" onClick={() => app.set({ pop: null })} />
        </div>
      </div>
    );
  }

  function PathPop({ app }) {
    const { s } = app;
    const path = QL.data.task.files.folder + "/" + s.route.file;
    const item = (icon, l, n, fn) => (
      <button type="button" className="mi" onClick={() => { app.set({ pop: null }); fn && fn(); }}><Icon name={icon} size={14} /><span>{l}</span><span className="n">{n || ""}</span></button>
    );
    return (
      <Popover open={s.pop === "path"} onClose={() => app.set({ pop: null })} align="left" style={{ width: 300 }}>
        <div className="menu">
          {item("copy", "Copy path", "", () => app.copy("path", path))}
          {item("copy", "Copy the task's name", "for QualityLayer", () => app.copy("task-name", QL.data.task.slug))}
          {item("external-link", "Open in its app", "", () => app.toast("Opens " + s.route.file + " in your editor"))}
          {item("folder-open", "Reveal in Finder", "", () => app.toast("Reveals the task folder"))}
          <div className="menu-sep" />
          {item("copy", "Copy formatted", "Docs, Notion", () => app.toast("Copied as rich text"))}
          {item("copy", "Copy as Markdown", (s.route.file === QL.currentReaderFile?.("plan") || s.route.file === QL.data.task.files.docs.plan[0]) ? "Jira, GitHub, Linear · names only; plan export writes picture files" : "GitHub, Jira", () => app.toast("Copied as Markdown"))}
          {QL.currentReaderDocument?.(s.route.file, app) ? (s.route.file === QL.currentReaderFile?.("plan") && QL.currentReaderHasBuildPrompt?.(app) ? item("square-terminal", "For another agent", "A prompt that starts the build in any agent", () => app.toast("Prototype: For another agent. No clipboard content changed.")) : null) : item("square-terminal", "For another agent", "after approval", () => app.toast("Copied a prompt that points another agent at this Plan"))}
          <div className="menu-sep" />
          {QL.currentReaderDocument?.(s.route.file, app) ? null : item("list", "The working sections", "contracts, patterns, spikes, risks", () => app.openSection("plan", "contracts"))}
          {item("rotate-ccw", "What the agent changed", "the Plan's diff", () => app.toast("The Plan's diff opens as Was and Now on each changed point"))}
        </div>
      </Popover>
    );
  }

  /* ── top bar ── */
  function TopBar({ app }) {
    const { s, v, go } = app;
    const t = QL.data.task;
    // A task's draft opens inside the task: the App keeps the task's header and its three steps (TaskView), so the draft's page is a page of the task.
    // New task and New chat are cards over the page, so the page keeps its header.
    const onTask = s.route.view === "task" || s.route.view === "artifact";
    const onArtifact = false;
    const artifact = onArtifact ? t.plan.artifacts.find((item) => item.id === s.route.artifactId) || t.plan.artifacts[0] : null;
    const title = onTask ? (s.handback ? t.handback.title : s.light ? t.light.title : t.title) : onArtifact ? artifact.title : s.route.view === "home" ? "Home" : s.route.view === "team" ? "Team" : s.route.view === "settings" ? "Settings" : s.route.view === "artifacts" ? "Artifacts" : "";
    const narrow = app.width <= 640;
    // A Chat uses the same approved header, with its view switch, session chip and Convert to task.
    const chatBar = !!QL.CHAT_TASK;
    const headerProposal = onTask;
    const archiveChat = (fallback) => () => { if (chatBar && QL.chatArchive) { app.set({ pop: null }); QL.chatArchive(app); return; } fallback(); };
    const headerLayout = headerProposal;
    const changesOverflow = false;
    // Below 1200 px the branch pill has lost its name: Copy branch name, Show task folder, Archive and Delete wait in More (UI review, SHELL-13).
    const fold = headerProposal && app.width > 480 && (window.QL_WNN_MODE !== "current" ? !!app.wnnFold : app.width < 1200);
    const directLifecycle = headerProposal && app.width > 480 && (window.QL_WNN_MODE !== "current" ? Number(app.wnnFold) < 3 : !fold);
    const contextFolded = headerProposal && (app.width <= 480 || Number(app.wnnFold) > 1);
    const headerState = new URLSearchParams(window.QL_PREVIEW_QUERY ?? location.search).get("state");
    const [proposalArchived, setProposalArchived] = useState(headerState === "archived");
    const archived = headerProposal ? proposalArchived : s.archived;
    const busy = headerProposal && headerState === "busy";
    const menuStage = headerProposal ? v.stage : t.stage;
    if (s.route.view === "settings" && narrow && s.pop !== "new") return (
      <div className="tb tb-settings-current" data-testid="top-bar" data-view="settings">
        <Btn sm quiet aria-label="Menu" title="Tasks, search and settings" onClick={() => app.set({ sheet: true })}>Menu</Btn>
        <Logo /><b className="settings-topbar-title">QualityLayer</b><span className="sp" />
        {/* Settings has no bell; New is the same + menu as the sidebar's. */}
        <NewMenu app={app} />
      </div>
    );
    return (
      <div className={"tb" + (headerProposal ? " tb-header-proposal" : "") + (headerLayout ? " tb-header-layout-proposal" : "")} data-compact-changes={changesOverflow ? "true" : undefined} data-testid="top-bar" data-view={s.pop === "new" ? "new" : s.route.view}>
        {(!s.navOpen && !navRailShown(app)) || narrow ? (
          <>
            {/* No bell (Max, 2 November 2026): while the task list is hidden its toggle carries Home's Needs-you count. */}
            <IconBtn icon="panel-left" label={navigationHint((narrow ? "Menu" : "Show the task list") + (needsYouOf(app) ? " · " + needsYouOf(app) + " need you" : ""), "B")} side="right" badge={needsYouOf(app) ? (needsYouOf(app) > 9 ? "9+" : needsYouOf(app)) : null} onClick={() => narrow ? app.set({ sheet: true }) : app.set({ navOpen: true })} />
            {/* As the App: on a task or an artifact the toggle is followed by the breadcrumb alone; the logo and New live in the sidebar and the Home bar. */}
            {onTask || onArtifact ? null : <Logo />}
            {onTask || onArtifact ? null : <><NewMenu app={app} />
            <span className="tb-sep" /></>}
          </>
        ) : null}
        {onTask || onArtifact ? <span className="tb-origin" data-origin-host="true"><Origin f={v.taskProject} /><span className="tb-sl" aria-hidden="true">/</span></span> : null}
        {s.route.view === "home" ? null : <span className="title" title={title}>{title}</span>}
        {chatBar && !s.loading && QL.ChatViewSwitch ? <QL.ChatViewSwitch app={app} /> : null}
        {/* While a task opens the header is the loaded one's band alone (TaskLoading.tsx): the toggle (with its Needs-you count), project and title; the task's own controls wait. */}
        {onTask && !s.loading ? <span className="kind">{t.kind}</span> : null}
        {onTask && !s.loading ? <span className="tb-sep" /> : null}
        <span className="sp" />
        {onArtifact ? <><button type="button" className="chip" onClick={() => app.set({railOpen:true,railTab:"agent"})}><Mark state={s.artifactAgents?.[artifact.id]?.status === "running" ? "work" : "open"} sm/>Agent</button><Btn sm quiet onClick={() => app.unread()}>Back to task</Btn><IconBtn icon="panel-right" label={navigationHint((s.railOpen ? "Hide" : "Show") + " artifact sidebar", "J")} side="left" on={s.railOpen} onClick={() => app.set({railOpen:!s.railOpen})}/></> : null}
        {headerLayout && !s.loading && !changesOverflow && !narrow ? <span className="tb-header-change-group"><button type="button" className="tb-task-branch" title={"View changes on " + (t.branch || "this task")} onClick={() => QL.openWorkspace(app,null)}><Icon name={t.branch ? "git-branch" : "file-code"} size={13}/>{t.branch ? <><span className="tb-branch-name">{t.branch}</span><span className="tb-branch-separator">·</span></> : null}<span>Changes</span>{QL.data.pr.files > 0 ? <b className="mono">{QL.data.pr.files}</b> : null}</button></span> : null}
        {chatBar && !s.loading && QL.ChatAgentChip ? <QL.ChatAgentChip app={app} /> : null}
        {onTask && !QL.CHAT_TASK && !s.loading ? (
          <span style={{ position: "relative", minWidth: 0, display: "inline-flex" }}>
            {(() => {
              // No App session: the chip names what the sidebar knows (no installed agent, or the agent used outside), never a fixture agent.
              const none = !s.run && Array.isArray(s.config.installedAgents) && !s.config.installedAgents.length;
              const outside = !s.run && !none && s.externalAgent === "other";
              const word = s.run ? AGENT_WORD[s.run.agent] || "Agent" : none ? "No agent connected" : outside ? "Another agent" : v.agent.name;
              return <button type="button" className="chip" aria-label={"Agent status · " + word} data-pop-anchor onClick={() => app.togglePop("status")}><Mark state={none || outside ? "open" : s.run?.state === "stopped" ? "open" : s.run?.state === "failed" ? "stop" : v.yourTurn ? "you" : "work"} sm />{none || outside ? null : <QL.AgentMark agent={s.run ? s.run.agent : v.agent.name} size={14} />}<b>{word}</b><Icon name="chevron-down" size={12} className="chip-chev" /></button>;
            })()}
            <StatusPop app={app}/>
          </span>
        ) : null}
        {headerLayout && !narrow && !s.loading ? <span className="tb-header-agent-divider" aria-hidden="true" /> : null}
        {/* One order on every header (Max, 2 November 2026): labelled actions (Share, Cost) · icon utilities · More · Archive, Delete · sidebar toggle. */}
        {onTask && !s.loading && !contextFolded ? (
          <span style={{ position: "relative", display: "inline-flex" }}>
            <IconBtn icon={QL.ICON["usage.cost"]} label="Cost" on={s.pop === "cost"} data-pop-anchor onClick={() => app.togglePop("cost")} aria-haspopup="dialog" aria-expanded={s.pop === "cost"} />
            <CostPop app={app} />
          </span>
        ) : null}
        {onTask && s.loading ? null : onTask ? (
          <span className="acts">
            {headerProposal && !fold ? <span className="tb-header-agent-divider" aria-hidden="true" /> : null}
            {headerProposal && (!fold || directLifecycle) ? <>
              <span className="tb-direct-actions">{chatBar && !QL.sesOtherProject?.() ? <IconBtn icon="file-diff" label="View changes · 5 files" onClick={() => QL.openWorkspace(app, null)} /> : null}{!fold ? <>              <IconBtn icon="folder-open" label="Show task folder" onClick={() => app.toast("Show task folder · simulated; no folder opened")} /></> : null}</span>
            </> : null}
            {!headerProposal || app.width<=480 || changesOverflow || fold ? <span className="tb-more">
              <IconBtn icon="ellipsis" label="More" on={s.pop === "more"} data-pop-anchor aria-haspopup="menu" aria-expanded={s.pop === "more"} onClick={() => app.togglePop("more")} />
              <Popover open={s.pop === "more"} onClose={() => app.set({ pop: null })} label="More">
                <div className="menu" role="menu">
                  {contextFolded ? <><button type="button" role="menuitem" className="mi" onClick={() => app.togglePop("cost")}><Icon name="coins" size={14}/><span>Cost</span></button></> : null}
                  {!headerProposal || app.width<=480 || fold ? <>{chatBar && !QL.sesOtherProject?.() && !(headerProposal && app.width > 480 && (!fold || directLifecycle)) ? <button type="button" role="menuitem" className="mi" onClick={() => { app.set({ pop: null }); QL.openWorkspace(app, null); }}><Icon name="file-diff" size={14} /><span>View changes</span><span className="n">5 files</span></button> : null}<button type="button" role="menuitem" className="mi" onClick={() => { app.set({ pop: null }); app.copy("branch", t.branch || "dev"); app.toast("Copied the branch name"); }}><Icon name="copy" size={14} /><span>Copy branch name</span><span className="n" /></button>
                  <button type="button" role="menuitem" className="mi" onClick={() => { app.set({ pop: null }); app.toast("Reveals docs/plans/" + t.slug + " in Finder"); }}><Icon name="folder-open" size={14} /><span>Show task folder</span><span className="n" /></button></> : null}
                  {!headerProposal || app.width<=480 || !directLifecycle ? <>{!headerProposal || app.width<=480 ? <div className="menu-sep" /> : null}
                  <button type="button" role="menuitem" className="mi" onClick={archiveChat(() => { app.set({ pop: null, archived: !s.archived }); if (!s.archived) app.go({ view: "home" }); })}><Icon name="archive" size={14} /><span>{s.archived ? "Restore" : "Archive"}</span><span className="n" /></button>
                  <div className="menu-sep" />
                  <button type="button" role="menuitem" className="mi danger" onClick={() => app.set({ pop: null, dialog: "delete" })}><Icon name="trash-2" size={14} /><span>Delete…</span><span className="n" /></button></> : null}
                </div>
              </Popover>
            </span> : null}
            {directLifecycle ? <><span className="tb-header-agent-divider" aria-hidden="true" /><IconBtn icon={archived ? "archive-restore" : "archive"} label={archived ? "Restore" : "Archive"} disabled={busy} onClick={archiveChat(() => { setProposalArchived(!archived); app.set({ archived: !archived }); if (!archived) app.go({ view: "home" }); })} /><span className="tb-task-delete"><IconBtn icon="trash-2" label="Delete…" danger onClick={() => app.set({ pop: null, dialog: "delete" })} /></span></> : null}{headerProposal ? <span className="tb-sep tb-utilities-divider" aria-hidden="true" /> : null}
            {QL.CHAT_TASK || headerProposal ? null : <span className="tb-sep" style={{ margin: "0 4px" }} />}
            {QL.CHAT_TASK ? null : <IconBtn icon="panel-right" label={navigationHint(((narrow ? s.railOpen&&s.phoneTab==="agent" : s.railOpen) ? "Hide" : "Show") + " task sidebar", "J")} side="left" on={s.railOpen} onClick={() => app.set(narrow ? {railOpen:!(s.railOpen&&s.phoneTab==="agent"),railTab:"agent",phoneTab:s.railOpen&&s.phoneTab==="agent"?"now":"agent"} : {railOpen:!s.railOpen})} />}
          </span>
        ) : null}
      </div>
    );
  }

  /* ── the step's own track: where you are inside the step ── */
  function PhaseMark({ step, state }) {
    if (window.QL_WNN_MODE === "current") return <Mark sm state={state}/>;
    // The step's own ring (StepTrack.tsx): empty and dashed before it is reached, half filled while it runs, checked once done.
    return <i className={"mk " + state} data-step={QL.STEP3[step] || step} aria-hidden="true"><QL.StepRing fill={state==="done"?1:state==="open"?0:0.5}/></i>;
  }
  // The three steps a task shows (Max, 11 November 2026: Plan, Implement, Verify). The model's moments still
  // carry finer stages (questions and research belong to Plan, the cards to Implement, the review to Verify);
  // OF_STEP folds each into its step, and a mark opens the route that draws that step's current state.
  const TRACK = [["plan", "Plan"], ["implement", "Implement"], ["verify", "Verify"]];
  const OF_STEP = { discuss: 0, research: 0, plan: 0, outline: 1, implement: 1, verify: 2, review: 2 };
  function GateTrack({ app }) {
    const { v, s } = app;
    const [feedback,setFeedback]=React.useState(false), [words,setWords]=React.useState("");
    React.useEffect(()=>{requestAnimationFrame(()=>document.querySelector('.connected-steps [aria-current="step"]')?.scrollIntoView({block:"nearest",inline:"nearest"}));},[s.route.step,app.width]);
    // A Chat has no steps: no track and no gate.
    // Inside a task's artifact there is no step track: the artifact's own bar leads, with Back to the step it came from.
    // The decision stays in the task header (TaskTopBar.tsx track={false}: only the step track goes).
    const inArtifact=s.route.view==="artifact" && !!s.route.artifactId;
    if((s.route.view!=="task" && !inArtifact) || QL.CHAT_TASK) return null;
    // While the task opens the track is inert and every step reads as not reached (TaskLoading.tsx): how far each is is not yet known.
    if(s.loading) return <div className="workspace-track"><nav className="connected-steps s3" aria-label="Task steps" aria-hidden="true">{TRACK.map(([id,name])=><button type="button" key={id} tabIndex={-1}><PhaseMark step={id} state="open"/><span>{name}</span></button>)}</nav></div>;
    const plan=s.route.step==="plan" && v.stage==="plan";
    const ready=plan && v.gateStep==="approve";
    // The track (StepTrack.tsx): always three marks with their names. The step reached carries who has it (yours, an
    // agent at work); the ones before it are done; the step in view has its name in full ink on a quiet ground.
    const at=v.stage==="shipped"||s.approved?TRACK.length:OF_STEP[v.stage];
    const on=OF_STEP[s.route.step];
    const goTo=(id)=>id==="plan"?(["discuss","research"].includes(v.stage)?v.stage:"plan"):id==="implement"?(v.stage==="outline"?"outline":"implement"):(v.stage==="review"||v.stage==="shipped"?"review":"verify");
    // An open batch: "Your turn · N" at the step bar's right end, N the questions still open, as the App shows it.
    const yt=v.yourTurn, turnN=yt&&yt.action==="Answer"?(yt.step==="discuss"?v.openQ:yt.step==="research"?v.openR:0):0;
    return <>
      <div className="workspace-track">
        {inArtifact?null:<nav className="connected-steps s3" aria-label="Task steps">{TRACK.map(([id,name],i)=><button type="button" key={id} aria-current={on===i?"step":undefined} onClick={()=>app.go({view:"task",step:goTo(id)})}><PhaseMark step={id} state={i<at?"done":i===at?(v.stepStates[v.stage]?.you?"you":s.handback?"done":"work"):"open"}/><span>{name}</span></button>)}</nav>}
        {turnN&&!inArtifact?<button type="button" className="turn-pill" onClick={()=>{app.go({view:"task",step:yt.step});app.flashTurn();}}>Your turn · {turnN}</button>:null}
        {window.QL_REVIEW_SIMPLIFIED && s.route.step === "review" && v.stage === "review" && !s.approved ? <div className="workspace-approval" id="review-header-approval" /> : null}
        {plan&&s.taskWhere==="terminal"&&ready&&s.outsidePlanner?<div className="workspace-approval workspace-approval-outside" data-outside-planner={s.outsidePlanner}><span className="dim workspace-outside-where"><Icon name="square-terminal" size={14}/>{s.outsidePlanner==="waiting"?"Waiting in your own agent":"Stopped in your own agent"}</span><QL.PlanApproveSplit app={app} ready={ready}/></div>:plan&&s.taskWhere==="terminal"&&ready&&QL.data.task.adopted?<div className="workspace-approval workspace-approval-outside"><span className="dim"><Icon name="square-terminal" size={14}/> Ready to approve · here or in your own agent</span><Btn pri icon="check" onClick={()=>app.set({agentDialog:"build"})}>Approve Plan</Btn></div>:plan&&s.taskWhere==="terminal"?<div className="workspace-approval workspace-approval-outside"><Icon name="square-terminal"size={14}/><span className="dim">{ready?"Approve the Plan or ask your agent in its terminal":v.gateStep==="decisions"?"1 call left · answer it in your own agent":"The Plan is being written in your own agent"}</span><button type="button" className="lnk" onClick={()=>app.set({agentDialog:"takeover"})}>Continue in QualityLayer</button></div>:plan?<div className="workspace-approval">{v.gateStep==="decisions"?<button type="button" className="call-chip" data-testid="calls-left" title="Go to the first call" onClick={()=>app.jump("call-" + (QL.data.task.plan.decisions.find((d) => d.late) || {}).id)}><Mark state="you" sm/>1 call left</button>:null}{!ready&&v.gateStep!=="decisions"?<span className="model-plan-status" tabIndex={0} title={s.moment==="plan-findings"?"The planner is addressing the review findings. No action needed.":"Codex is reviewing the Plan. No action needed."}><Mark state="work" sm/>{s.moment==="plan-findings"?"Updating Plan":"Reviewing Plan"}</span>:<span className="model-approve-wrap">{QL.GetApproval?<QL.GetApproval ready={ready}/>:null}<QL.PlanApproveSplit app={app} ready={ready}/></span>}</div>:null}
      </div>
      {feedback?<div className="plan-feedback"><label htmlFor="model-plan-feedback">What should change?</label><textarea id="model-plan-feedback" className="field" rows={3} value={words} onChange={(e)=>setWords(e.target.value)}/><div className="row"><span className="sp"/><Btn sm onClick={()=>setFeedback(false)}>Cancel</Btn><Btn sm pri disabled={!words.trim()} onClick={()=>{app.comment(words.trim());setFeedback(false);setWords("");app.setMoment("plan-work",true);app.toast("Feedback sent. The planner is revising the Plan.");}}>Send feedback</Btn></div></div>:null}
    </>;
  }

  /* ── right sidebar: Files · Comments ──
     Files: the person's three documents as one step list, in each step's state; then the artifacts; then the agent's
     own files, folded once and grouped by step. Nothing in the agent's files waits on the person. ── */
  function Rail({ app, embedded = false }) {
    const { s, v } = app;
    const t = QL.data.task;
    const f = t.files;
    const cur = STEPS.indexOf(v.stage === "shipped" ? "review" : v.stage);
    const stepState = (st) => v.stepStates[st];
    const markFor = (st) => { const x = stepState(st); return x.you ? "you" : x.label === "done" ? "done" : x.label === "running" ? "work" : x.label === "stopped" ? "stop" : "open"; };
    // A document written before its moment is reached: the helpers' reading while questions are open, the cards while the
    // Plan waits for approval.
    const early = (st) => (st === "research" && v.stage === "discuss" && s.moment !== "new" ? "started early" : st === "outline" && v.stage === "outline" && s.buildWaiting ? "being written" : null);
    // A light task has no second opinion on the change: only reviews that ran are listed.
    // A review is listed once it ran.
    const reviews = f.reviews.filter((r) => STEPS.indexOf(r.step) <= cur && !(r.step === "plan" && s.moment === "plan-work") && !(r.step === "outline" && v.stage === "outline") && !(s.light && r.file !== "reviews/plan.md"));
    // A task started from an existing plan (existing-plan.jsx): its original plan is kept, read-only, beside the Plan
    // that maps it.
    const adopted = t.adopted || null;
    // The task's three files (Max, 11 November 2026): 01-plan.md, 02-implement.md, 03-verify.md, one per step. The
    // model's finer stages fold into their step (QL.STEP3); a file its step has not written yet is a quiet row.
    const DOCS3 = [["plan", "01-plan.md"], ["implement", "02-implement.md"], ["verify", "03-verify.md"]];
    const at3 = v.stage === "shipped" ? DOCS3.length : DOCS3.findIndex(([st]) => st === QL.STEP3[v.stage]);
    // The Plan is not on disk while its questions are open; the cards are not, while the build waits to start.
    const unwritten = (i) => i > at3 || (i === at3 && (["discuss", "research"].includes(v.stage) || v.stage === "outline"));
    const written = DOCS3.filter((d, i) => !unwritten(i)).length;
    // ?files=earlier: a task made with the earlier seven-step workflow. Its Markdown files are listed as they are and open
    // as plain files; no step, no state, no conversion (01-plan.md §3.9, FilesTab.tsx earlierDocs).
    const earlierFiles = new URLSearchParams(window.QL_PREVIEW_QUERY || location.search).get("files") === "earlier" ? ["01-discuss.md", "03-plan.md", "07-review.md"] : null;
    const FileRow =({ name, k, mark, icon, on, onClick, title }) => (
      <button type="button" className={"fr" + (on ? " on" : "")} onClick={onClick} title={title || name} aria-current={on ? "true" : undefined}>
        {mark ? <Mark state={mark} sm /> : <Icon name={icon || "file-text"} size={13} />}
        <span className="name">{name}</span>
        <span className="k">{k}</span>
      </button>
    );
    const selected = s.route.file;
    const artifacts = t.plan.artifacts;
    const artifactsShown = s.artifactsAll || artifacts.length <= 6 ? artifacts : artifacts.slice(0, 5);
    // The Library of this task's project (its own artifacts and those listed in it), what this task drafts on first. A few show
    // here; the rest are one click away in Artifacts. ⋯ and a right-click open the menus.
    const draftsOnIt = new Set(T_DRAFTS.map((d) => { const b = draftOf(d.id, s); return b && !b.gone ? b.id : null; }).filter(Boolean));
    const libHere = (s.lib || []).filter((l) => !l.archived && (l.project === t.project || l.alsoIn.includes(t.project))).sort((a, b) => (draftsOnIt.has(b.id) - draftsOnIt.has(a.id)) || b.updatedAt - a.updatedAt);
    const lastingHere = libHere.slice(0, 4);
    const asideRef = React.useRef(null);
    const openDraftMenu = (e, kind, id) => {
      e.preventDefault();
      const r = asideRef.current.getBoundingClientRect();
      if (e.type === "contextmenu") return app.set({ dctx: { kind, id, x: Math.max(8, Math.min(e.clientX - r.left, r.width - 264)), y: e.clientY - r.top + 2 } });
      const b = e.currentTarget.getBoundingClientRect();
      app.set({ dctx: s.dctx && s.dctx.id === id ? null : { kind, id, x: Math.max(8, Math.min(b.right - r.left - 260, r.width - 264)), y: b.bottom - r.top + 4 } });
    };
    return (
      <aside ref={asideRef} className="rs agent-rail" aria-label={s.route.view === "task" ? "Task sidebar" : "Artifact sidebar"} style={{ width: embedded ? "100%" : app.railWidth }}>
        {!embedded ? <Resizer side="left" width={app.railWidth} min={320} onCollapse={() => app.set({ railOpen: false })} max={app.railMax} onResize={(w) => app.set({ railWidth: w })} onReset={() => app.set({ railWidth: 520 })} onDragging={app.setResizing} label="Resize the right sidebar" /> : null}
        {!embedded ? <div className="rs-hd">
          {s.loading ? <div className="ld-rail-tabs" aria-hidden="true" style={{ display: "flex", gap: 18, padding: "10px 12px", fontSize: 12.5, color: "var(--muted)" }}>{["Conversation", "Terminal", "Files"].map((name, at) => <span key={name} style={at === 0 ? { color: "var(--text)", fontWeight: 600 } : undefined}>{name}</span>)}</div> : <QL.SidebarViewTabs app={app} artifact={["task","artifact"].includes(s.route.view) ? null : artifacts.find(item=>item.id===s.route.artifactId)||artifacts[0]}/>}
          {/* One toggle, in the header. Only the phone sheet, which covers the page, keeps its own close; focus returns to the header toggle. */}
          {app.width <= 640 ? <IconBtn icon="x" label="Close · Esc" side="left" sm onClick={() => { app.set({ railOpen: false, phoneTab: "now" }); setTimeout(() => { const b = document.querySelector('.ql .tb [aria-label*="Files and Feedback"]'); if (b) b.focus(); }, 0); }} /> : null}
        </div> : null}
        <div className="sidebar-view-content" id={(s.route.view==="task"?"workflow":"artifact")+"-sidebar-panel"} role="tabpanel" aria-labelledby={(s.route.view==="task"?"workflow":"artifact")+"-tab-"+(s.railTab==="agent"?QL.chatViewOf(app):s.railTab)}>
        {s.loading ? <QL.LoadingRail /> : s.railTab === "files" && s.route.view === "artifact" ? <div className="rs-b" role="tabpanel" aria-label="Activity"><section className="ds-rsec"><h3 className="ds-rh">Artifact activity</h3><p className="ds-quiet">A working draft for {t.title}. Its source and revisions stay local.</p>{(()=>{const artifact=artifacts.find((item)=>item.id === s.route.artifactId) || artifacts[0];return <><p>Updated by {artifact.by} · {fmt.ago(Date.now()-artifact.at)} ago</p><code>{artifact.file}</code><p><button type="button" className="lnk" onClick={()=>app.unread()}>Back to the task</button></p></>;})()}</section></div> : s.railTab === "files" ? (
          <div className="rs-b" role="tabpanel">
            <div className="fsel row" style={{ padding: "6px 10px", gap: 8 }}>
              <Icon name="folder" size={13} style={{ color: "var(--dim)" }} />
              <span className="truncate" style={{ flex: 1 }} title={f.folder}>{t.slug}</span>
              <button type="button" className="lnk" onClick={() => app.copy("folder", f.folder)}>{s.copied === "folder" ? "Copied" : "Copy path"}</button>
            </div>
            <QL.GitCard app={app} />
            <div className="files-g">
              <div className="rs-sh"><span>Documents</span><span>{earlierFiles ? "Earlier workflow" : written + " of " + DOCS3.length}</span></div>
              {earlierFiles ? <ol className="fsteps" data-testid="earlier-files">{earlierFiles.map((name) => <li key={name}><button type="button" className="fstep" aria-label={name + ", plain file"} onClick={() => app.toast("Opens " + name + " as a plain file · simulated")} title={f.folder + "/" + name}><Icon name="file-text" size={13} style={{ color: "var(--dim)" }} /><span className="fstep-l"><b>{name}</b></span></button></li>)}</ol> : null}
              {earlierFiles ? null : <ol className="fsteps">
                {DOCS3.map(([st, name], i) => {
                  const label = QL.STEP3_LABEL[st];
                  // A step's state is its current stage's while it runs; the steps before it are done.
                  const x = i < at3 ? { label: "done" } : stepState(v.stage === "shipped" ? "review" : v.stage);
                  const ahead = null;
                  // As the App's document list: the step in bold, its file and a state word on every row; a step not reached
                  // (or its file not written yet) is a quiet row with "not yet". The state words are documentStates()'s.
                  if (unwritten(i)) return <li key={st}><div className="fstep off" aria-disabled="true" title={label + " · not written yet"}><Mark state="open" sm /><span className="fstep-l"><b>{label}</b></span><span className="k">not yet</span></div></li>;
                  const on = s.reading ? selected === name : s.route.view === "task" && QL.STEP3[s.route.step] === st;
                  const word = ahead ? ahead : x.you ? "your turn" : x.label === "running" ? "being written" : x.label === "stopped" ? "stopped" : "done";
                  return [(
                    <li key={st} className={on ? "model-file-row selected" : undefined}>
                      <button type="button" className={"fstep" + (on ? " on" : "")} aria-current={on ? "true" : undefined} aria-label={label + " " + name} onClick={() => app.openFile(name)} title={f.folder + "/" + name}>
                        <Mark state={x.you ? "you" : x.label === "done" ? "done" : x.label === "running" ? "work" : x.label === "stopped" ? "stop" : "open"} sm />
                        <span className="fstep-l"><b>{label}</b><span className="name">{name}</span></span>
                        {!on && word !== "done" ? <span className={"k" + (x.you ? " you" : ahead ? " early" : "")}>{word}</span> : null}
                      </button>
                      {on ? <><span className="model-file-actions"><IconBtn icon="copy" label="Copy path" sm onClick={()=>app.copy("file-path", f.folder + "/" + name)}/><IconBtn icon={QL.ICON.editor} label="Open file" sm onClick={()=>app.toast("Opens the file in your editor · simulated")}/><IconBtn icon="folder-open" label={/Mac/.test(navigator.platform)?"Show in Finder":/Win/.test(navigator.platform)?"Show in File Explorer":"Show in folder"} sm onClick={()=>app.toast("Shows the file in your system’s file browser · simulated")}/></span><span className={"k" + (x.you?" you":"")} title={word}>{word}</span></> : null}
                    </li>
                  )].concat(st === "plan" && adopted ? [(() => { const here = s.reading && selected === adopted.file; return <li key="original" className={here ? "model-file-row selected" : undefined}><button type="button" className={"fstep" + (here ? " on" : "")} aria-current={here ? "true" : undefined} aria-label={"Original plan " + adopted.file + ", read-only"} onClick={() => app.openFile(adopted.file)} title={f.folder + "/" + adopted.file + " · kept exactly as given"}><Icon name="lock" size={12} /><span className="fstep-l"><b>Original plan</b><span className="name">{adopted.file}</span></span><span className="k">read-only</span></button></li>; })()] : []);
                })}
              </ol>}
              {(() => {
                // The Plan's supporting files: its agents' file and the pictures it links
                // (?files=legacy: no group; ?files=missing: the agents' file not written yet).
                const look = new URLSearchParams(window.QL_PREVIEW_QUERY || location.search).get("files");
                const support = earlierFiles || look === "legacy" || unwritten(0) ? null : Object.assign({}, f.support || { context: "written", assets: [] }, look === "missing" ? { context: "missing", assets: [] } : {});
                if (!support) return null;
                const pictures = support.assets || [];
                const opened = new URLSearchParams(window.QL_PREVIEW_QUERY || location.search).get("support") === "open";
                return <details className="files-support" data-testid="files-build-context" open={opened || undefined}>
                  <summary><Icon name="chevron-right" size={13} className="files-support-chev" /><span>Build context</span><span className="dim">{pictures.length ? "notes · " + pictures.length + (pictures.length === 1 ? " picture" : " pictures") : "for agents"}</span></summary>
                  <ol className="fsteps">
                    <li>{support.context === "written"
                      ? <button type="button" className="fstep" aria-label="The Plan for agents, agents/01-plan.md, read-only" onClick={() => app.toast("Opens agents/01-plan.md in the Reader · read-only · simulated")} title={f.folder + "/agents/01-plan.md · notes for the build; the Plan is the agreement"}><Icon name="file-code" size={13} style={{ color: "var(--dim)" }} /><span className="fstep-l"><b>Plan for agents</b><span className="name">agents/01-plan.md</span></span></button>
                      : <div className="fstep off" aria-disabled="true" title="The planner writes it before the Plan is ready to approve"><Icon name="file-code" size={13} style={{ color: "var(--dim)" }} /><span className="fstep-l"><b>Plan for agents</b><span className="name">agents/01-plan.md</span></span><span className="k">not written yet</span></div>}</li>
                    {pictures.map((file) => <li key={file}><button type="button" className="fstep" aria-label={"Show the Plan's picture " + file + " in its folder"} onClick={() => app.toast("Shows " + file + " in Finder · simulated")} title={f.folder + "/" + file + " · linked from 01-plan.md"}><Icon name="image" size={13} style={{ color: "var(--dim)" }} /><span className="fstep-l"><b>Plan picture</b><span className="name">{file}</span></span></button></li>)}
                  </ol>
                </details>;
              })()}
            </div>
            <div className="files-g" data-tour="artifacts">
              <div className="rs-sh"><span>Artifacts</span><span>{artifacts.length ? artifacts.length : "none yet"}</span></div>
              {artifactsShown.map((d) => {
                const dn = QL.draftOf(d.id, s);
                const k = d.comments ? fmt.plural(d.comments, "thread") : v.planSettled ? "" : s.artifacts[d.id] === "change" ? "change sent" : s.artifacts[d.id] ? "looks right" : "to look at";
                return (
                  <div className="fentry" key={d.id} data-draft={d.id}>
                    <button type="button" className={"fr fdr" + (s.route.view === "artifact" && s.route.artifactId === d.id ? " on" : "")} onClick={() => app.openArtifact(d.id)} onContextMenu={(e) => openDraftMenu(e, "draft", d.id)} title={d.title + " · " + d.file} data-testid="artifact-row">
                      <Icon name="image" size={13} />
                      <span className="fdraft"><span className="fdn">{d.id}{!dn || dn.gone ? <i className="dot new-dot" title={dn && dn.gone ? "New · its base was deleted from the Library" : "New · not in the Library"} data-testid="artifact-new" /> : null}</span>{dn && !dn.gone ? <span className="fdl">{dn.title}{dn.archived ? " (archived)" : ""}{dn.pages.length ? " › " + dn.pages.join(", ") : ""}</span> : null}</span>
                      <span className="k">{k}</span>
                    </button>
                    <button type="button" className="fmenu" aria-label={"Actions for " + d.id} aria-haspopup="menu" aria-expanded={!!(s.dctx && s.dctx.id === d.id)} onClick={(e) => openDraftMenu(e, "draft", d.id)}><Icon name="ellipsis" size={14} /></button>
                  </div>
                );
              })}
              {artifactsShown.length < artifacts.length ? <button type="button" className="fr" onClick={() => app.set({ artifactsAll: true })}><Icon name="chevron-down" size={13} /><span className="name plain">{artifacts.length - artifactsShown.length} more</span><span className="k" /></button> : null}
              {artifacts.length === 0 ? <div className="nav-empty">drawn while planning, when a question or decision needs one</div> : null}
            </div>
            {reviews.length ? (
              <div className="files-g" data-testid="files-reviews">
                <div className="rs-sh"><span>Reviews</span></div>
                {/* As the App: the review's name over the step, who read it and how it ended; Reveal shows its file in the task folder. */}
                {reviews.map((r) => (
                  <div className="freview" key={r.file}>
                    <button type="button" className={"fr freview-open" + (selected === r.file && s.reading ? " on" : "")} aria-current={selected === r.file && s.reading ? "true" : undefined} onClick={() => app.openFile(r.file)} title={r.title + " · " + r.file}>
                      <Icon name="file-check" size={13} />
                      <span className="freview-t"><b>{r.title}</b><small>{STEP_LABEL[r.step]} · {r.who} · {r.line}</small></span>
                    </button>
                    <IconBtn icon="folder-open" label={"Reveal " + r.file} sm onClick={() => app.toast("Shows " + r.file + " in your system’s file browser · simulated")} />
                  </div>
                ))}
              </div>
            ) : null}
            <div className="files-g" data-testid="files-memory" aria-label="Task memory">
              <div className="rs-sh"><span>Memory</span></div>
              <FileRow name="Memory" k="by step" icon="file-text" on={selected === "records/memory-activity.md" && s.reading} onClick={() => app.openFile("records/memory-activity.md")} title="memory-activity.md · the lessons this task used and saved, by step" />
            </div>
            <div className="files-g" data-testid="lasting-artifacts" aria-label="Library">
              <h3 className="rs-sh lh2"><span>Library · {v.taskProject.label}</span><button type="button" className="lnk" onClick={() => { app.set({ libProject: t.project, libQuery: "", libView: "active" }); app.go({ view: "artifacts" }); }}>{libHere.length > lastingHere.length ? "All " + libHere.length + " in Artifacts" : "Open Artifacts"}</button></h3>
              {lastingHere.map((l) => (
                <div className="fentry" key={l.id} data-lasting={l.id}>
                  <button type="button" className="fr fdr" onClick={() => QL.openLibrary(app, l)} onContextMenu={(e) => openDraftMenu(e, "lasting", l.id)} title={l.title + " · " + l.folder} data-testid="lasting-row">
                    <Icon name={QL.ICON.library} size={13} />
                    <span className="fdraft"><span className="fdn lastingn">{l.title}</span>{draftsOnIt.has(l.id) ? <span className="fdl">This task drafts on it</span> : l.project !== t.project ? <span className="fdl">From {app.v.projectTile(l.project).label}</span> : null}</span>
                    <span className="k">{l.pages.length} {l.pages.length === 1 ? "page" : "pages"}</span>
                  </button>
                  <button type="button" className="fmenu" aria-label={"Actions for " + l.title} aria-haspopup="menu" aria-expanded={!!(s.dctx && s.dctx.id === l.id)} onClick={(e) => openDraftMenu(e, "lasting", l.id)}><Icon name="ellipsis" size={14} /></button>
                </div>
              ))}
              {lastingHere.length === 0 ? <div className="nav-empty lib-empty"><Icon name={QL.ICON.library} size={13} />None saved yet</div> : null}
            </div>
            {/* Records, from Implement on: one row for records/, evidence/ and agents/ with a Reveal for each, the raw output and pictures. agents/ is the agents' own files: it only says they are there, no list. */}
            {cur >= STEPS.indexOf("implement") ? (
              <div className="files-g" data-testid="files-records">
                <div className="rs-sh"><span>Records</span><span>raw output and pictures</span></div>
                <div className="fr fpair" data-testid="records-row" title="records/, evidence/ and agents/ in the task folder">
                  <Icon name="folder" size={13} />
                  <span className="name plain">records · evidence · agents</span>
                  <span className="k">{f.records.records} · {f.records.evidence} · {f.records.agents} files</span>
                  <span className="freveals">{["records", "evidence", "agents"].map((n) => <button key={n} type="button" className="rs-act" aria-label={"Reveal " + n + "/"} onClick={() => app.toast("Reveals " + n + "/ in your system’s file browser · simulated")}>{n}/</button>)}</span>
                </div>
                {f.records.records > 0 ? <FileRow name="Checks" icon="file-text" on={selected === "records/checks.md" && s.reading} onClick={() => app.openFile("records/checks.md")} title="records/checks.md" /> : null}
              </div>
            ) : null}
                      </div>
        ) : (
          s.railTab === "agent" ? ["task","artifact"].includes(s.route.view) ? <><QL.AgentPanel app={app} /></> : <QL.ArtifactAgentPanel app={app} artifact={artifacts.find((item)=>item.id === s.route.artifactId) || artifacts[0]}/> : /* Draft ask-agent-inline: no Feedback tab; any old "comments" route shows the agent. */ <QL.AgentPanel app={app} />
        )}
        </div>
        {s.dctx && s.railTab === "files" ? <DraftMenu app={app} ctx={s.dctx} /> : null}
      </aside>
    );
  }

  /** What a draft of this task drafts on, by the artifact's identity (owner project and name): its title and pages, whether it
      is archived, or that it was deleted (the draft then stands alone). Null for a new draft, or a base not in this library. */
  const T_DRAFTS = QL.data.task.plan.artifacts;
  function draftOf(id, s) {
    const saved = (s.draftBase || {})[id];
    const x = QL.data.drafts.find((d) => d.task === "billing" && d.name === id);
    const baseId = saved || (x && x.on ? x.project + ":" + x.on : null);
    if (!baseId) return null;
    const pages = saved ? [] : x.pages;
    const rec = (s.lib || []).find((r) => r.id === baseId);
    if (rec) return { id: rec.id, title: rec.title, pages, archived: !!rec.archived };
    const gone = (s.libDeleted || []).find((r) => r.id === baseId);
    return gone ? { id: baseId, title: gone.title, pages, gone: true } : null;
  }

  /** The menu of a draft or a lasting artifact in Files (⋯ and right-click): src/ui/artifact/ArtifactMenus.tsx. */
  function DraftMenu({ app, ctx }) {
    const { s } = app;
    const t = QL.data.task;
    const all = s.lib || [];
    const close = () => app.set({ dctx: null });
    useEffect(() => {
      const onDown = (e) => { if (!e.target.closest(".dmenu") && !e.target.closest(".fmenu")) app.set({ dctx: null }); };
      document.addEventListener("mousedown", onDown);
      return () => document.removeEventListener("mousedown", onDown);
    }, []);
    const item = (key, icon, label, fn) => <button key={key} type="button" role="menuitem" className="mi" onClick={() => { close(); fn(); }}><Icon name={icon} size={14} /><span>{label}</span><span className="n" /></button>;
    let items;
    if (ctx.kind === "lasting") {
      const l = all.find((x) => x.id === ctx.id);
      if (!l) return null;
      items = [item("o", QL.ICON.library, "Open in the Library", () => QL.openLibrary(app, l)), item("d", QL.ICON.agent, "Draft on it in this task", () => app.toast("Starts a draft of " + l.title + " in this task: qualitylayer artifact new <name> --on " + l.name))];
    } else {
      const dn = draftOf(ctx.id, s);
      const first = all.find((l) => l.project === t.project && !l.archived);
      items = [
        item("o", "image", "Open", () => app.openArtifact(ctx.id)),
        item("k", QL.ICON["library.save"], dn && !dn.gone ? "Save to library or update " + dn.title + "…" : "Save to library…", () => { QL._libReturn = document.querySelector('.fmenu[aria-label="Actions for ' + ctx.id + '"]'); app.set({ dialog: "lib-save", libTarget: { draft: ctx.id } }); }),
        dn && !dn.gone ? item("lib", "arrow-up-right", "Open " + dn.title + " in the Library", () => { const r = all.find((x) => x.id === dn.id); if (r) QL.openLibrary(app, r, { page: dn.pages[0] || null }); }) : null,
        dn && !dn.gone ? item("cmp", "columns-2", "Compare with " + dn.title, () => app.toast("Compare: " + dn.title + " beside the draft, one tab per page")) : first ? item("add", QL.ICON.library, "Add as a page of " + first.title + "…", () => app.toast("Adds the draft as a page of " + first.title)) : null,
        <div key="s1" className="menu-sep" />,
        item("r", "pencil", "Rename…", () => app.toast("Renames the draft")),
        item("p", "copy", "Copy path", () => app.copy("draftpath", t.files.folder + "/artifacts/" + ctx.id + ".html")),
        item("sh", "users", "Task sharing…", () => app.set({ pop: "share" })),
        <div key="s2" className="menu-sep" />,
        item("x", "trash-2", "Delete…", () => app.toast("Asks to delete the draft")),
      ];
    }
    return <div className="pop menu dmenu" role="menu" aria-label={ctx.kind === "lasting" ? "Lasting artifact actions" : "Draft actions"} style={{ left: ctx.x, top: ctx.y }}>{items.filter(Boolean)}</div>;
  }

  /* What a comment carries besides its words: pictures as thumbnails, other files as chips. The agent
     reads both from the task folder; on a shared task the team gets them sealed like the comment. */
  function Attachments({ files, onRemove }) {
    if (!files || !files.length) return null;
    return (
      <div className="cm-files">
        {files.map((f, i) => f.kind === "image" ? (
          <figure key={f.name + i} className="cm-img" title={f.name + " · " + f.size}>
            {f.url ? <img src={f.url} alt={f.label || f.name} /> : <div className="cm-ph" role="img" aria-label={f.label || f.name}><Icon name="image" size={18} /><span>{f.label || f.name}</span></div>}
            <figcaption><span className="truncate">{f.name}</span><span>{f.size}</span></figcaption>
            {onRemove ? <button type="button" className="cm-x" aria-label={"Remove " + f.name} onClick={() => onRemove(i)}><Icon name="x" size={12} /></button> : null}
          </figure>
        ) : (
          <span key={f.name + i} className="cm-file" title={f.name + " · " + f.size}>
            <Icon name="file-text" size={13} /><span className="truncate">{f.name}</span><span className="k">{f.size}</span>
            {onRemove ? <button type="button" className="cm-x in" aria-label={"Remove " + f.name} onClick={() => onRemove(i)}><Icon name="x" size={12} /></button> : null}
          </span>
        ))}
      </div>
    );
  }

  /* ── Where a comment stands for the agent ──
     The same fields the App reads from each thread's `handling`: phase, since, agent, busyWith, helperDueAt, helper, reason.
     Sent → Queued (the agent is busy) → Reading → Helper answering → Answered / Changed the document / Noted / Waiting for you / No answer.
     The chip names the phase in two words; the line under the comment says what happens next and when. Amber is only for
     "waiting for you" and "no answer": the person has something to do. A comment is never left without an answer: the helper
     steps in after about 90 s (20 s when the agent's turn has ended, 15 s when it waits at a gate). */
  const HANDLING = {
    sent: { icon: "send", chip: "Sent" },
    queued: { icon: "clock", chip: "Queued" },
    reading: { icon: "book-open", chip: "Read by the agent" },
    helper: { icon: "life-buoy", chip: "Helper answering" },
    noted: { icon: "clock", chip: "Queued" },
    answered: { icon: "circle-check", chip: "Answered", tone: "ok" },
    changed: { icon: "pencil", chip: "Changed the document", tone: "ok" },
    "waiting-you": { icon: "reply", chip: "Waiting for you", tone: "wait" },
    "no-answer": { icon: "circle-alert", chip: "No answer", tone: "wait" },
  };
  const PENDING = ["sent", "queued", "reading", "helper"];
  const spanOf = (ms) => { const sec = Math.max(0, Math.round(ms / 1000)); return sec < 60 ? sec + " s" : Math.floor(sec / 60) + " m " + String(sec % 60).padStart(2, "0") + " s"; };
  function useTicker(on) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => { if (!on) return undefined; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [on]);
    return on ? now : Date.now();
  }
  /** What is happening to the person's open comments, for the tab badge and the Agent tab. */
  function feedbackWork(s, list) {
    const open = (list || s.myComments || []).filter((c) => c.goes !== "resolved" && c.handling);
    const helper = open.find((c) => c.handling.phase === "helper");
    const working = open.filter((c) => PENDING.includes(c.handling.phase));
    return { helper, working: working.length, sentAt: working.reduce((first, c) => Math.min(first, c.sentAt || Date.now()), Infinity) };
  }
  /** One line at the top of the Agent tab while a helper answers feedback: the same state the Feedback tab shows. */
  function FeedbackWorkRow({ app, list }) {
    const { helper, working, sentAt } = feedbackWork(app.s, list);
    const now = useTicker(working > 0);
    if (!working) return null;
    return (
      <button type="button" className="cm-agentrow" data-testid="feedback-work-row" onClick={() => app.set({ railTab: "comments" })}>
        <Mark state="work" sm />
        <span>{helper ? "A helper is answering your feedback" : "Your feedback is " + (working === 1 ? "queued" : "queued · " + working + " comments")}</span>
        <span className="k">{spanOf(now - sentAt)}</span>
        <Icon name="chevron-right" size={13} />
      </button>
    );
  }
  function CommentStatus({ c, agent, app, answerRef }) {
    const h = c.handling;
    const pending = PENDING.includes(h.phase);
    const now = useTicker(pending);
    const def = h.phase === "reading" ? { ...HANDLING.reading, chip: "Read by " + (h.agent || agent) } : HANDLING[h.phase];
    agent = h.agent || agent;
    const waited = now - (c.sentAt || h.since);
    const due = h.helperDueAt ? Math.max(0, Math.ceil((h.helperDueAt - now) / 1000)) : null;
    const dueWords = due === null ? "" : due > 0 ? " A helper answers in about " + due + " s if it has not." : " A helper is stepping in now.";
    const body = {
      sent: <>Sent to {agent}.</>,
      queued: h.told ? <>{agent} was told in its own window and reads this at its next step.{dueWords}</> : h.busyWith ? <>{agent} is {h.busyWith} and reads this at its next step.{dueWords}</> : <>{agent} is not reading right now.{due !== null ? (due > 0 ? " A helper answers in about " + due + " s." : " A helper is stepping in now.") : ""}</>,
      reading: <>Your feedback reached {agent}.</>,
      helper: <>A helper is checking this feedback.</>,
      noted: app.s.route.step === "plan" ? <>Apply this feedback before approving the Plan.</> : <>Your feedback is saved for {agent}.</>,
      answered: <>{h.helper ? "A helper answered" : agent + " answered"}{c.sentAt ? " " + spanOf(h.since - c.sentAt) + " after you sent it." : "."}</>,
      changed: <>{agent} changed the document{c.sentAt ? " " + spanOf(h.since - c.sentAt) + " after you sent it." : "."}</>,
      "waiting-you": <>{agent} asked you something. Reply below.</>,
      "no-answer": <>{h.reason || "Nobody could answer it."}</>,
    }[h.phase];
    return (
      <div className="cm-hd" data-phase={h.phase} data-tone={def.tone || ""} role="status" aria-live="polite" data-testid="comment-status">
        <Icon name={def.icon} size={14} className="cm-hd-ic" />
        <div className="cm-hd-b">
          <p><b>{def.chip}.</b> {body}{pending && waited >= 20000 ? <span className="cm-hd-t"> Waiting {spanOf(waited)}.</span> : null}</p>
          {h.phase === "helper" && h.helper ? <details className="cm-hd-details"><summary>Helper details</summary><p>{h.helper.name}</p>{h.helper.line ? <pre>{h.helper.line}</pre> : null}</details> : null}
          {h.phase === "queued" || h.phase === "no-answer" || h.phase === "answered" || h.phase === "changed" ? (
            <p className="cm-hd-a">
              {h.phase === "queued" ? <button type="button" className="lnk" onClick={() => app.helperNow(c.id)}><Icon name="life-buoy" size={12} />Answer now with a helper</button> : null}
              {h.phase === "no-answer" ? <button type="button" className="lnk" onClick={() => app.helperNow(c.id)}><Icon name="rotate-ccw" size={12} />Ask again</button> : null}
              {h.phase === "answered" ? <button type="button" className="lnk" onClick={() => answerRef?.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })}><Icon name="arrow-up-right" size={12} />Read the answer</button> : null}
              {h.phase === "changed" ? <button type="button" className="lnk" onClick={() => app.toast("Opens the document at the changed passage, marked as updated")}><Icon name="arrow-up-right" size={12} />Show the changed passage</button> : null}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  function CommentsTab({ app, artifact }) {
    const { s } = app;
    const t = QL.data.task;
    const artifactId = artifact?.id || (s.route.view === "artifact" ? s.route.artifactId : null);
    const agent = artifact ? QL.agentNameOf(s.artifactAgents?.[artifact.id]?.agent || s.config.planAgent) : app.v.agent.name;
    const artifactShare = artifact ? (s.route.view === "team-artifact" ? { group: "review" } : null) : null;
    const audience = artifactShare?.group === "review" ? "Artifact review" : QL.data.team.name;
    const solo = artifact ? !artifactShare : s.cm === "solo";
    const draftKey = artifact ? "lasting:" + artifact.id : artifactId ? "artifact:" + artifactId : "task";
    const context = s.feedbackContexts?.[draftKey] || {};
    const update = (patch) => app.set((before) => ({ feedbackContexts: Object.assign({}, before.feedbackContexts, { [draftKey]: Object.assign({}, before.feedbackContexts?.[draftKey], typeof patch === "function" ? patch(before.feedbackContexts?.[draftKey] || {}) : patch) }) }));
    const draft = context.draft ?? s.feedbackDrafts?.[draftKey] ?? (artifact ? s.lastingFeedbackDrafts?.[artifact.id] : "") ?? "";
    const setDraft = (value) => update({ draft: value });
    const resolved = context.resolved || {};
    const replying = context.replying || null;
    const setReplying = (value) => update({ replying: value });
    const show = context.show || "open";
    const setShow = (value) => update({ show: value });
    const files = context.files || (!artifactId ? s.cmFiles : null) || [];
    const target = artifact ? s.lastingFeedbackTargets?.[artifact.id] : null;
    const quote = target?.quote || context.quote || (!artifact && (!artifactId || s.artifactSpot?.artifactId === artifactId) ? s.quote : null);
    const clearQuote = () => { update({ quote: null }); app.set(artifact ? (before) => ({ lastingFeedbackTargets: Object.assign({}, before.lastingFeedbackTargets, { [artifact.id]: null }) }) : { quote: null, artifactSpot: null }); };
    const people = (s.cm === "ask-large" && !artifact ? QL.data.team.large : QL.data.team.members.filter((m) => !m.you && (!artifactShare || artifactShare.group === "team" || ["Anna", "Ben"].some(name => m.name.startsWith(name)))));
    const asks = solo ? [] : (s.myAsks || []).filter((a) => (a.artifactId || null) === artifactId).map((a) => ({ id: a.id, on: a.quote ? "the passage" : STEP_LABEL[s.route.step] || "this step", quote: a.quote, by: "You", av: QL.data.me.initials, via: "to " + a.to, when: a.when, text: a.q, files: a.files, replies: [], goes: "waiting for " + a.to + (a.need === "needed before approval" ? " · needed before approval" : ""), you: true, recipient: "team", agentVisible: true }));
    const raw = artifact ? (artifact.comments || []).concat((s.myComments || []).filter((item) => item.artifactId === artifact.id), s.artifactNotes?.[artifact.id] || []) : artifactId ? asks.concat(t.comments.filter((item) => item.artifactId === artifactId || item.on === "artifact " + artifactId), (s.myComments || []).filter((item) => item.artifactId === artifactId)) : asks.concat(t.comments.filter((c) => !solo || !c.team), (s.myComments || []).filter((item) => !item.artifactId));
    const list = raw.map((c, i) => { const id = c.id || draftKey + ":initial:" + i; return Object.assign({ id, on: artifact ? "this artifact" : "this step", av: (c.by || "You").split(" ").map((word) => word[0]).join(""), replies: [], goes: c.replies?.length ? "answered" : "open", recipient: "agent", agentVisible: !(c.private || c.recipient === "people" || c.recipient === "person") }, c, context.threads?.[id]); });
    const patchThread = (c, patch) => {
      update((before) => ({ threads: Object.assign({}, before.threads, { [c.id]: Object.assign({}, before.threads?.[c.id], patch) }) }));
      if (artifact) app.set((before) => ({ artifactNotes: Object.assign({}, before.artifactNotes, { [artifact.id]: (before.artifactNotes?.[artifact.id] || []).map((note) => note.id === c.id ? Object.assign({}, note, patch) : note) }) }));
    };
    const isDone = (c) => resolved[c.id] ?? (c.goes === "resolved");
    const forYou = (c) => !isDone(c) && c.by !== "You" && c.replies.length === 0;
    const counts = { open: list.filter((c) => !isDone(c)).length, you: list.filter(forYou).length, done: list.filter(isDone).length };
    const shown = list.filter((c) => show === "done" ? isDone(c) : show === "you" ? forYou(c) : !isDone(c));
    const send = (recipient, text, selectedNeed, selectedFiles) => {
      const to = recipient.kind === "person" || recipient.kind === "audience" ? "team" : recipient.kind === "people-only" ? "person" : "agent";
      const names = recipient.kind === "audience" ? people.map((person) => person.name.split(" ")[0]) : [recipient.label];
      const draft = text, need = selectedNeed, files = selectedFiles;
      if (artifact) {
        const recipients = names.length > 2 ? names.length + " people" : names.join(" and ");
        const note = Object.assign({ id: "artifact-feedback-" + Date.now(), artifactId: artifact.id, text: draft.trim(), by: "You", av: QL.data.me.initials, when: "just now", replies: [], files, recipient: to === "team" ? "team" : to === "person" ? "person" : "agent", agentVisible: to !== "person", to: to === "team" ? recipients : agent, via: "to " + (to === "team" ? recipients : agent), goes: to === "team" ? "waiting for " + recipients + (need === "before" ? " · needed before approval" : "") : to === "agent" ? "sent" : "available to " + agent, ...(to === "agent" ? { sentAt: Date.now(), handling: { phase: "sent", since: Date.now(), agent } } : {}), quote }, target || {});
        app.set((before) => ({ artifactNotes: Object.assign({}, before.artifactNotes, { [artifact.id]: (before.artifactNotes?.[artifact.id] || []).concat(note) }), myAsks: to === "team" ? [{ id: note.id, artifactId: artifact.id, to: recipients, q: note.text, task: artifact.title, need: need === "before" ? "needed before approval" : "opinion only", state: "waiting · just now", when: "now", quote, files }].concat(before.myAsks || []) : before.myAsks }));
        if (to === "agent") app.trackComment(note.id, agent, "working on its last change");
        app.toast(to === "team" ? "Asked " + recipients + " · simulated. The answer lands here and " + agent + " reads it." : "Feedback attached to " + artifact.title + " · simulated");
      } else if (to === "team") {
        if (!names.length) return;
        const recipients = names.length > 2 ? names.length + " people" : names.join(" and ");
        if (!artifactId) app.askTeam({ to: recipients, q: draft.trim(), need: need === "before" ? "needed before approval" : "opinion only", quote, files });
        else {
          app.set((before) => ({ myAsks: [{ id: "ask" + Date.now(), artifactId, to: recipients, q: draft.trim(), need: need === "before" ? "needed before approval" : "opinion only", quote, files, task: t.title, state: "waiting · just now", when: "now" }].concat(before.myAsks || []) }));
          app.toast("Asked " + recipients + " · simulated. The answer lands here and " + agent + " reads it.");
        }
      } else app.comment(draft, files);
      setDraft("");
      update({ draft: "", files: [], picked: {} });
      clearQuote();
    };
    const answerRefs = React.useRef({});
    const state = (c) => isDone(c) ? "resolved" : c.goes === "answered" ? "answered" : c.goes;
    const Thread = ({ c }) => (
      <article className={"th cm-th" + (c.you && (!c.handling || HANDLING[c.handling.phase].tone === "wait") ? " you" : "") + (isDone(c) ? " done" : "")}>
        <header className="cm-h">
          <button type="button" className="cm-loc" title="Show this passage in the document" onClick={() => app.toast("Scrolls the document to the passage and marks it")}>
            <Icon name="arrow-up-right" size={12} />{c.pin ? "Pin " + c.pin + " · " : ""}{c.on}
          </button>
          <span className={"cm-state" + (c.handling && !isDone(c) ? (HANDLING[c.handling.phase].tone ? " " + HANDLING[c.handling.phase].tone : "") : c.goes === "answered" ? " ok" : /waiting|needed/.test(c.goes || "") ? " wait" : "")}>{c.handling && !isDone(c) ? HANDLING[c.handling.phase].chip : state(c)}</span>
        </header>
        {c.quote ? <blockquote className="cm-q">{c.quote}</blockquote> : null}
        <div className="msg"><span className="av">{c.av}</span><div><div className="msg-h"><b>{c.by}</b>{c.via ? <span className="via">{c.via}</span> : null}<span>{c.handling && c.sentAt ? new Date(c.sentAt).toTimeString().slice(0, 5) : c.when}</span></div><div className="msg-p">{c.text}</div><Attachments files={c.files} /></div></div>
        {c.handling ? <CommentStatus c={c} agent={agent} app={app} answerRef={answerRefs.current[c.id] || (answerRefs.current[c.id] = React.createRef())} /> : null}
        {c.replies.map((r, i) => (
          <div key={i} ref={i === 0 ? (answerRefs.current[c.id] || (answerRefs.current[c.id] = React.createRef())) : undefined} className="msg"><span className={"av" + (r.by === "Claude Code" || r.by === "Codex" ? " accent" : "")}>{r.av}</span><div><div className="msg-h"><b>{r.by}</b><span>{r.when}</span></div><div className="msg-p">{r.text}</div></div></div>
        ))}
        {replying === c.id ? (
          <QL.FeedbackComposer storageKey={draftKey + ":reply:" + c.id} recipients={[{ value: c.agentVisible === false ? "people-only" : "agent", label: c.agentVisible === false ? "People only" : "The agent", kind: c.agentVisible === false ? "people-only" : "agent" }]} reachLine={() => c.agentVisible === false ? "Replies stay between people; the agent does not read this thread." : agent + " reads this reply with the thread."} send={(_, text, need, files) => { patchThread(c, { replies: c.replies.concat({ by: "You", av: QL.data.me.initials, when: "just now", text, files }), goes: "answered" }); setReplying(null); }} onCancel={() => setReplying(null)} />
        ) : null}
        <footer className="th-ft">
          <button type="button" className="lnk" onClick={() => setReplying(c.id)}>Reply</button>
          <button type="button" className="lnk" onClick={() => update((before) => ({ resolved: Object.assign({}, before.resolved, { [c.id]: !isDone(c) }) }))}>{isDone(c) ? "Reopen" : "Resolve"}</button>
          {c.agentVisible === false ? <button type="button" className="lnk" onClick={() => { patchThread(c, { agentVisible: true, private: false, recipient: "agent", via: "shared with " + agent }); app.toast("This thread is now shared with " + agent + " · simulated"); }}>Share with {agent}</button> : c.by !== "You" && c.replies.length === 0 ? <button type="button" className="lnk" onClick={() => app.toast("Asks " + agent + " to answer this thread · simulated")}>Ask {agent}</button> : null}
        </footer>
      </article>
    );
    return (
      <div className="rs-b cm" role="tabpanel" aria-labelledby={artifact ? "lasting-tab-comments" : undefined}>
        <Seg value={show} options={[{ value: "open", label: "Open · " + counts.open }].concat(solo && !artifact ? [] : [{ value: "you", label: "For you · " + counts.you }], [{ value: "done", label: "Resolved · " + counts.done }])} onChange={setShow} />
        <div className="cm-list">
          {/* Who reads feedback is said once here, at reading size, and again in the composer's last line;
              no standing line under the filter (Max, 16 October 2026). */}
          {shown.length === 0 && show === "open" ? (
            <div className="cm-empty">
              <p className="cm-empty-h">No open feedback</p>
              <ul className="cm-reach">
                {s.taskWhere === "terminal" && !artifact ? <li><Icon name="square-terminal" size={14} /><span>Your feedback is saved for <b>{agent}</b>.</span></li> : <li><Icon name="bot" size={14} /><span>Your feedback goes to <b>{agent}</b>.</span></li>}
                <li><Icon name="lock" size={14} /><span>{artifact ? "Feedback stays in this artifact’s local agent context." : <>Only you and {agent} see it.</>}</span></li>
              </ul>
            </div>
          ) : shown.length === 0 ? <div className="nav-empty">{show === "done" ? "Nothing resolved yet." : "Nothing waits for your answer."}</div> : null}
          {shown.map((c) => <React.Fragment key={c.id}>{Thread({ c })}</React.Fragment>)}
        </div>
        {!replying ? <div className="cm-compose"><QL.FeedbackComposer collapsible allowRequired={!artifact} key={draftKey} storageKey={draftKey} quote={quote} initialFiles={files} recipients={[{ value: "agent", label: "The agent", kind: "agent" }].concat(artifact ? [{ value: "people-only", label: "People only", kind: "people-only" }] : [], solo ? [] : people.map((person) => ({ value: person.name, label: person.name.split(" ")[0], kind: "person", canSee: s.shareAudience !== "only" })).concat(s.shareAudience === "only" ? [] : [{ value: "audience", label: "Everyone on the task", kind: "audience" }]))} initialText={draft} send={send} reachLine={(recipient, selectedNeed) => recipient.kind === "people-only" ? "This note stays between people. The agent does not read it." : recipient.kind === "agent" ? "Your feedback is saved for " + agent + "." + (solo ? "" : " Shared Feedback is visible to " + audience + ".") : recipient.label + " finds it in Needs you." + (selectedNeed === "before" ? " Approval waits for the answer." : " The answer returns here.")} /></div> : null}
      </div>
    );
  }

  /* ── ⌘K ──
     One box for actions, projects, tasks and the open task's files. Actions come first and name their keys;
     projects answer ⌘1 to ⌘9; "›" (or ">") at the start shows actions only. ↑ ↓ move, Enter opens, Esc closes. */
  const TASK_FILES = ["docs/plans/usage-based-billing/01-plan.md", "docs/plans/usage-based-billing/02-implement.md", "services/invoicing/src/proration.ts", "services/invoicing/src/usage.ts", "gateway/meter.go", "billing/limits.ts", "tests/invoicing/proration.test.ts"];
  function CommandBox({ app }) {
    const { s, go } = app;
    const [q, setQ] = useState("");
    const [hl, setHl] = useState(0);
    const listRef = React.useRef(null);
    useEffect(() => { setHl(0); }, [q, s.search]);
    if (!s.search) return null;
    const onlyActions = /^[>›]/.test(q);
    const filesMode = s.route.view === "task" && q.startsWith("/");
    const term = q.replace(/^[>›/]\s*/, "").toLowerCase();
    const has = (text) => !term || text.toLowerCase().includes(term);
    const cur = app.v.taskProject;
    const visible = app.v.projects.filter((p) => !s.looks.hidden[p.id]);
    // The open task's files only while a task is open: Home and Settings offer no file action.
    const taskOpen = s.route.view === "task";
    const actions = [
      // In a task the new task starts in its project; elsewhere the sheet asks for the project.
      { id: "new", icon: QL.ICON["task.new"], label: taskOpen ? "New task in " + cur.label : "New task…", run: () => (taskOpen ? app.newTaskIn(cur.id) : app.set({ pop: "new" })) },
      taskOpen ? { id: "file", icon: "file-text", label: "Go to file in this task…", keys: "⌘P", keep: true, run: () => setQ("/") } : null,
      { id: "agents", icon: "bot", label: "Settings › Agents", run: () => go({ view: "settings", tab: "agents" }) },
      { id: "usage", icon: "gauge", label: "Settings › Usage", keys: "⌘U", run: () => go({ view: "settings", tab: "usage" }) },
      s.route.view === "home" ? null : { id: "home", icon: "house", label: "Home", run: () => go({ view: "home" }) },
      
      s.route.view === "artifacts" ? null : { id: "art", icon: "shapes", label: "Artifacts", run: () => go({ view: "artifacts" }) },
      { id: "you", icon: QL.ICON.filter, label: "Show only what needs you", run: () => app.set({ filter: "you" }) },
      { id: "theme", icon: QL.ICON[s.theme === "dark" ? "theme.light" : "theme.dark"], label: (s.theme === "dark" ? "Light" : "Dark") + " theme", run: () => app.set({ theme: s.theme === "dark" ? "light" : "dark" }) },
    ].filter((a) => a && has(a.label));
    const projects = onlyActions || filesMode ? [] : visible.map((p, i) => ({ p, f: app.v.projectTile(p.id), i })).filter(({ f }) => has(f.label + " " + f.folder));
    const tasks = onlyActions || filesMode ? [] : [QL.data.task].concat(QL.data.projectTasks, QL.data.otherTasks).filter((t) => has(t.title + " " + app.v.projectTile(t.project).label));
    const files = onlyActions || !taskOpen ? [] : filesMode || term.length >= 2 ? TASK_FILES.filter((f) => has(f)) : [];
    const pick = (fn, keep) => { if (!keep) app.set({ search: false }); fn(); };
    const rows = [];
    const group = (title, items) => { if (items.length) rows.push({ head: title }); items.forEach((r) => rows.push(r)); };
    group("Actions", (filesMode ? [] : onlyActions || term ? actions : actions.slice(0, 4)).map((a) => ({ key: "a-" + a.id, lead: <Icon name={a.icon} size={15} />, main: a.label, right: a.keys ? <kbd>{a.keys}</kbd> : null, run: () => pick(a.run, a.keep) })));
    group("Projects", projects.map(({ p, f, i }) => ({ key: "p-" + p.id, lead: <Tile f={f} xs />, main: f.label, sub: f.folder, right: i < 9 ? <kbd>⌘{i + 1}</kbd> : null, run: () => pick(() => app.set({ project: p.id, route: Object.assign({}, s.route, { view: "home" }) })) })));
    group("Tasks", tasks.slice(0, term ? 8 : 5).map((t) => {
      const row = app.v.navTasks.find((n) => n.id === t.id);
      return { key: "t-" + t.id, lead: <Mark state={row ? row.mark : t.archived || t.stage === "shipped" ? "done" : "work"} sm />, main: t.title, sub: t.archived ? "archived" : (row && row.end) || STEP_LABEL[t.stage] || t.end || t.stage, right: <><QL.AgentMark agent={t.agent || (row && row.agent)} size={12} /><Tile f={app.v.projectTile(t.project)} xs label /></>, run: () => pick(() => app.openTask(t.id)) };
    }));
    group(filesMode ? "Files in " + QL.data.task.title : "Files in this task", files.map((f) => ({ key: "f-" + f, lead: <QL.FileIcon path={f} size={14} />, main: f.split("/").pop(), sub: f.split("/").slice(0, -1).join("/"), run: () => pick(() => app.toast("Opens " + f + " in the Reader")) })));
    const items = rows.filter((r) => !r.head);
    const at = Math.min(hl, Math.max(0, items.length - 1));
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); app.set({ search: false }); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const next = (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length); setHl(next); const el = listRef.current && listRef.current.querySelector('[data-cb="' + next + '"]'); if (el) el.scrollIntoView({ block: "nearest" }); }
      else if (e.key === "Enter") { e.preventDefault(); if (items[at]) items[at].run(); }
    };
    let n = -1;
    return (
      <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) app.set({ search: false }); }}>
        <div className="cbox wide" role="dialog" aria-label="Search or jump">
          <div className="cb-q"><Icon name="search" size={16} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={filesMode ? "Find a file in this task" : taskOpen ? "Search tasks, projects, files and actions" : "Search tasks, projects and actions"} onKeyDown={onKey} aria-label="Search" aria-activedescendant={items.length ? "cb-" + at : undefined} /></div>
          <div className="cb-list" ref={listRef} role="listbox" aria-label="Results">
            {rows.map((r) => {
              if (r.head) return <div key={"h-" + r.head} className="cb-sh">{r.head}</div>;
              n++;
              const i = n;
              return (
                <button key={r.key} id={"cb-" + i} data-cb={i} type="button" role="option" aria-selected={i === at} className={"cb-row" + (i === at ? " hl" : "")} onMouseMove={() => { if (i !== at) setHl(i); }} onClick={r.run}>
                  <span className="cb-lead">{r.lead}</span>
                  <span className="cb-main"><span>{r.main}</span>{r.sub ? <span className="cb-sub">{r.sub}</span> : null}</span>
                  <span className="cb-right">{r.right}</span>
                </button>
              );
            })}
            {items.length === 0 ? <p className="cb-empty">Nothing matches “{term}”. Try a project name, a step or a file.</p> : null}
          </div>
          <div className="cb-foot"><span><kbd>↑</kbd><kbd>↓</kbd> Move</span><span><kbd>↵</kbd> Open</span><span><kbd>›</kbd> Actions only</span>{taskOpen ? <span><kbd>/</kbd> Files</span> : null}<span className="sp" /><span><kbd>esc</kbd> Close</span></div>
        </div>
      </div>
    );
  }

  function Dialogs({ app }) {
    const { s } = app;
    return (
      <>
        {s.dialog === "delete" ? (
          <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) app.set({ dialog: null }); }}>
            <div className="dialog" role="alertdialog" aria-labelledby="del-h">
              <h3 id="del-h">Delete "{QL.data.task.title}"?</h3>
              <p>The task folder docs/plans/{QL.data.task.slug} and its local records are permanently deleted. Its task leaves Home and Projects; the App returns Home. The branch and code stay.</p>
              <div className="acts"><Btn onClick={() => app.set({ dialog: null })}>Keep it</Btn><Btn danger className="delete-confirm" icon="trash-2" onClick={() => { app.set({ dialog: null, archived: true }); app.go({ view: "home" }); app.toast("Deleted. This model retains its example data."); }}>Delete</Btn></div>
            </div>
          </div>
        ) : null}
        <AskTeamDialog app={app} />
        <FeedbackDialog app={app} />
        {s.dialog === "implementation" ? <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) app.set({ dialog: null }); }}><div className="dialog handover-dialog" role="dialog" aria-label="Start Outline and build"><button type="button" className="lnk handover-close" onClick={() => app.set({ dialog: null })}>Close · Esc</button><QL.ImplementStart app={app} early /></div></div> : null}
      </>
    );
  }

  /* ── in-App notice: the App is in front, on another page ── */
  function Notice({ app }) {
    const n = app.s.notice;
    if (!n) return null;
    return (
      <div className="notice" role="status">
        <div className="t"><Mark state={n.mark || "you"} />{n.title}</div>
        <div className="p">{n.text}</div>
        <div className="s">{n.sub}</div>
        <div className="acts"><Btn sm pri onClick={() => { app.set({ notice: null }); n.go(); }}>{n.action || "Open"}</Btn><Btn sm quiet onClick={() => app.set({ notice: null })}>Later</Btn></div>
      </div>
    );
  }

  /** The one project list every project filter offers: the sidebar's projects in its order, hidden ones left out, after "All projects". */
  const projectChoices = (app) => [{ value: "", label: "All projects" }].concat(looks_order(app.s.looks, app.v.projects).filter((p) => !app.s.looks.hidden[p.id] && !p.hidden).map((p) => ({ value: p.id, label: app.v.projectTile(p.id).label })));
  /* ── An update that has waited. Illustrative: 12.5.0 is running, 12.10.1 is ready and six releases lie between.
     The release is fresh (the quiet line), waiting (the bar, from 3 days) or overdue (the bar in the accent, from 8 days).
     Later hides the line and the bar for a day. The Report sheet names a ready update whatever Later says. Nothing is installed here. */
  const UPDATE = { current: "12.5.0", available: "12.10.1", behind: 6 };
  const RELEASED = { waiting: "released 3 days ago", overdue: "released 8 days ago" };
  const updateOn = (s) => s.updateReady && !s.updateGone;
  const updateLevel = (s) => s.updateAge || "fresh";
  const restartUpdate = (app) => { app.set({ updateGone: true }); app.toast("Simulated · the App would close and open again on this page"); };
  /* The quiet line at the sidebar foot while the release is fresh; once it has waited the bar takes its place. */
  function UpdateLine({ app }) {
    const s = app.s;
    if (!updateOn(s) || s.updateLater || updateLevel(s) !== "fresh") return null;
    return (
      <button type="button" className="upd" data-testid="update-line" onClick={() => app.go({ view: "settings", tab: "about" })}>
        <span className="upd-dot" aria-hidden="true" /><b>Update ready</b><span className="dim">{UPDATE.available}</span>
        <span className="upd-chev"><Icon name="chevron-right" size={13} /></span>
      </button>
    );
  }
  /* The bar above every page but Settings: which version is ready, how far behind, and the two ways forward. */
  function UpdateBar({ app }) {
    const s = app.s, level = updateLevel(s);
    if (!updateOn(s) || s.updateLater || level === "fresh" || s.route.view === "settings") return null;
    return (
      <section className="upb" data-level={level} aria-label="Update ready" data-testid="update-bar" data-screen-label="Update bar" id="update-bar">
        <Icon name="download" size={14} />
        <div className="upb-t"><b>QualityLayer {UPDATE.available} is ready</b><span>You have {UPDATE.current} · {UPDATE.behind} releases behind · {RELEASED[level]}</span></div>
        <div className="upb-act">
          <button type="button" className="lnk" onClick={() => app.go({ view: "settings", tab: "about" })}>What's new</button>
          <button type="button" className="btn sm" onClick={() => { app.set({ updateLater: true }); app.toast("Hidden until tomorrow · Settings › About keeps it"); }}>Later</button>
          <button type="button" className="btn pri sm" onClick={() => restartUpdate(app)}>Restart and update</button>
        </div>
      </section>
    );
  }
  /* A bug report says a newer version is ready, above its form, before anything else. */
  function ReportUpdateNote({ app }) {
    const s = app.s;
    if (!updateOn(s) && !reportParameters.get("state")?.startsWith("update")) return null;
    return (
      <div className="upn" role="note" data-testid="report-update-note">
        <Icon name="download" size={14} />
        <div className="upn-t"><b>{UPDATE.available} is ready. You have {UPDATE.current}.</b><span>{UPDATE.behind} releases since yours. Update first, then send this if it still happens. Your text is kept.</span></div>
        <button type="button" className="btn sm" onClick={() => { app.set({ dialog: null }); restartUpdate(app); }}>Restart and update</button>
      </div>
    );
  }
  Object.assign(QL, { NavRail, navRailShown, audienceOf, projectChoices, draftOf, looksOrder: looks_order, matchesText: matches, Nav, TopBar, GateTrack, Rail, CommentsTab, FeedbackWorkRow, feedbackWork, StatusPop, CostPop, SharePop, PathPop, needsYouOf, NewTaskPop, CommandBox, Dialogs, Notice, STEPS, STEP_LABEL, APPROVES, UpdateBar });
})();
