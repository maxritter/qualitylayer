// Settings and a lasting artifact open, with the artifact items the Artifacts place lists. Home and Artifacts: attention.jsx.
(function () {
  const QL = (window.QL = window.QL || {});
  const { useState } = React;
  // Lucide share and star for the artifact header.
  Object.assign(QL.icons, {
    share: [["path", { d: "M12 2v13" }], ["path", { d: "m16 6-4-4-4 4" }], ["path", { d: "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" }]],
    star: [["path", { d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" }]],
  });
  const { Icon, Btn, IconBtn, fmt, Seg, Switch, Select, STEP_LABEL, Tile } = QL;

  /** A Settings row's leading icon, from the one meaning map (parts.jsx QL.ICON): 15px, dim. */
  const RowIcon = ({ m }) => <Icon name={QL.ICON[m]} size={15} className="st-ic" />;
  // A dialog takes focus when it opens, so Escape and the Tab trap work from the first key. A stable function, so a
  // re-render never moves focus back from a field the person is in.
  function focusOnMount(node) { if (node && !node.contains(document.activeElement)) node.focus(); }
  /* The instructions editor (Instructions.tsx). A `- [ ]` line under a step heading is required; `run:` makes it a Project
     check. Only the person's locally saved text is editable here.
     Edits stay in the open sheet until Save, as in the App. */
  // The three step headings (core/instructions.ts reads `## Plan`, `## Implement`, `## Verify`; an older file's step
  // headings are renamed once on update, with a backup).
  const INS_STEPS = ["Plan", "Implement", "Verify"];
  const INS_TEXT = "## Coding standards\n- Prefer small pull requests. Name the ticket in the title.\n- TypeScript strict; no any.\n\n## Verify\n- [ ] Review auth changes with the threat-model skill\n- Mention Wiz findings in the PR description.\n";
  function instructionLines(text) {
    let step=null,fence=null;
    return text.split("\n").flatMap((raw,index)=>{
      const marker=/^ {0,3}(`{3,}|~{3,})/.exec(raw)?.[1];
      if(fence){if(marker?.[0]===fence[0] && marker.length>=fence.length && /^ {0,3}(`{3,}|~{3,}) *$/.test(raw))fence=null;return [];}
      if(marker){fence=marker;return [];}
      if(/^## /.test(raw)){step=INS_STEPS.find(name=>name.toLowerCase()===raw.slice(3).trimEnd().toLowerCase()) || null;return [];}
      const required=/^[-*+] \[[ xX]\] +(\S.*)$/.exec(raw);
      return step && required ? [{id:"line-"+index,index,step,text:required[1]}] : [];
    });
  }
  const isRun = (text) => /^run:\s*/i.test(text);
  const CHECK_STEPS = ["Implement", "Verify"];
  function InsLine({ line, onRemove }) {
    const run = isRun(line.text);
    const check = run && CHECK_STEPS.includes(line.step);
    return (
      <div className="ins-line">
        <Icon name={check ? QL.ICON["run.terminal"] : QL.ICON["step." + (line.step || "verify").toLowerCase()] || QL.ICON["step.verify"]} size={15} className="ic" />
        <div>
          <b className={run ? "mono" : undefined}>{run ? line.text.replace(/^run:\s*/i, "") : line.text}</b>
          <span className="ins-meta">
            <span>{check ? "Project check" : "Done or skipped with a reason"}</span>
            {line.added ? <span className="new">Added · save to keep</span> : null}
          </span>
        </div>
        {onRemove ? <IconBtn icon="trash-2" label={"Remove " + line.text} onClick={onRemove} /> : <span />}
      </div>
    );
  }
  /** Edits remain local drafts until explicit revision-guarded Save. All values are illustrative. */
  function InstructionsSheet({ title, intro, text, onClose, onSave }) {
    const [filed,setFiled]=useState(text);
    const [textDraft,setTextDraft]=useState(text);
    const lines=instructionLines(textDraft);
    const seed=instructionLines(text);
    const query=new URLSearchParams(window.QL_PREVIEW_QUERY ?? location.search);
    const [problem,setProblem]=useState(null);
    const [refuseNext,setRefuseNext]=useState(["conflict","failed"].includes(query.get("ins")) ? query.get("ins") : null);
    const [discard,setDiscard]=useState(false);
    const [saved,setSaved]=useState(false);
    const [view, setView] = useState(seed.length ? "steps" : "write");
    const [step, setStep] = useState("Verify");
    const [draft, setDraft] = useState("");
    const dirty = textDraft !== filed;
    const edit=next=>{setTextDraft(next);setSaved(false);setDiscard(false);};
    const cancel=()=>dirty ? setDiscard(true) : onClose();
    const save=()=>{if(refuseNext){setProblem(refuseNext);setRefuseNext(null);return;}setProblem(null);setFiled(textDraft);setSaved(true);onSave(textDraft);};
    const remove=line=>edit(textDraft.split("\n").filter((_,index)=>index!==line.index).join("\n"));
    const add = () => {
      if (!draft.trim()) return;
      const rows=textDraft.split("\n"),heading=rows.findIndex(row=>row.toLowerCase()==='## '+step.toLowerCase());
      if(heading<0)edit(textDraft.trimEnd()+"\n\n## "+step+"\n- [ ] "+draft.trim()+"\n");
      else {let at=heading+1;while(at<rows.length && !/^## /.test(rows[at]))at++;rows.splice(at,0,"- [ ] "+draft.trim());edit(rows.join("\n"));}
      setDraft("");
    };
    const shown = INS_STEPS.filter((s) => lines.some((l) => l.step === s));
    const typed = draft.trim();
    const runs = isRun(typed) && CHECK_STEPS.includes(step);
    return (
      <div className="scrim ins-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) cancel(); }}>
        <section className="dialog ins-sheet" role="dialog" aria-modal="true" aria-labelledby="ins-title" tabIndex={-1} ref={focusOnMount} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); cancel(); } if(event.key === "Tab"){const controls=[...event.currentTarget.querySelectorAll("button,input,select,textarea,a[href]")].filter(node=>!node.disabled && node.getClientRects().length);const first=controls[0],last=controls.at(-1);if(event.shiftKey && (document.activeElement===first || document.activeElement===event.currentTarget)){event.preventDefault();last?.focus();}else if(!event.shiftKey && (document.activeElement===last || document.activeElement===event.currentTarget)){event.preventDefault();first?.focus();}} }} data-screen-label={title + " editor"}>
          <header className="ins-head">
            <h3 id="ins-title">{title}</h3>
            <p>{intro}</p>
          </header>
          <div className="ins-body">
            <div className="ins-bar">
              <Seg small label="View" value={view} onChange={setView} options={[{ value: "write", label: "Write", icon: "pencil-line" }, { value: "steps", label: "Steps", icon: "list-checks" }, { value: "preview", label: "Preview", icon: "eye" }]} />
            </div>
            {view === "write" ? (
              <>
                <textarea className="field ins-field" aria-label="Instructions" value={textDraft} onChange={event=>edit(event.target.value)} spellCheck={false} />
                <p className="ins-help">Text under a step heading reaches only that step; everything else reaches every step.</p>
                <details className="st-more ins-more"><summary><Icon name="chevron-right" size={14} />Step headings and step checks</summary><p className="ins-help">The headings are <code>## Plan</code>, <code>## Implement</code> and <code>## Verify</code>. A <code>- [ ]</code> line under one is a step check.</p></details>
              </>
            ) : view === "steps" ? (
              <>
                <section className="ins-steps" aria-label="Step checks by step">
                  {shown.length === 0 ? <div className="ins-empty">No step checks yet. Your text still guides every step.</div> : shown.map((s) => (
                    <React.Fragment key={s}>
                      <div className="ins-step">{s}</div>
                      {lines.filter((l) => l.step === s).map((l) => <InsLine key={l.id} line={l} onRemove={() => remove(l)} />)}
                    </React.Fragment>
                  ))}
                </section>
                <form className="ins-add" aria-label="Add a step check" onSubmit={(event) => { event.preventDefault(); add(); }}>
                  <Select label="Step" width="100%" value={step} onChange={setStep} options={INS_STEPS.map((s) => ({ value: s, label: s, icon: QL.ICON["step." + s.toLowerCase()] }))} />
                  <input className="field" aria-label="What the agent must do" placeholder="What the agent must do, or run: command" value={draft} onChange={(event) => setDraft(event.target.value)} />
                  <Btn type="submit" disabled={!typed}><Icon name="plus" size={14} />Add</Btn>
                  <p className="ins-add-hint">Adds <code>{"- [ ] " + (typed || "…")}</code> under <code>{"## " + step}</code>. {runs ? "It runs with the Project checks you approve in the Plan." : "The agent does it or skips it with a reason; Review shows which."}</p>
                </form>
                <p className="ins-help">Changes apply from your next task.</p>
              </>
            ) : (
              <div className="ins-steps" data-testid="instructions-preview">{textDraft.trim() ? textDraft.split("\n").map((line,index)=>line.startsWith("## ") ? <div className="ins-step" key={index}>{line.slice(3)}</div> : line.trim() ? <p className="ins-help" key={index}>{line.replace(/^[-*+] /,"")}</p> : null) : <p className="ins-help">Nothing to preview yet.</p>}</div>
            )}
          </div>
          {problem ? <p className="ins-help" role="alert">{problem === "conflict" ? <><b>Changed elsewhere.</b> Newer text was saved while you were editing. Yours stays here until you choose. <button type="button" className="lnk" onClick={()=>{const current=INS_TEXT+"\n## Review\n- [ ] Check the acceptance evidence\n";setTextDraft(current);setFiled(current);setProblem(null);setSaved(false);}}>Show the current text</button></> : <><b>Not saved.</b> The local file could not be saved. Your text is still here; save again when it works.</>}</p> : null}
          <footer className="ins-foot">
            {discard ? <><span role="alert">Discard your changes?</span><span className="ins-sp"/><Btn quiet onClick={()=>setDiscard(false)}>Keep editing</Btn><Btn quiet onClick={onClose}>Discard</Btn></> : <><span className="ins-count">{[...textDraft].length.toLocaleString("en-US")} of 12,000 characters{[...textDraft].length>12000 ? " · shorten to save" : ""}{saved ? " · Saved" : ""}</span><span className="ins-sp"/><Btn quiet onClick={cancel}>Cancel</Btn><Btn pri disabled={!dirty || [...textDraft].length>12000} onClick={save}>{problem === "failed" ? "Save again" : "Save"}</Btn></>}

          </footer>
        </section>
      </div>
    );
  }
  function Settings({ app }) {
    const { s } = app;
    const tab = s.route.tab === "team" ? "workflow" : s.route.tab || "workflow";
    const c = s.config;
    const [secondPreset, setSecondPreset] = React.useState(() => new URLSearchParams(window.QL_PREVIEW_QUERY ?? location.search).get("second") === "on");
    const set = (patch) => app.set({ config: Object.assign({}, c, patch) });
    // Every agent can review (core/review/cross.ts): Cursor and Antigravity review a disposable copy, since
    // their headless runs don't refuse edits themselves; Grok and Copilot get only their read tools.
    const nativeAgents = [{ value: "claude", label: "Claude Code" }, { value: "codex", label: "Codex" }, { value: "pi", label: "Pi" }, { value: "opencode", label: "OpenCode" }, { value: "cursor", label: "Cursor" }, { value: "grok", label: "Grok" }, { value: "antigravity", label: "Antigravity" }, { value: "copilot", label: "GitHub Copilot" }];
    return (
      <div className="stage-in wide settings-page" data-settings-tab={tab}>
        <div className="set" style={tab === "licence" ? { width: "100%", minWidth: 0 } : undefined}>
          <div className="settings-page-head"><h1>{QL.settingsLabel ? QL.settingsLabel(tab) : "Settings"}</h1><p className="lead">{QL.settingsLead ? QL.settingsLead(tab) : ""}</p></div>
          {/* The sections come from settings.jsx; the Settings sidebar replaces the left sidebar. */}
          <div className="sx solo settings-page-body"><div className="sx-body"><QL.SettingsPage app={app} tab={tab} />
          {tab === "workflow" ? (() => {
            // One column of rows: a label and what the current choice does on the left, the control on the right.
            const modelsFor = (agent) => QL.AgentFacts.modelsOf(agent);
            const INDIE = [{ value: "off", label: "Off", icon: QL.ICON["choice.off"] }, { value: "on", label: "On", icon: QL.ICON["choice.on"] }];
            const insQuery = new URLSearchParams(window.QL_PREVIEW_QUERY ?? location.search).get("ins");
            const insOpen = c.insOpen ?? ["open","conflict","failed"].includes(insQuery);
            const instructionText=c.instructionsText ?? (insQuery === "none" ? "" : INS_TEXT);
            const instructionRequired=instructionLines(instructionText);
            const indie = c.review ? "on" : "off";
            // The coding agents on this computer (?agents=claude,pi previews another set; Claude Code and Codex by default).
            const present = QL.ReviewSetup.presentAgents(c);
            const enough = present.length >= 2;
            // ?second=on previews the setting on before anyone has clicked it.
            const second = c.second || secondPreset ? "on" : "off";
            // Who reviews whom is set per agent in Models (QL.ReviewSetup in settings.jsx); this page only shows it.
            const design = c.designReview || "designs";
            // Effective App defaults stay selected; ?state=mixed shows a saved split preference. Nothing is saved.
            const mixed = new URLSearchParams(window.QL_PREVIEW_QUERY ?? location.search).get("state") === "mixed";
            // In my own agent (Max, 11 November 2026): the wire value stays terminal; the hint names every place it can be.
            const PLACES = [{ value: "app", label: "In the App", icon: QL.ICON["run.app"] }, { value: "agent", label: "In my own agent", icon: QL.ICON["run.terminal"], hint: "Your terminal, IDE or agent app: Claude Code, Codex, T3 Code, Orca…" }];
            const answerIn = c.answerIn !== undefined ? c.answerIn : mixed ? "agent" : "app";
            const approveIn = c.approveIn !== undefined ? c.approveIn : "app";
            const offer = c.offerPlan !== undefined ? c.offerPlan : true;
            const scans = c.scans || "on";
            const advisories = c.advisories || "online";
            // Reviews (approved by Max, 11 November 2026): no Plan reviewers row. Each review row says where it runs, who runs it for
            // each agent here, and links to Models, where it is changed.
            const RS = QL.ReviewSetup, here = present;
            const toModels = (agent, section) => app.go({ view: "settings", tab: "models", modelAgent: agent || here[0], section });
            const where = (steps) => <span className="rv-where">{steps.map(([icon, label]) => <span key={label} className="rv-step"><Icon name={icon} size={12} />{label}</span>)}</span>;
            const change = (section) => <button type="button" className="lnk rv-go" onClick={() => toModels(null, section)}>Change in Models<Icon name="chevron-right" size={12} /></button>;
            // One chip per model in use, like the Second opinion line: the marks of the agents on it, then the model. Each chip's
            // accessible name lists its agents; clicking it opens the first agent's models.
            const chips = (modelOf, section, aria) => {
              const groups = [...new Map(here.map((a) => [RS.shortModel(a, modelOf(a)), []])).entries()].map(([label]) => ({ label, of: here.filter((a) => RS.shortModel(a, modelOf(a)) === label) }));
              return <ul className="rv-chips" aria-label={aria}>{groups.map(({ label, of }) => <li key={label}><button type="button" className="rv-chip" aria-label={of.map(QL.AgentFacts.agentName).join(", ") + " · " + label + " · change in Models"} title={of.map(QL.AgentFacts.agentName).join(", ")} onClick={() => toModels(of[0], section)}><span className="rv-of">{of.map((a) => <QL.AgentMark key={a} agent={a} size={13} />)}</span><span>{label}</span></button></li>)}<li>{change(section)}</li></ul>;
            };
            // Second opinion, grouped by who reads: the marks of the agents it checks, an arrow, then the reader and its model.
            const seconds = here.map((a) => [a, RS.secondOf(c, a, here)]).filter(([, s]) => s);
            const readers = [...new Map(seconds.map(([, s]) => [s.agent + "|" + s.model, s])).values()];
            const pairs2 = readers.map((r) => ({ r, of: seconds.filter(([, s]) => s.agent === r.agent && s.model === r.model).map(([a]) => a) }));
            return (
              <div className="st">
                {/* Your agent: the offer first (Max, 11 November 2026), your instructions, then where a task started in your own agent is
                    answered and approved. Both effective defaults are selected. No Level row: every task reads the one way. */}
                <section className="st-g" id="in-your-agent" data-testid="in-your-agent" data-screen-label="Your agent">
                  <h2>Your agent</h2>
                  <div className="st-r">
                    <div className="st-l"><b><RowIcon m="offer.plan" />Offer QualityLayer</b><span>Your agent asks once when you ask it to plan without naming QualityLayer.</span></div>
                    <Switch on={offer} onChange={(v) => set({ offerPlan: v })} label="Offer QualityLayer" />
                  </div>
                  {/* ?ins=none is the row with nothing required, as before the feature; ?ins=open opens the editor on its Steps view. */}
                  {!instructionText.trim()
                    ? <div className="st-r" data-testid="instructions-row"><div className="st-l"><b><RowIcon m="instructions" />Your instructions</b><span>None yet. Your coding standards, tools and rules, like an AGENTS.md. The agent follows them in every task.</span></div><Btn onClick={() => set({ insOpen: true })}>Edit</Btn></div>
                    : <div className="st-r" id="your-instructions" data-testid="instructions-row" data-screen-label="Your instructions row"><div className="st-l"><b><RowIcon m="instructions" />Your instructions</b><span>{instructionText.trimEnd().split("\n").length} lines · <span className="ins-req">{instructionRequired.length} step check{instructionRequired.length === 1 ? "" : "s"}</span> · saved locally</span></div><Btn onClick={() => set({ insOpen: true })}>Edit</Btn></div>}
                  <div className="st-r">
                    <div className="st-l"><b><RowIcon m="answer.where" />Answer questions in</b><span>For tasks you start in your own agent. You can always answer in the App.</span></div>
                    <Seg label="Answer questions in" value={answerIn} options={PLACES} onChange={(v) => set({ answerIn: v })} />
                  </div>
                  <div className="st-r">
                    <div className="st-l"><b><RowIcon m="approve.where" />Approve in</b><span>Where you approve the Plan and the change.</span></div>
                    <Seg label="Approve in" value={approveIn} options={PLACES} onChange={(v) => set({ approveIn: v })} />
                  </div>
                </section>
                {insOpen ? <InstructionsSheet title="Your instructions" intro="The agent follows these in every task, like an AGENTS.md. They never appear in your documents." text={instructionText} onClose={() => set({ insOpen: false })} onSave={text => set({ instructionsText:text,insOpen:true })} /> : null}

                {/* Reviews: three compact rows. Each: where it runs (step pills), one line on what it does, who runs it per agent, the switch. */}
                <section className="st-g st-reviews" id="settings-reviews" data-screen-label="Reviews">
                  <h2>Reviews</h2>
                  <div className={"st-r rv-row" + (indie === "on" ? "" : " off")} id="review-independent" data-screen-label="Independent review">
                    <div className="st-l"><b><RowIcon m="review.independent" />Independent review</b>
                      <span>{where([[QL.ICON["step.verify"], "Verify"], ["rotate-cw", "Each recheck"]])}A fresh session checks the change and adds missing tests.</span>
                      {chips((a) => RS.reviewOf(c, a), "models-review", "Independent review model per agent")}
                    </div>
                    <Switch on={indie === "on"} onChange={(v) => set({ review: v })} label="Independent review" />
                  </div>
                  <div className={"st-r rv-row" + (design === "designs" ? "" : " off")} id="review-design" data-screen-label="Design review">
                    <div className="st-l"><b><RowIcon m="review.design" />Design review</b>
                      <span>{where([[QL.ICON["step.plan"], "Plan"], ["palette", "Each design"]])}A fresh session checks it before you see it.</span>
                      {chips((a) => RS.designOf(c, a), "models-design", "Design review model per agent")}
                    </div>
                    <Switch on={design === "designs"} onChange={(v) => set({ designReview: v ? "designs" : "off" })} label="Design review" />
                  </div>
                  <div className={"st-r rv-row" + (second === "on" && enough ? "" : " off")} id="review-second" data-screen-label="Second opinion">
                    <div className="st-l"><b><RowIcon m="review.second" />Second opinion</b>
                      <span>{where([[QL.ICON["step.plan"], "Plan"], [QL.ICON["step.verify"], "Verify"]])}{enough ? "Another agent reads risky work and changes nothing." : "Needs a second coding agent on this computer."}</span>
                      {/* Who reads whose work, grouped by reader: the marks it checks, an arrow, the reader and its model. */}
                      {enough ? <ul className="rv-pairs" aria-label="Who gives each agent's second opinion">{pairs2.map(({ r, of }) => <li key={r.agent + r.model}><button type="button" className="rv-pair" title={"Change in Models"} onClick={() => toModels(of[0], "models-second")}><span className="rv-of">{of.map((a) => <QL.AgentMark key={a} agent={a} size={13} />)}</span><Icon name="arrow-right" size={12} className="dim" /><QL.AgentMark agent={r.agent} size={13} /><b>{QL.AgentFacts.agentName(r.agent)}</b><span className="dim">{r.label}</span></button></li>)}<li>{change("models-second")}</li></ul> : null}
                    </div>
                    <Switch on={second === "on" && enough} disabled={!enough} onChange={(v) => { setSecondPreset(false); set({ second: v }); }} label="Second opinion" />
                  </div>
                  <details className="st-more"><summary><Icon name="chevron-right" size={14} />How the reviews work</summary><p className="st-foot">Each agent's review models are set in Models; click a model to open that agent. A second opinion is read-only. A design review takes about a minute per design.</p></details>
                </section>

                {/* QualityLayer's own scans of what a task changed, run on this computer beside the project checks. Advisories are the one choice about what leaves it. */}
                <section className="st-g st-reviews" id="security-scans" data-screen-label="Security scans">
                  <h2>Security scans</h2>
                  <div className="st-r">
                    <div className="st-l"><b><RowIcon m="scan.security" />Scan each change</b><span>{scans === "on" ? "Each task's changes are scanned on this computer. The findings go to the reviews." : "Changes are not scanned. Verify's Security scans lane says Off; the reviews still run."}</span></div>
                    <Switch on={scans === "on"} onChange={(v) => set({ scans: v ? "on" : "off" })} label="Scan each change" />
                  </div>
                  {scans === "on" ? <div className="st-r">
                    <div className="st-l"><b><RowIcon m="scan.advisories" />Dependency advisories</b><span>{advisories === "online" ? "A changed lockfile's package names and versions are checked against osv.dev." : "A local copy of the advisory database. Nothing leaves this computer."}</span></div>
                    <Seg label="Dependency advisories" value={advisories} options={[{ value: "online", label: "osv.dev", icon: QL.ICON["advisories.online"] }, { value: "local", label: "Local copy", icon: QL.ICON["advisories.local"] }]} onChange={(v) => set({ advisories: v })} />
                  </div> : null}
                  <details className="st-more"><summary><Icon name="chevron-right" size={14} />What each scan covers</summary><p className="st-foot">Secrets, vulnerable or malicious packages, unsafe GitHub workflows and risky code. osv.dev is Google's open vulnerability database; only package names and versions go to it, and your code stays on this computer. The local copy is about 250 MB for npm and PyPI, downloaded the first time a project needs it and refreshed daily.</p></details>
                </section>

                {/* Reviewer models live in Settings › Models › Reviews, beside every other model choice (Max, 5 November 2026). */}

              </div>
            );
          })() : null}
          {tab === "memory" ? (() => {
            // Other availability states open with ?memory=partial or ?memory=unavailable; the page itself carries no prototype switch.
            const asked = new URLSearchParams(window.QL_PREVIEW_QUERY ?? location.search).get("memory");
            const state = c.memoryAvailability || (["partial", "unavailable"].includes(asked) ? asked : "ready");
            // A project whose folder is gone from this computer is not listed here (Max, 10 November 2026).
            const issues = state === "partial" ? QL.data.projects.slice(0, 1) : [];
            // ?lessons=changed opens the Sources changed filter (Thraft learnings).
            const lessons = [...(c.pilotImportedRecords || []), ...QL.data.task.files.memory.lessons];
            const stale = (l) => !!l.since && !(c.memoryStillTrue || []).includes(l.id) && !(c.memoryRetired ?? ["nightly", "csvexport", "fxrates"]).includes(l.id);
            const lessonState = c.memoryLessonState || (new URLSearchParams(window.QL_PREVIEW_QUERY ?? location.search).get("lessons") === "changed" ? "changed" : "active");
            // Active lessons are the default view; retired ones show only under the Retired filter (Max, 11 November 2026).
            const retiredIds = c.memoryRetired ?? ["nightly", "csvexport", "fxrates"];
            // ?project=you opens the Yours filter and ?pick=project the Choose project dialog (12.7 previews).
            const query = new URLSearchParams(window.QL_PREVIEW_QUERY ?? location.search);
            const project = c.memoryProject || (query.get("project") === "you" ? "you" : "all");
            // Escape closes a dialog and Tab stays inside it.
            const dialogKeys = (close) => (event) => {
              if (event.key === "Escape") { event.stopPropagation(); close(); }
              if (event.key === "Tab") { const controls = [...event.currentTarget.querySelectorAll("button,input,select")].filter((item) => !item.disabled); const first = controls[0], last = controls.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
            };
            const projectName = project === "all" ? "All projects" : project === "you" ? "Yours · every project" : (QL.projectChoices(app).find((p) => p.value === project) || { label: "All projects" }).label;
            // The App's memory sources; a lesson's source is the task or session that saved it.
            const MEMORY_SOURCES = [{ value: "all", label: "All sources" }, { value: "task", label: "QualityLayer tasks" }, { value: "session", label: "From a session" }, { value: "repository", label: "From repository" }, { value: "pilot", label: "Imported from Pilot" }, { value: "manual", label: "Private notes" }];
            const sourceOf = (l) => (/Imported from Pilot/.test(l.source) ? "pilot" : /session/.test(l.source) ? "session" : "task");
            const term = (c.memoryQuery || "").trim().toLowerCase();
            const shownLessons = lessons.filter((l) => (!term || (l.title + " " + l.text).toLowerCase().includes(term)) && (!c.memorySource || c.memorySource === "all" || sourceOf(l) === c.memorySource) && (lessonState === "changed" ? stale(l) : lessonState === "retired" ? retiredIds.includes(l.id) : !retiredIds.includes(l.id)) && (project !== "you" || l.about === "you"));
            const staleCount = lessons.filter(stale).length;
            return (
            <div className="st">
              <section className="st-g"><h2>Local memory{c.memoryEnabled !== false ? <span className="st-rec" data-testid="all-recommended">All recommended</span> : null}</h2><div className="st-r"><div className="st-l"><b><Icon name={QL.ICON["memory.remember"]} size={15} className="st-ic" />Remember useful lessons</b><span>Agents save what they learn in tasks and sessions.</span></div><Switch on={c.memoryEnabled !== false} onChange={(memoryEnabled) => set({ memoryEnabled })} label="Remember useful lessons" /></div><div className="st-r"><div className="st-l"><b><Icon name={QL.ICON["memory.sessions"]} size={15} className="st-ic" />Lessons in every session</b><span>Agents start with relevant lessons, yours included.</span></div><Switch on={c.memorySessions !== false} onChange={(memorySessions) => set({ memorySessions })} label="Lessons in every session" /></div>{c.memoryEnabled === false ? <p className="st-foot" role="status">Paused. QualityLayer stops saving and using lessons. Your stored memories stay here.</p> : null}</section>
              {QL.MemoryPortability ? <QL.MemoryPortability app={app}/> : null}
              {/* As the App: "Saved memories" with search, project and source filters, a preview per lesson, retire and restore. */}
              <section className="st-g ml-group" id="saved-memories" data-screen-label="Saved memories"><h2>Saved memories<span className="st-rec">{lessons.length + (c.memoryImported || 0)} saved · {lessons.filter((l) => l.scope === "Stored in Git").length} shared through Git{c.memoryImported ? " · " + c.memoryImported + " from Pilot" : ""}</span></h2>
              <div className="ml-tools">
                {/* As the App: a search that runs on Search or Enter, and a project button that opens the Choose project dialog. */}
                <form style={{ display: "contents" }} onSubmit={(e) => { e.preventDefault(); set({ memoryQuery: (c.memoryDraft ?? c.memoryQuery ?? "").trim(), memoryPage: 0 }); }}>
                  <label className="ml-search"><Icon name="search" size={14} /><input type="search" aria-label="Search saved memories" placeholder="Search lessons" value={c.memoryDraft ?? c.memoryQuery ?? ""} onChange={(e) => set({ memoryDraft: e.target.value })} /></label>
                </form>
                <Btn aria-label={"Memory project: " + projectName} onClick={() => set({ memoryProjectPick: true })}>{projectName}</Btn>
                <Select label="Memory source" value={c.memorySource || "all"} options={MEMORY_SOURCES} onChange={(memorySource) => set({ memorySource })} />
                {/* New (M3): lessons whose files changed after the commit they were last checked at. */}
                {lessons.length ? <Select label="Lesson state" value={lessonState} options={[{ value: "active", label: "Active lessons" }, { value: "changed", label: "Sources changed · " + staleCount }, { value: "retired", label: "Retired" }]} onChange={(memoryLessonState) => set({ memoryLessonState })} /> : null}
                {c.memoryQuery || project !== "all" || (c.memorySource && c.memorySource !== "all") || lessonState !== "active" ? <button type="button" className="lnk" onClick={() => set({ memoryQuery: "", memoryDraft: "", memoryProject: "all", memorySource: "all", memoryLessonState: "active", memoryPage: 0 })}>Clear filters</button> : null}
              </div>
              {issues.length ? <div className="st-r" role="status"><div className="st-l"><b>{issues.length === 1 ? "1 project needs attention" : issues.length + " projects need attention"}</b><span>Saved lessons are still available.</span></div><Btn onClick={() => set({ memoryProjectsOpen: true })}>View projects</Btn></div> : null}
              {state === "unavailable" ? <div className="st-r" role="alert"><div className="st-l"><b className="feedback-error">Memory is unavailable right now</b><span>Your tasks can continue without lessons.</span></div><Btn onClick={() => set({ memoryAvailability: "ready" })}>Try again</Btn></div> : null}
              {shownLessons.length === 0 ? <p className="ml-empty">{lessonState === "changed" ? "No lesson matching these filters has files that changed since it was checked. A lesson with no files recorded, or one Git could not check, is never marked." : lessonState === "retired" ? "No retired lessons match these filters." : "No saved memories match these filters."}</p> : null}
              {/* A lesson is one line; it opens the lesson's dialog (right chevron). Retire and Restore are the "Use in future tasks" switch there; a retired lesson is tagged in the list. */}
              {/* As the App: the 4 newest without a search or filter, 10 per page with one (12.7: was 20). */}
              {(() => {
                const filtered = !!term || project !== "all" || (!!c.memorySource && c.memorySource !== "all") || lessonState !== "active";
                const size = filtered ? 10 : 4;
                const pages = Math.max(1, Math.ceil(shownLessons.length / size));
                const at = Math.min(c.memoryPage || 0, pages - 1);
                return <>{shownLessons.slice(at * size, (at + 1) * size).map((l) => {
                const pinned = (c.memoryPins || []).includes(l.id), retired = (c.memoryRetired ?? ["nightly", "csvexport", "fxrates"]).includes(l.id);
                return (
                  <div className={"ml" + (retired ? " retired" : "")} key={l.id} data-lesson={l.id}>
                    <button type="button" className="ml-sum" title={l.scope || "This project"} onClick={() => set({ memoryLessonOpen: l.id })}><Icon name={QL.ICON[l.about === "you" ? "scope.you" : l.scope === "Stored in Git" ? "scope.git" : l.scope === "This computer only" || l.answer ? "scope.computer" : "memory.use"]} size={15} className="ml-mark" /><span className="ml-t">{l.title}</span>{retired ? <span className="ml-retired" style={{ flex: "none" }}>{l.retiredBy && l.retiredBy.startsWith("itself") ? "Retired by itself" : l.retiredBy ? "Retired at Review" : "Retired"}</span> : null}{stale(l) ? <span className="pillt ml-changed" title="Its files changed since it was checked"><Icon name="history" size={12} /><span className="ml-changed-t">Sources changed</span><span className="ml-changed-s">Changed</span></span> : null}<span className="ml-scope sr-only">{l.scope || "This project"}</span>{pinned ? <Icon name="pin" size={13} className="ml-pin" title="Pinned" /> : null}<Icon name="chevron-right" size={14} className="ml-chev" /></button>
                  </div>
                );
              })}
                {filtered && pages > 1 ? <nav className="row" style={{ gap: 8, justifyContent: "flex-end", padding: "10px 16px" }} aria-label="Results pages"><Btn disabled={at === 0} onClick={() => set({ memoryPage: at - 1 })}>Previous</Btn><Btn disabled={at >= pages - 1} onClick={() => set({ memoryPage: at + 1 })}>Next</Btn></nav> : null}
                {shownLessons.length && !filtered ? <p className="ml-empty">Search to find more.</p> : null}</>;
              })()}</section>
              {(() => {
                // ?lesson=<id> opens one lesson's dialog for a preview.
                const openId = c.memoryLessonOpen !== undefined ? c.memoryLessonOpen : new URLSearchParams(window.QL_PREVIEW_QUERY ?? location.search).get("lesson");
                const l = lessons.find((x) => x.id === openId);
                if (!l) return null;
                const pins = c.memoryPins || [], pinned = pins.includes(l.id), retired = (c.memoryRetired ?? ["nightly", "csvexport", "fxrates"]).includes(l.id);
                // At five pins in the project the switch is off and says why; an unpinned lesson cannot take a sixth.
                const full = !pinned && QL.data.task.files.memory.others + pins.length >= 5;
                const close = () => set({ memoryLessonOpen: null });
                const byTask = /^Saved by the task /.test(l.source);
                // New (12.7): a lesson about you has no project, files or commit; it applies in every repository.
                const mine = l.about === "you";
                return <div className="scrim" style={{ paddingTop: 16 }} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="dialog agent-dialog ml-dialog" tabIndex={-1} ref={focusOnMount} style={{ maxHeight: "calc(100dvh - 168px)", overflowY: "auto" }} role="dialog" aria-modal="true" aria-label={l.title} onKeyDown={dialogKeys(close)}>
                  <header className="row"><h2>{l.title}</h2><span className="sp" /><IconBtn icon="x" label="Close" onClick={close} /></header>
                  <p className="dim">{l.source} · {l.scope || "This project"}{retired && l.retiredBy ? (l.retiredBy.startsWith("itself: ") ? " · retired by itself: " + l.retiredBy.slice("itself: ".length) : " · retired at Verify: replaced by " + l.retiredBy) : ""}</p>
                  {/* An answer's body is the decision alone: its title already is the question. */}
                  <p>{l.answer && l.text.includes("Decided with you:") ? l.text.slice(l.text.indexOf("Decided with you:")) : l.text}</p>
                  {/* New (12.7): the person's own answer in a task stays theirs. */}
                  {l.answer ? <p className="dim">Your answer in a task. It stays on this computer. Agents find it when they search; it isn't offered at the start of a session.</p> : null}
                  {/* New (M1, M3): what the lesson rests on, the files it is about, and the commit it was last checked at. */}
                  {mine ? <p className="dim">In every repository, never in Git · saved {l.checked.replace("saved ", "")}</p> :
                  <dl className="ml-facts"><dt className="dim">Project</dt><dd>{l.projectName || QL.data.projects[0].label}</dd>{byTask ?<><dt className="dim">Task</dt><dd>{l.source.replace("Saved by the task ", "")}</dd></> : <><dt className="dim">Evidence</dt><dd>Historical lesson; check against the current project.</dd></>}
                    <dt className="dim">Rests on</dt><dd>{l.rests || <span className="dim">No decision named</span>}</dd>
                    {l.files ? <><dt className="dim">Files</dt><dd className="ml-files">{l.files.map((f) => <code key={f}>{f}</code>)}</dd></> : null}
                    {/* With no commit the lesson says when it was saved, not when it was checked. */}
                    {l.checked ? (/^saved /.test(l.checked) ? <><dt className="dim">Saved</dt><dd>{l.checked.replace("saved ", "")}</dd></> : <><dt className="dim">Checked at</dt><dd>{(c.memoryStillTrue || []).includes(l.id) ? "HEAD · just now, by you" : l.checked}</dd></>) : null}</dl>}
                  {stale(l) ? (
                    <section className="st-g ml-since" data-testid="since-checked"><h2>Since it was checked</h2>
                      <div className="st-r"><div className="st-l"><b>{fmt.plural(l.since.commits, "commit")} changed its files</b><span>Latest: {l.since.last}. The next task that changes these files rewrites, retires or confirms it at Verify. If no task checks it within 90 days, it retires itself. Nothing for you to do; Still true is there if you already know.</span></div><Btn onClick={() => set({ memoryStillTrue: (c.memoryStillTrue || []).concat(l.id) })}>Still true</Btn></div>
                    </section>
                  ) : null}
                  <section className="st-g"><h2>In your sessions</h2>
                    {retired || l.answer ? null : <div className="st-r"><div className="st-l"><b><Icon name={QL.ICON["memory.pin"]} size={15} className="st-ic" />Pin to every session</b><span>{full ? (mine ? "5 of yours are pinned. Unpin one first." : "5 are pinned here. Unpin one first.") : mine ? "First in every session. Up to 5 of yours." : "First in every session. Up to 5 per project."}</span></div><Switch on={pinned} disabled={full} onChange={(value) => set({ memoryPins: value ? pins.concat(l.id) : pins.filter((id) => id !== l.id) })} label="Pin to every session" /></div>}
                    <div className="st-r"><div className="st-l"><b><Icon name={QL.ICON["memory.use"]} size={15} className="st-ic" />Use in future tasks</b><span>Offered when it matches a task.</span></div><Switch on={!retired} onChange={(value) => set(value ? { memoryRetired: (c.memoryRetired ?? ["nightly", "csvexport", "fxrates"]).filter((id) => id !== l.id) } : { memoryRetired: (c.memoryRetired ?? ["nightly", "csvexport", "fxrates"]).concat(l.id), memoryPins: pins.filter((id) => id !== l.id) })} label="Use in future tasks" /></div>
                  </section></section></div>;
              })()}
              {/* As the App: the Import group, and its dialog (project, memory files, a receipt). Imported lessons stay private. */}
              <section className="st-g"><h2>Import</h2>
                <div className="st-r"><div className="st-l"><b><Icon name={QL.ICON["memory.import"]} size={15} className="st-ic" />Memories from Pilot Shell</b><span>Import saved knowledge from a Pilot folder, database, backup or exported files. Imported lessons stay private.</span></div><Btn onClick={() => set({ memoryImportOpen: true, memoryImportResult: null, pilotStep: "source" })}>Import from Pilot Shell</Btn></div>
                <details className="st-more">
                  <summary><Icon name="chevron-right" size={14} />Where memories go</summary>
                  <p className="st-foot">Your local memory stays authoritative. Project Git storage is optional and exports eligible lessons only. Personal lessons and private answers stay here. Exported project records sit in <code>docs/memories/&lt;yours&gt;/</code> with a readable LESSONS.md summary. Anyone with repository access can read exported lessons. Restore is explicit; QualityLayer never adds, commits, pushes or pulls files.</p>
                  <p className="st-foot">Recalled lessons become part of the agent’s task context and can reach its usual model provider. Your Claude Code and Codex memory settings stay as you configured them.</p>
                </details>
              </section>
              {c.memoryImportOpen ? (() => {
                const close = () => set({ memoryImportOpen: false });
                return <QL.PilotImportProposal app={app} c={c} set={set} close={close} focusOnMount={focusOnMount} dialogKeys={dialogKeys} />;
              })() : null}
              {(c.memoryProjectPick ?? query.get("pick") === "project") ? (() => {
                const close = () => set({ memoryProjectPick: false });
                const wanted = (c.memoryProjectQuery || "").trim().toLowerCase();
                const found = QL.projectChoices(app).slice(1).filter((p) => !wanted || p.label.toLowerCase().includes(wanted));
                return <div className="scrim" style={{ paddingTop: 16 }} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="dialog agent-dialog ml-dialog" tabIndex={-1} ref={focusOnMount} style={{ maxHeight: "calc(100dvh - 168px)", overflowY: "auto" }} role="dialog" aria-modal="true" aria-label="Choose project" onKeyDown={dialogKeys(close)}>
                  <header className="row"><h2>Choose project</h2><span className="sp" /><IconBtn icon="x" label="Close" onClick={close} /></header>
                  <p className="dim">Search for a project on this computer.</p>
                  <form className="ml-tools" style={{ padding: "12px 0" }} onSubmit={(e) => { e.preventDefault(); set({ memoryProjectQuery: c.memoryProjectDraft || "" }); }}><label className="ml-search"><input type="search" aria-label="Search projects" placeholder="Search projects" value={c.memoryProjectDraft || ""} onChange={(e) => set({ memoryProjectDraft: e.target.value })} /></label><Btn type="submit">Search</Btn></form>
                  {/* 12.7: the choices are rows of one group, as Manage projects draws them: every project, yours, then each project with its tile; one count, in lessons. */}
                  <section className="st-g"><h2>Projects</h2>
                    {wanted ? null : <>
                      <div className="st-r"><div className="st-l"><b><Icon name={QL.ICON["scope.all"]} size={15} className="st-ic" />All projects</b><span>{fmt.plural(lessons.length, "lesson")}</span></div><Btn aria-label="Select All projects" onClick={() => set({ memoryProject: "all", memoryProjectPick: false, memoryProjectDraft: "", memoryProjectQuery: "" })}>Select</Btn></div>
                      <div className="st-r"><div className="st-l"><b><Icon name={QL.ICON["scope.you"]} size={15} className="st-ic" />Yours · every project</b><span>{fmt.plural(lessons.filter((l) => l.about === "you").length, "lesson")} · every repository</span></div><Btn aria-label="Select Yours · every project" onClick={() => set({ memoryProject: "you", memoryProjectPick: false, memoryProjectDraft: "", memoryProjectQuery: "" })}>Select</Btn></div>
                    </>}
                    {found.map((p, index) => { const n = index === 0 ? lessons.filter((l) => l.about !== "you").length : 0; return <div className="st-r" key={p.value}><div className="st-l"><b><span style={{ display: "inline-flex", marginRight: 8 }}><QL.Tile f={app.v.projectTile(p.value)} xs /></span>{p.label}</b><span>{fmt.plural(n, "lesson")} · {c["memoryShare_" + p.value] ? "Stored in Git" : "This computer only"}</span></div><Btn aria-label={"Select " + p.label} onClick={() => set({ memoryProject: p.value, memoryProjectPick: false, memoryProjectDraft: "", memoryProjectQuery: "" })}>Select</Btn></div>; })}
                    {found.length === 0 ? <p className="ml-empty">No projects match this search.</p> : null}
                  </section>
                  {/* Projects whose folder is gone are not an error: one quiet line here, nothing red on the page (?gone=12 previews it). */}
                  {Number(query.get("gone")) > 0 ? <p className="st-foot">{Number(query.get("gone")) === 1 ? "1 project's folder is gone" : Number(query.get("gone")) + " projects' folders are gone"}</p> : null}
                </section></div>;
              })() : null}

            </div>
            );
          })() : null}
          {/* Licence is drawn by settings.jsx; About stays here. */}
          {tab === "licence" ? <QL.LicencePage app={app} /> : null}
          {tab === "about" ? (
            <div className="st">
              <section className="st-g">
                <h2>QualityLayer {QL.settingsModelVersion}<span className="st-rec" data-testid="about-line">Up to date · checked today at {fmt.clock(Date.now() - 4 * 60000)}</span></h2>
                <div className="st-r"><div className="st-l"><b><RowIcon m="data.updates" />Check for updates</b><span>QualityLayer checks every hour, downloads in the background and asks before it restarts.</span></div><Btn onClick={() => app.toast(c.channel === "beta" ? "Checked the beta channel: you are on the latest beta" : "Checked: you are on the latest version")}>Check now</Btn></div>
                {/* The update channel: Beta also offers prereleases; the newest release wins, so a newer stable replaces a beta. Switching back never downgrades. */}
                <div className="st-r"><div className="st-l"><b><RowIcon m="channel" />Update channel</b><span>{c.channel === "beta" ? "You get betas first and move to each stable release when it is newer. If something breaks, report a problem below." : "Stable releases only. Choose Beta to try new features before they ship."}</span></div><Seg label="Update channel" value={c.channel || "stable"} options={[{ value: "stable", label: "Stable", icon: QL.ICON["channel.stable"] }, { value: "beta", label: "Beta", icon: QL.ICON["channel.beta"] }]} onChange={(v) => { set({ channel: v }); app.toast(v === "beta" ? "Beta channel: the next check offers the newest beta" : "Stable channel: you stay on this version until a newer stable release"); }} /></div>
                <div className="st-r"><div className="st-l"><b><RowIcon m="about.disk" />Disk use</b><span>412 MB in <span className="mono">~/.qualitylayer</span>. Logs and run records are capped.</span></div><Btn onClick={() => app.toast("Shows what the QualityLayer home holds")}>Show in Finder</Btn></div>
              </section>
              <section className="st-g" data-screen-label="Release notes"><h2>Release notes<span className="st-rec"><a className="lnk" href="https://github.com/maxritter/qualitylayer/releases" target="_blank" rel="noopener noreferrer">GitHub Releases</a></span></h2><p className="st-foot" role="status">{new URLSearchParams(window.QL_PREVIEW_QUERY ?? location.search).get("notes")==="unavailable" ? "Release notes could not be loaded. You can read them on GitHub." : "Read all published release notes on GitHub."}</p></section>
              <section className="st-g" data-screen-label="Help">
                <h2>Help</h2>
                <div className="st-r"><div className="st-l"><b><RowIcon m="docs" />Documentation</b><span>qualitylayer.dev/docs</span></div><Btn onClick={() => app.toast("Opens the docs in the browser")}>Open docs</Btn></div>
                <div className="st-r"><div className="st-l"><b><RowIcon m="tour" />App tour</b><span>Explore Chat, planned changes, artifacts and Settings.</span></div><Btn onClick={() => { const stops = QL.ONB_STOPS.filter(stop => !stop.team); const stop = stops[app.s.onbPaused]?.id; location.href = "onboarding-tour.html?new-user=tour" + (stop ? "&stop=" + encodeURIComponent(stop) : ""); }}>{app.s.onbPaused ? "Continue tour" : "Replay tour"}</Btn></div>
                <div className="st-r"><div className="st-l"><b><RowIcon m="support" />Something wrong?</b><span>Preview a public GitHub issue with basic App and OS details. You review text and screenshots before sending.</span></div><Btn onClick={() => app.set({ dialog: "feedback" })}>Report…</Btn></div>
                <p className="st-foot"><a className="lnk" href="https://qualitylayer.dev/docs/reference/files#privacy" target="_blank" rel="noopener noreferrer" onClick={(event) => event.preventDefault()}>What is sent and what stays here</a></p>
              </section>
              {QL.ServerGroup ? <QL.ServerGroup app={app} /> : null}
            </div>
          ) : null}
          </div></div>
        </div>
      </div>
    );
  }

  /* ── A Library artifact open (Artifacts place: attention.jsx). Local artifacts only, no remote link. ── */
  const WAIT_WORD = { you: "waits for you", work: "working now", quiet: "quiet", stop: "stopped" };
  const pagesWord = (n) => n + (n === 1 ? " page" : " pages");

  /** An open task as the Artifacts place marks it: the sidebar's four states and the step it is in. */
  function taskInfo(app, id) {
    const { v } = app;
    if (id === "billing") {
      const y = v.yourTurn;
      const state = y ? (y.mark === "stop" ? "stop" : "you") : v.agent.mark === "quiet" ? "quiet" : v.agent.mark === "stop" ? "stop" : "work";
      return { id, title: QL.data.task.title, state, step: QL.STEP3_LABEL[QL.STEP3[v.stage]] };
    }
    const t = QL.data.projectTasks.find((x) => x.id === id);
    return { id, title: t.title, state: t.mark === "quiet" ? "quiet" : "work", step: t.end };
  }
  const TaskDot = ({ state }) => <i className="ds-mk" data-state={state} title={WAIT_WORD[state]} role="img" aria-label={WAIT_WORD[state]} />;

  /** A thumbnail: the top of the artifact drawn small. Plain shapes stand for the page. */
  function Thumb({ kind, bare }) {
    const body = (
      <>
        {kind === "app" ? <span className="ds-mini app"><i className="a-bar" /><i className="a-side"><b /><b /><b /><b /></i><i className="a-main"><b /><b /><b /></i></span>
          : kind === "dash" ? <span className="ds-mini dash"><i className="d-top" /><i className="d-row"><b /><b /><b /></i><i className="d-chart"><b /><b /><b /><b /><b /><b /></i></span>
          : <span className="ds-mini flow"><i className="f-row"><b /><b /><b /><b /><b /></i><i className="f-card" /><i className="f-card s" /></span>}
      </>
    );
    return bare ? body : <span className="ds-th" aria-hidden="true">{body}</span>;
  }

  /** What a page of a lasting artifact shows on the canvas: the real page runs here, interactive; the model draws its shape. */
  function PageMock({ item, page, f }) {
    const rows = { "Rate limits": [["Requests per minute", "600"], ["Burst", "1 200"], ["Resets", "in 3 h, at 09:00 your time"]], "Overview": [["Calls today", "48 210"], ["Errors", "0.2 %"], ["p95", "180 ms"]], "API keys": [["Live key", "••••3f9a"], ["Test key", "••••c1d2"]], "Webhooks": [["Delivered today", "12 480"], ["Retrying", "3"], ["Failed", "0"]], "Billing": [["Seats", "12"], ["Next invoice", "1 Nov"]] }[page];
    if (item.name === "app-model" && page === "Sidebar")
      return (
        <div className="pm-app">
          <div className="pm-side">
            <p className="pm-k">Projects</p>
            {[["PL", "teal", "platform", true], ["WE", "green", "web", false], ["IN", "plum", "infra", false]].map(([lt, c, n, open]) => (
              <div key={n}><div className="pm-ph"><Tile f={{ letters: lt, color: c, label: n }} /><span>{n}</span></div>{open ? <><div className="pm-tr"><i className="pm-dot" /><span>{QL.data.task.title}</span></div><div className="pm-tr dim"><span /><span>Shipped 2 · archived 2</span></div></> : null}</div>
            ))}
          </div>
          <div className="pm-main"><h4>Sidebar</h4><p>Tasks under their projects. A folded project keeps the count that waits on you.</p></div>
        </div>
      );
    return (
      <div className="pm-doc">
        <div className="pm-bar" style={{minWidth:0}}><Tile f={f} xs /><b title={item.title} style={{minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.title}</b><span>/</span><span>{page}</span></div>
        <h4>{page}</h4>
        {rows ? <div className="pm-rows">{rows.map(([k, val]) => <div key={k}><span>{k}</span><b>{val}</b></div>)}</div> : <div className="pm-blocks"><i /><i /><i /><i /></div>}
      </div>
    );
  }

  /** The page picker in an artifact's header, after its name: the open page, where it sits in the list, and every page
      in one menu, the way a design tool switches files. A row of tabs ran off the window once an artifact had many pages.
      More than eight pages add a filter at the top of the menu; the dot marks a page an open task changes. */
  function PagePick({ app, id, pages, page, onPick, mark }) {
    const [find, setFind] = useState("");
    const open = app.s.pop === id;
    const at = pages.indexOf(page);
    const shown = find ? pages.filter((p) => p.toLowerCase().includes(find.trim().toLowerCase())) : pages;
    return (
      <span className="dv-menu ds-page-pick">
        <button type="button" className="ds-page-btn" aria-haspopup="menu" aria-expanded={open} aria-label={"Page: " + page + ", " + (at + 1) + " of " + pages.length} title={page} onClick={() => { setFind(""); app.togglePop(id); }}>
          <Icon name="file" size={13} /><span className="ds-page-nm">{page}</span>{mark ? mark(page) : null}<span className="ds-page-n">{at + 1}/{pages.length}</span><Icon name="chevrons-up-down" size={13} />
        </button>
        {open ? (
          <div className="pop menu ds-page-menu" role="menu" aria-label="Pages of this artifact">
            {pages.length > 8 ? <label className="ds-page-find"><Icon name="search" size={13} /><input autoFocus value={find} placeholder={"Find among " + pages.length + " pages"} aria-label="Find a page" onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") app.set({ pop: null }); else if (e.key === "Enter" && shown[0]) { app.set({ pop: null }); onPick(shown[0]); } }} /></label> : null}
            <div className="ds-page-list">
              {shown.map((p) => <QL.MenuItem key={p} radio checked={p === page} icon="file" onClick={() => { app.set({ pop: null }); onPick(p); }}>{p}{mark ? mark(p) : null}</QL.MenuItem>)}
              {shown.length ? null : <p className="ds-page-none">No page matches “{find.trim()}”</p>}
            </div>
          </div>
        ) : null}
      </span>
    );
  }

  /** A Library artifact open: its shared header, pages, canvas and Activity / Feedback / Agent rail.
      It is found by identity (owner project and folder name), so a listing in another project, a rename or an archive never
      sends a task's link to a different artifact. Its actions are the Library row's: Rename, Duplicate, Copy or show, Archive, Delete. */
  function LastingArtifact({ app }) {
    const { s, v } = app;
    const [infoOpen, setInfoOpen] = useState(false);
    const [manageOpen, setManageOpen] = useState(false);
    const [askSpot, setAskSpot] = useState(null), [dragMark, setDragMark] = useState(null);
    const feedbackButton = React.useRef(null);
    const markArtifact = mark => { app.set({ artifactCommenting: false }); setAskSpot(null); setDragMark(null); app.askAgent({ artifact: item, page, section: mark.kind === "text" ? "selection" : mark.region ? "area" : "spot-" + mark.x + "-" + mark.y, revision: item.history?.[0]?.sha || "local-current", quote: mark.quote || page, ...(mark.region ? { region: mark.region } : {}) }); };
    React.useEffect(() => { app.set({ artifactCommenting: false }); setAskSpot(null); }, [s.route.page, s.route.artifactName]);
    const archiveState = new URLSearchParams(window.QL_PREVIEW_QUERY ?? location.search).get("archive");
    const preservedReason = ["unprepared", "incomplete", "busy", "late-write", "invalid", "conflict", "limit", "changed", "fault"].includes(archiveState) ? archiveState : null;
    const hasArchive = preservedReason !== null || ["complete", "entry", "missing", "unsafe", "unavailable"].includes(archiveState);
    const [recordOpen, setRecordOpen] = useState(preservedReason !== null || ["entry", "missing", "unsafe", "unavailable"].includes(archiveState));
    const [recordProblem, setRecordProblem] = useState(archiveState === "unavailable");
    const [snapshotChoice, setSnapshotChoice] = useState(preservedReason ? "c".repeat(64) : "baseline");
    const [historyRefreshed, setHistoryRefreshed] = useState(false);
    const [originalOpen, setOriginalOpen] = useState(archiveState === "invalid");
    const recordHeading = React.useRef(null);
    const recordRow = React.useRef(null);
    React.useEffect(() => { if (recordOpen) recordHeading.current?.focus(); }, [recordOpen]);
    const [measuredFold, setFold] = useState(0);
    const fold = window.QL_WNN_MODE !== "current" && app.width <= 480 ? 3 : measuredFold;
    const r = s.route;
    // Fold one view group into the menu per frame while the artifact or page name is cut or the bar overflows.
    React.useLayoutEffect(() => {
      const bar = (window.QL_WNN_MODE === "proposed" && document.querySelector('.wnn-artifact-viewbar')) || document.querySelector('[data-testid="artifact-header"]');
      if (!bar || fold >= 3) return;
      const cut = Array.from(bar.querySelectorAll(".ds-name,.ds-page-nm")).some((el) => el.scrollWidth > el.clientWidth + 1);
      if (cut || bar.scrollWidth > bar.clientWidth + 1) setFold(fold + 1);
    });
    React.useEffect(() => setFold(0), [r.page, r.artifactName, s.navOpen, s.railOpen, s.full]);
    React.useEffect(() => { const again = () => setFold(0); window.addEventListener("resize", again); return () => window.removeEventListener("resize", again); }, []);
    const narrow = app.width <= 640;
    const rail = !!s.railOpen && !s.full;
    const setRail = (on) => app.set({ railOpen: on });
    const item = (s.lib || []).find((l) => l.id === r.artifactName) || null;
    const from = s.libFrom;
    const back = () => QL.libBack(app);
    const zoom = s.artifactZoom || 100;
    const setZoom = (value) => app.set({ artifactZoom: Math.max(25, Math.min(200, value)), pop: null });
    const theme = s.artifactTheme || s.theme;
    const device = s.artifactDevice || "desk";
    const information = () => { setInfoOpen(true); app.set({ railOpen: true, route: Object.assign({}, r, { dtab: "activity" }), pop: null }); };
    const head = (title, f, pick) => (window.QL_WNN_ARTIFACT_HEADER || ((value) => value))(
      <div className="tb ds-head ds-open-head artifact-agent-header artifact-unified-header" data-testid="artifact-header" role="toolbar" aria-label="Artifact">
        {(!s.navOpen || narrow) && !s.full ? <IconBtn icon="panel-left" label={(narrow ? "Menu" : "Show the task list") + (QL.needsYouOf?.(app) ? " · " + QL.needsYouOf(app) + " need you" : "")} side="right" badge={QL.needsYouOf?.(app) ? (QL.needsYouOf(app) > 9 ? "9+" : QL.needsYouOf(app)) : null} onClick={() => (narrow ? app.set({ sheet: true }) : app.set({ navOpen: true }))} /> : null}
        <IconBtn icon="arrow-left" label={from ? from.label : "Back to Artifacts"} side="right" onClick={back} />
        <nav className="ds-crumbs" aria-label="Where this artifact is">
          <button type="button" className="ds-crumb-link" onClick={() => { app.set({ libFrom: null, libReturnTo: item ? item.id : null }); app.go({ view: "artifacts" }); }}>Artifacts</button>
          {f ? <><span className="ds-sl" aria-hidden="true">/</span><Tile f={f} xs /><span className="ds-pn" title={f.label}>{f.label}</span></> : null}
          <span className="ds-sl" aria-hidden="true">/</span>
          <h1 className="ds-name" title={title}>{title}</h1>
          {pick ? <><span className="ds-sl" aria-hidden="true">/</span>{pick}</> : null}
        </nav>
        <span className="ds-sp" />
        {/* By use: how it looks, the two ways to act on it (feedback, its agent), the one outward action, the rest. */}
        {item ? <>
          {/* View controls sit in the free space; when the names would be cut they fold into the view menu, device first,
              then theme, then zoom. Present always lives in that menu. */}
          {fold < 3 ? <span className="artifact-header-zoom" role="group" aria-label="Zoom"><IconBtn icon="zoom-out" label="Zoom out · −" onClick={() => setZoom(zoom - 25)} /><button type="button" className="btn sm" aria-label={zoom === 100 ? "Fit the width" : zoom + " %, fit the width"} title="Fit the width · 0" onClick={() => setZoom(100)}>{zoom === 100 ? "Fit" : zoom + "%"}</button><IconBtn icon="zoom-in" label="Zoom in · +" onClick={() => setZoom(zoom + 25)} /></span> : null}
          {fold < 2 ? <span className="artifact-header-seg" role="group" aria-label="Theme">{[["light", "sun", "Light"], ["dark", "moon", "Dark"]].map(([value, icon, label]) => <IconBtn key={value} icon={icon} label={label} on={theme === value} aria-pressed={theme === value} onClick={() => app.set({ artifactTheme: value })} />)}</span> : null}
          {fold < 1 ? <span className="artifact-header-seg" role="group" aria-label="Device">{[["desk", "monitor", "Desktop"], ["phone", "smartphone", "Phone"]].map(([value, icon, label]) => <IconBtn key={value} icon={icon} label={label} on={device === value} aria-pressed={device === value} onClick={() => app.set({ artifactDevice: value })} />)}</span> : null}
          {fold ? <span className="dv-menu"><IconBtn icon="sliders-horizontal" label="More view options" aria-haspopup="menu" aria-expanded={s.pop === "lasting-view"} on={s.pop === "lasting-view"} onClick={() => app.togglePop("lasting-view")} />{s.pop === "lasting-view" ? <div className="pop menu" role="menu" aria-label="More view options" style={{ right: 0, top: "calc(100% + 6px)" }}>
            {fold >= 3 ? <><QL.MenuItem icon={QL.ICON["zoom.in"]} onClick={() => setZoom(zoom + 25)}>Zoom in <span className="kbd-hint">+</span></QL.MenuItem><QL.MenuItem icon={QL.ICON["zoom.out"]} onClick={() => setZoom(zoom - 25)}>Zoom out <span className="kbd-hint">−</span></QL.MenuItem><QL.MenuItem radio checked={zoom === 100} icon={QL.ICON["zoom.fit"]} onClick={() => setZoom(100)}>Fit the width <span className="kbd-hint">0</span></QL.MenuItem></> : null}
            {fold >= 2 ? <>{fold >= 3 ? <div className="menu-sep" /> : null}{["light", "dark"].map((value) => <QL.MenuItem key={value} radio checked={theme === value} icon={QL.ICON["theme." + value]} onClick={() => app.set({ artifactTheme: value, pop: null })}>{value === "light" ? "Light" : "Dark"}</QL.MenuItem>)}</> : null}
            {fold >= 1 ? <>{fold >= 2 ? <div className="menu-sep" /> : null}{[["desk", "Desktop"], ["phone", "Phone"]].map(([value, label]) => <QL.MenuItem key={value} radio checked={device === value} icon={QL.ICON[value === "desk" ? "device.desktop" : "device.phone"]} onClick={() => app.set({ artifactDevice: value, pop: null })}>{label}</QL.MenuItem>)}</> : null}
          </div> : null}</span> : null}
          <span className="tb-sep" />
          <button type="button" className="chip artifact-header-agent" aria-label={"Open Agent for " + item.title} title={QL.agentNameOf(s.artifactAgents?.[item.id]?.agent || s.config.planAgent || "claude") + " · " + (s.artifactAgents?.[item.id]?.status === "running" ? "working" : "ready") + " · Open Agent for " + item.title} onClick={() => app.set({ railOpen: true, route: Object.assign({}, r, { dtab: "agent" }), pop: null })}>{(() => { const run = s.artifactAgents?.[item.id]; const live = run && !["idle", "external"].includes(run.status); const named = live && ["claude", "codex", "pi", "opencode"].includes(run.agent); const shown = named ? run.agent : (s.config.planAgent || "claude"); return <><QL.AgentMark agent={shown} size={14} /><b>{QL.agentNameOf(shown)}</b>{live && run.status === "running" ? <QL.Mark state="work" sm /> : null}</>; })()}</button>
          <span className="artifact-header-feedback-tools artifact-feedback-tools"><button ref={feedbackButton} type="button" className={"btn sm" + (s.artifactCommenting ? " on" : "")} aria-label="Feedback" aria-pressed={s.artifactCommenting} title="Mark a spot or area for feedback" onClick={() => { setAskSpot(null); app.set({ artifactCommenting: !s.artifactCommenting }); }}><Icon name="message-square-plus" size={14}/><span>Feedback</span></button><QL.ArtifactExportModel app={app} title={item.title} pages={item.pages.length}/></span>
          <QL.LibMenu app={app} rec={item} here={item.project} inViewer viewerTools={[
            { key: "favorite", icon: "star", text: (s.libFavorites || []).includes(item.id) ? "Remove from favorites" : "Add to favorites", run: () => QL.libActions.favorite(app, item, !(s.libFavorites || []).includes(item.id)) },
            { key: "information", icon: "info", text: "Artifact information and history", run: information },
            { key: "source", icon: "history", text: "Source and history", run: () => { information(); setManageOpen(true); } },
            { key: "browser", icon: "external-link", text: "Open in browser", run: () => app.toast("Prototype: " + item.title + " · " + page + " opens at the current section and stays in your browser, with source refresh") },
          ]} />
          {s.full ? <IconBtn icon="minimize-2" label="Leave full screen · Esc" onClick={() => app.set({ full: false, artifactZoom: 100 })} /> : null}
        </> : null}
        {item && !s.full ? <><span className="tb-sep" /><IconBtn icon={rail ? "panel-right-close" : "panel-right-open"} label={(rail ? "Hide" : "Show") + " artifact sidebar"} side="left" on={rail} onClick={() => setRail(!rail)} /></> : null}
      </div>, app
    );
    // An artifact that is no longer in the Library: a link from a task, an old bookmark or an artifact just deleted.
    if (!item) {
      const gone = (s.libDeleted || []).find((x) => x.id === r.artifactName);
      const users = gone ? gone.changing.map((c) => QL.data.task && c.task === "billing" ? QL.data.task.title : (QL.data.projectTasks.find((t) => t.id === c.task) || {}).title).filter(Boolean) : [];
      return (
        <main className="ds-page ds-open artifact-agent-page" data-testid="lasting-artifact" aria-label="Artifact not in the Library">
          {head(gone ? gone.title : "Not in the Library", gone ? v.projectTile(gone.project) : null)}
          <div className="lb-gone" role="status">
            <Icon name="trash-2" size={18} />
            <h2>{gone ? "“" + gone.title + "” was deleted from the Library" : "This artifact isn't in the Library"}</h2>
            <p>{gone ? (users.length ? users.join(" and ") + (users.length > 1 ? " keep their drafts; each draft" : " keeps its drafts; each") + " now stands alone as a new artifact. " : "") + "Restoring brings it back with its pages, history and listings." : "It may have been deleted, or it belongs to a library fixture that isn't loaded."}</p>
            <div className="lb-acts">{gone ? <Btn sm pri icon="rotate-ccw" onClick={() => app.set((p) => ({ lib: p.lib.concat([gone]), libDeleted: (p.libDeleted || []).filter((x) => x.id !== gone.id) }))}>Restore “{gone.title}”</Btn> : null}<Btn sm onClick={back}>{from ? from.label : "Back to Artifacts"}</Btn></div>
          </div>
        </main>
      );
    }
    const f = v.projectTile(item.project);
    const page = item.pages.includes(r.page) ? r.page : item.pages[0];
    const tab = r.dtab === "agent" ? "agent" : "activity";
    const setTab = (dtab) => app.set({ route: Object.assign({}, r, { dtab }) });
    const changing = item.changing.map((c) => Object.assign({ pages: c.pages, drafts: c.drafts || [] }, taskInfo(app, c.task)));
    const clash = QL.conflictOf(item);
    const dotFor = (p) => { const c = changing.find((x) => x.pages.includes(p)); return c ? (clash.includes(p) ? "you" : c.state) : null; };
    const comments = (item.comments || []).concat((s.myComments || []).filter((note) => note.artifactId === item.id), s.artifactNotes?.[item.id] || []);
    const open = rail;
    const alsoIn = (item.alsoIn || []).map((id) => v.projectTile(id));
    const go = (patch) => app.set({ route: Object.assign({}, r, patch) });
    const copiedFrom = item.copiedFrom ? (s.lib || []).find((x) => x.id === item.copiedFrom) : null;
    const archivedNote = {id:"illustrative-record-1",doc:page,created:"2026-11-10T14:21:00Z",author:"You",remark:"Keep the source and its revision history together.",quote:"Usage",spot:{x:200,y:150},legacyContext:{originalValue:"Kept unchanged"}};
    const currentNote = {...archivedNote,remark:"Keep this later local edit alongside the earlier saved history.",created:"2026-11-11T07:30:00Z"};
    const snapshot = (id,note,invalid=false) => ({id,entries:[{id:invalid?"source-comments":"comments-1",doc:invalid?"":page,source:"comments",retainedAnswer:false,bytes:420,sha256:"a".repeat(64),assets:invalid?[]:["illustrative-asset-1"],attachments:invalid?[]:[{id:"illustrative-asset-1",name:"layout-note.txt",type:"text/plain",bytes:32,state:archiveState === "missing" ? "missing" : archiveState === "unsafe" ? "unsafe" : "available"}]}]});
    const savedSnapshot = snapshot("baseline",archivedNote);
    const rawBytes = new URLSearchParams(window.QL_PREVIEW_QUERY ?? location.search).get("format") === "bytes";
    const currentSnapshot = snapshot("c".repeat(64),currentNote,preservedReason === "invalid");
    const archiveStatus = archiveState === "absent" ? {state:"absent",snapshots:[]} : preservedReason ? {state:"preserved",reason:preservedReason,snapshots:["unprepared","incomplete"].includes(preservedReason) ? [] : [savedSnapshot],current:preservedReason === "fault" ? undefined : {...currentSnapshot,invalid:preservedReason === "invalid"}} : {state:"ready",snapshots:[savedSnapshot]};
    const snapshots = [archiveStatus.current,...archiveStatus.snapshots].filter(Boolean);
    const selectedSnapshot = snapshots.find(entry => entry.id === snapshotChoice) || snapshots[0];
    const isCurrent = selectedSnapshot?.id === archiveStatus.current?.id;
    const rawSource = isCurrent && archiveStatus.current?.invalid;
    const selectedNote = isCurrent ? currentNote : archivedNote;
    const selectedEntry = rawSource ? null : selectedSnapshot?.entries[0] && {display:{text:selectedNote.remark,author:selectedNote.author,created:selectedNote.created,context:{doc:page,quote:selectedNote.quote}},attachments:selectedSnapshot.entries[0].attachments};
    const originalRecord = rawSource ? rawBytes ? null : '{"id":"illustrative-record-1","remark":"Interrupted source' : JSON.stringify(selectedNote,null,2);
    const recordCount = selectedSnapshot?.entries.length || 0;
    const historyMessage = {unprepared:"History has not been saved yet. The original records are kept.",incomplete:"Saving history was interrupted. The original records are kept.",busy:"History is still in use. The original records remain available.","late-write":"The original records changed after the last saved version. Both are kept.",invalid:"The current source could not be read as records. Its original text is kept.",conflict:"Conflicting records are kept. Saved versions and current source remain available.",limit:"History exceeds the current limit. No records have been removed.",changed:"The source changed while history was being read. Earlier versions are kept.",fault:"History could not be read. Saved versions remain available."}[preservedReason];
    return (
      <main className="ds-page ds-open artifact-agent-page" data-testid="lasting-artifact" aria-label={item.title}>
        {head(item.title, f, item.pages.length > 1 ? <PagePick app={app} id="lasting-pages" pages={item.pages} page={page} onPick={(p) => go({ page: p })} mark={(p) => { const dot = dotFor(p); return dot ? <i className="ds-mk" data-state={dot} title={clash.includes(p) ? "Two open tasks change this page" : "Being changed in an open task"} /> : null; }} /> : null)}
        {s.artifactSectionError ? <p className="lb-banner" role="status">{s.artifactSectionError}</p> : null}
        <QL.LibFavoriteError app={app} />
        {item.archived ? <div className="lb-banner" role="status"><Icon name="archive" size={14} /><span><b>Archived {QL.agoWords(Date.now() - item.archived)}.</b> It's hidden from the Library{changing.length ? "; " + changing.map((c) => c.title).join(" and ") + " still draft on it and open it here" : ""}.</span><Btn sm onClick={() => QL.libActions.restore(app, item)}>Restore</Btn></div> : null}
        <div className="ds-work">
          <div className="ds-canvas" tabIndex={0} aria-label="Artifact page" onMouseUp={event => { if (s.artifactCommenting || event.target.closest('.artifact-feedback-selection')) return; const selection=window.getSelection(),quote=selection?.toString().trim(); if(quote?.length>=3&&selection.rangeCount){const rect=selection.getRangeAt(0).getBoundingClientRect(),bounds=event.currentTarget.getBoundingClientRect();setAskSpot({kind:"text",x:Math.round(rect.left-bounds.left),y:Math.round(rect.top-bounds.top),quote,screenX:rect.left,screenY:rect.top});}else setAskSpot(null); }}>
            {s.artifactCommenting ? <><div className="artifact-feedback-hint" role="status"><Icon name="mouse-pointer-2" size={14}/><span>Click a spot or drag an area</span><button type="button" aria-label="Cancel feedback" onClick={() => { app.set({ artifactCommenting: false }); feedbackButton.current?.focus(); }}>Esc</button></div><button type="button" className="dv-spot-target" aria-label="Click a spot or drag an area for feedback" onPointerDown={event => { if(event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);setDragMark({x:event.clientX,y:event.clientY,toX:event.clientX,toY:event.clientY}); }} onPointerMove={event=>{if(dragMark)setDragMark({...dragMark,toX:event.clientX,toY:event.clientY});}} onPointerCancel={()=>setDragMark(null)} onPointerUp={event => { if(!dragMark)return; const bounds=event.currentTarget.parentElement.getBoundingClientRect();markArtifact({x:Math.round(dragMark.x-bounds.left),y:Math.round(dragMark.y-bounds.top),quote:page,...(Math.abs(event.clientX-dragMark.x)+Math.abs(event.clientY-dragMark.y)>6?{region:{x:Math.round(Math.min(event.clientX,dragMark.x)-bounds.left),y:Math.round(Math.min(event.clientY,dragMark.y)-bounds.top),w:Math.round(Math.abs(event.clientX-dragMark.x)),h:Math.round(Math.abs(event.clientY-dragMark.y))}}:{})}); }} onKeyDown={event => { if(event.key==='Enter'||event.key===' '){event.preventDefault();markArtifact({x:40,y:40,quote:page});} }}/></> : null}
            {s.loading ? <QL.LoadingState app={app} kind="artifact" what={s.loading === "finding" ? "Opening the artifact" : "Drawing " + page} why={<>The page's script stopped: <code>TypeError: steps is undefined</code>. Other pages of {item.title} still open.</>} back={["Back to Artifacts", back]} />
              : <div className="ds-frame artifact-header-preview" data-theme={theme} style={{ width: device === "phone" ? 390 : "100%", maxWidth: "none", transform: "scale(" + zoom / 100 + ")", transformOrigin: "top left" }}><PageMock item={item} page={page} f={f} /></div>}
            {dragMark ? <div className="artifact-feedback-area" style={{left:Math.min(dragMark.x,dragMark.toX),top:Math.min(dragMark.y,dragMark.toY),width:Math.abs(dragMark.toX-dragMark.x),height:Math.abs(dragMark.toY-dragMark.y)}}/> : null}
            {askSpot && !s.artifactCommenting ? <button type="button" className="artifact-feedback-selection" style={{left:Math.max(8,Math.min(askSpot.screenX,app.width-112)),top:Math.max(8,askSpot.screenY-34)}} onPointerDown={event=>event.preventDefault()} onClick={()=>markArtifact(askSpot)}><Icon name="message-square-plus" size={14}/>Feedback</button> : null}
          </div>
          {open ? (
            <aside className="rs ds-side agent-rail artifact-agent-rail" aria-label={item.title + ": Conversation, Terminal and Files"} data-testid="artifact-side" style={{ width: narrow ? "min(520px,92%)" : app.railWidth }}>
              <QL.Resizer side="left" width={app.railWidth} min={320} onCollapse={() => app.set({ railOpen: false })} max={app.railMax} onResize={(width) => app.set({ railWidth: width })} onReset={() => app.set({ railWidth: 520 })} onDragging={app.setResizing} label="Resize the right sidebar" />
              <div className="rs-hd agent-rail-header" id="sid-header-artifact" data-screen-label="Artifact sidebar tools">
                <QL.SidebarViewTabs app={app} artifact={item}/>
              </div>
              <div className="sidebar-view-content" id="artifact-sidebar-panel" role="tabpanel" aria-labelledby={"artifact-tab-"+(tab==="agent"?QL.chatViewOf(app):tab==="activity"?"files":"comments")}>
              {s.loading ? <QL.LoadingRail /> : tab === "agent" ? <div id="lasting-panel-agent" className="artifact-agent-content"><QL.ArtifactAgentPanel app={app} artifact={item} /></div> : <div id={"lasting-panel-" + tab} className="rs-b ds-side-body" role="tabpanel" aria-labelledby={"lasting-tab-" + tab}>
                {tab === "activity" ? <div className="row" style={{margin:"12px 0"}}><Btn sm icon="history" onClick={() => setManageOpen(!manageOpen)}>Source and history</Btn></div> : null}
                {tab === "activity" && manageOpen ? <QL.ArtifactManage app={app} d={{...item,file:page,what:item.purpose,at:Date.now()}} onClose={() => setManageOpen(false)}/> : null}
                {tab === "activity" && hasArchive ? <section className="ds-rsec" id="artifact-records" data-screen-label="Artifact annotation history" aria-label="Annotation history">
                  <h3 className="ds-rh"><span>Annotation history</span><span className="ds-rn">{snapshots.length > 1 ? snapshots.length + " versions" : recordCount ? recordCount + (recordCount === 1 ? " record" : " records") : "1 source"}</span></h3>
                  {archiveStatus.state === "preserved" ? <><p className="ds-quiet" role="status">{historyMessage}</p><Btn sm onClick={() => setHistoryRefreshed(true)}>{["unprepared","incomplete"].includes(preservedReason) ? "Save history" : preservedReason === "late-write" ? "Save new history" : "Load history again"}</Btn>{historyRefreshed ? <p className="ds-quiet" role="status">History reread. The original records are kept.</p> : null}</> : null}
                  {snapshots.length > 1 ? <div className="launch-request" style={{margin:"12px 0"}}><span>Version</span><Select label="History version" width="100%" value={selectedSnapshot.id} options={snapshots.map(version => ({value:version.id,label:version.id === archiveStatus.current?.id ? "Current source · not archived" : "Saved version · 10 November"}))} onChange={value => {setSnapshotChoice(value);setRecordOpen(true);}} /></div> : null}
                  {recordOpen ? <>
                    <Btn sm quiet icon="arrow-left" onClick={() => { setRecordOpen(false); requestAnimationFrame(() => recordRow.current?.focus()); }}>Back to records</Btn>
                    <h4 ref={recordHeading} tabIndex={-1} style={{margin:"12px 0 4px",overflowWrap:"anywhere"}}>{page}</h4>
                    <p className="ds-quiet">{isCurrent ? "Current source · Not archived · Read only" : "Historical annotation · Read only"}</p>
                    {recordProblem ? <><p role="alert" className="ds-quiet">This record could not be read. Try again.</p><Btn sm onClick={() => setRecordProblem(false)}>Try again</Btn></> : <>
                      {selectedEntry ? <><p style={{margin:"12px 0 8px",whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{selectedEntry.display.text}</p><p className="ds-quiet">{selectedEntry.display.author} · <time dateTime={selectedEntry.display.created}>{isCurrent ? "11 November 2026, 07:30 UTC" : "10 November 2026, 14:21 UTC"}</time></p><p className="ds-quiet">On {selectedEntry.display.context.doc} · {selectedEntry.display.context.quote}</p></> : <p className="ds-quiet">Original source: comments.json. No readable records were extracted.</p>}
                      <QL.Fold title={selectedEntry ? "Original record" : "Original source"} open={originalOpen} onToggle={() => setOriginalOpen(!originalOpen)}>{originalRecord === null ? <><p className="ds-quiet">This source cannot be displayed as text.</p><a className="btn sm" href="data:application/octet-stream;base64,/wABAgo=" download="comments.json" aria-label="Download original source">Download original source</a></> : <><pre tabIndex={0} aria-label="Original archived record" style={{margin:"12px 0",maxWidth:"100%",maxHeight:240,overflow:"auto",whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontSize:12,lineHeight:1.6}}>{originalRecord}</pre><Btn sm icon="copy" onClick={() => app.copy("artifact-original-record",originalRecord)}>{selectedEntry ? "Copy original record" : "Copy original source"}</Btn></>}</QL.Fold>
                      {selectedEntry ? <><h4 style={{margin:"16px 0 8px"}}>Attachments</h4>{selectedEntry.attachments.map(attachment => <div key={attachment.id} className="row" style={{flexWrap:"wrap",gap:8}}><Icon name="file-text" size={14}/><span style={{overflowWrap:"anywhere",minWidth:0}}>{attachment.name}</span>{attachment.state === "available" ? <a className="btn sm" href="data:text/plain;charset=utf-8,Illustrative%20archived%20attachment.%0A" download={attachment.name} aria-label={"Download " + attachment.name}>Download</a> : <span className="dim">{attachment.state === "missing" ? "File unavailable" : "Attachment unavailable"}</span>}</div>)}</> : null}
                    </>}
                  </> : <button ref={recordRow} type="button" className="lnk" style={{display:"flex",alignItems:"center",gap:8,maxWidth:"100%",textAlign:"left"}} onClick={() => setRecordOpen(true)}><Icon name="file-text" size={14}/><code style={{overflowWrap:"anywhere",minWidth:0}}>{page}</code><span className="dim">Read only</span></button>}
                </section> : null}
                {tab === "activity" ? (
                  <>
                    <section className="ds-rsec" aria-label="Being changed">
                      <h3 className="ds-rh"><span>Being changed</span><span className="ds-rn">{changing.length === 0 ? "no open tasks" : changing.length + (changing.length === 1 ? " task" : " tasks")}</span></h3>
                      {changing.length === 0 ? <p className="ds-quiet">No open task is changing it. A task drafts on it from its Files.</p> : null}
                      {clash.length ? <p className="lb-clash"><Icon name="git-branch" size={13} /><span>{clash.join(", ")}: {changing.length} tasks change the same page. They meet at Review, where the page folded last wins, so compare them there first.</span></p> : null}
                      {changing.map((c) => (
                        <div key={c.id} className="ds-ev lb-ev">
                          <TaskDot state={c.state} /><span className="ds-tt">{c.title}</span><span className="ds-ew">{c.step}</span>
                          <span className="ds-es">Changes <span className="ds-pgs">{c.pages.map((p) => <span key={p} className="ds-pgc">{p}</span>)}</span> · {WAIT_WORD[c.state]}</span>
                          <span className="lb-ev-drafts">{c.drafts.map((dn,index) => {const title=c.pages[index] || QL.data.task.plan.artifacts.find(artifact=>artifact.id===dn)?.title || dn;return <button key={dn} type="button" className="lnk" aria-label={"Open " + title} title={"Open " + title + " draft"} onClick={() => (c.id === "billing" ? QL.openDraft(app, dn, { label: "Back to " + item.title }) : app.openTask(c.id))}>Open {title}</button>;})}{c.drafts.length ? null : <button type="button" className="lnk" onClick={() => app.openTask(c.id)}>Open the task</button>}</span>
                        </div>
                      ))}
                    </section>
                    
                    <section className="ds-rsec" aria-label="Changes">
                      <h3 className="ds-rh"><span>Changes</span><span className="ds-rn">every revision</span></h3>
                      {(item.history || []).length === 0 ? <p className="ds-quiet">Nothing has been committed to it yet.</p> : null}
                      {(item.history || []).map((h) => (
                        <div key={h.sha} className="ds-ev">
                          <i className="ds-rev" aria-hidden="true" /><span className="ds-tt">{h.task ? h.title : h.subject}</span><span className="ds-ew">{h.when}</span>
                          <span className="ds-es">{h.task ? <>{h.subject} · </> : null}<code className="ds-sha">{h.sha}</code></span>
                        </div>
                      ))}
                    </section>
                  </>
                ) : null}
                {tab === "activity" ? <details className="artifact-info" open={infoOpen} onToggle={(event) => setInfoOpen(event.currentTarget.open)}><summary>Details and history</summary>
                  <dl className="ds-facts ds-ifacts" data-testid="artifact-details">
                    {(() => { const h = (item.history || [])[0]; const IRow = ({ icon, term, tip, children }) => <div className="ds-irow" title={tip || term}><Icon name={icon} size={15} className="ds-irow-i" /><dt className="sr-only">{term}</dt><dd>{children}</dd></div>; return <>
                      <IRow icon="clock" term="Updated" tip={"File updated " + (item.updated || "recently") + (h ? ". Latest committed change " + h.when + "." : ".")}><time>{h ? h.when : item.updated || "just now"}</time></IRow>
                      <IRow icon="git-commit-horizontal" term="Latest committed change">{h ? <><code className="ds-sha">{h.sha}</code><span className="ds-dim"> · </span><span className="ds-dim">{h.subject}</span></> : <span className="ds-dim">No committed changes recorded.</span>}</IRow>
                      <IRow icon="file-text" term="What it shows">{item.purpose || "Not written yet."}</IRow>
                      <IRow icon="file" term={pagesWord(item.pages.length)}><span className="ds-pgs">{item.pages.map((pg) => <span key={pg} className="ds-pgc">{pg}</span>)}</span></IRow>
                      <IRow icon="folder" term="Where its files are" tip={item.folder + ": " + (item.source ? "Its pages stay in " + item.source + "; the entry page points at them." : item.where === "mac" ? "Only on this computer; git does not see it." : "In the repository: it goes through pull requests.")}><code>{item.folder}</code></IRow>
  
                    </>; })()}
                    {alsoIn.length ? <div className="ds-irow" title="Also shown in"><Icon name="shapes" size={15} className="ds-irow-i" /><dt className="sr-only">Also in</dt><dd><span className="ds-alsos">{alsoIn.map((p) => <span key={p.id} className="ds-also"><Tile f={p} xs label />{p.label}<button type="button" className="lnk" onClick={() => QL.libActions.stopShowing(app, item, p.id)} aria-label={"Stop showing it in " + p.label}>Stop showing</button></span>)}</span></dd></div> : null}
                    {item.copiedFrom ? <div className="ds-irow" title="A separate artifact; changes to one never reach the other."><Icon name="copy" size={15} className="ds-irow-i" /><dt className="sr-only">Copied from</dt><dd>{copiedFrom ? <button type="button" className="lnk" onClick={() => QL.openLibrary(app, copiedFrom)}>{v.projectTile(copiedFrom.project).label} › {copiedFrom.title}</button> : item.copiedFrom}</dd></div> : null}
                  </dl>
                </details> : null}
              </div>}
              </div>
            </aside>
          ) : null}
        </div>
      </main>
    );
  }

  Object.assign(QL, { Settings, InstructionsSheet, LastingArtifact, PagePick, PageMock, Thumb, taskInfo });
})();

// The approved local Pilot import, with illustrative source data in the lasting App Model.
(function () {
  const QL = window.QL;
  const { Icon, Btn, IconBtn, Select } = QL;
  const baseGroups = [
    { id: "checkout-a", label: "storefront", path: "/work/client-a/storefront", observations: 12, knowledge: 4, learned: 2, duplicates: 3 },
    { id: "checkout-b", label: "storefront", path: "/work/client-b/storefront", observations: 4, knowledge: 2, learned: 1, duplicates: 1 },
    { id: "renamed", label: "old-api", path: "/work/old-api (not found)", observations: 2, knowledge: 2, learned: 0, duplicates: 1 },
    { id: "unmapped", label: "Private knowledge", path: "Original checkout not recorded", observations: 0, knowledge: 3, learned: 0, duplicates: 0 },
  ];
  QL.PilotImportProposal = function ({ app, c, set, close, focusOnMount, dialogKeys }) {
    const step = c.pilotStep || "source";
    const source = c.pilotSource || "folder";
    const privateGroups = source === "database" && !c.pilotAttachedFolder ? baseGroups.map(g => ({ ...g, knowledge: 0 })).filter(g => g.observations || g.learned) : baseGroups;
    const groups = c.pilotProjectFolder ? [...privateGroups, { id: "shared", label: "Project knowledge", path: "/work/shared/.pilot/knowledge", observations: 0, knowledge: 2, learned: 0, duplicates: 0 }] : privateGroups;
    const found = groups.reduce((n, g) => n + g.observations + g.knowledge + g.learned, 0);
    const maps = c.pilotMaps || {};
    const includeLearned = c.pilotLearned !== false;
    const destinations = [{ value: "skip", label: "Leave out" }, { value: "personal", label: "Yours · every project" }, ...QL.projectChoices(app).slice(1).map(p => ({ value: p.value, label: p.label }))];
    const selected = groups.filter(g => maps[g.id] && maps[g.id] !== "skip");
    const total = selected.reduce((n, g) => n + g.observations + g.knowledge + (includeLearned ? g.learned : 0), 0);
    const duplicates = selected.reduce((n, g) => n + g.duplicates, 0);
    const imported = c.pilotRetried ? 0 : total - duplicates;
    const unchanged = c.pilotRetried ? total : duplicates;
    const sourceNames = { folder: "Pilot memory folder", database: "Pilot SQLite database", backup: "Pilot backup", files: "Exported memory files" };
    const sampleRecords = selected.flatMap(g => Array.from({ length: g.observations + g.knowledge + (includeLearned ? g.learned : 0) }, (_, i) => ({ id: "pilot-example-" + g.id + "-" + i, title: "Illustrative Pilot memory " + (i + 1) + " · " + g.label, source: "Imported from Pilot Shell · illustrative data", scope: maps[g.id] === "personal" ? "Yours · every project" : "This computer only", about: maps[g.id] === "personal" ? "you" : undefined, checked: "saved 13 November", text: "Illustrative imported content. No source file was read and no memory was saved.", projectName: destinations.find(d => d.value === maps[g.id])?.label })));
    const setMap = (id, value) => set({ pilotMaps: { ...maps, [id]: value } });
    return <div className="scrim" style={{ paddingTop: 16 }} onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><style>{`
      .ql .pilot-dialog{display:flex;flex-direction:column;max-width:720px;width:min(720px,100%);max-height:calc(100dvh - 144px);overflow:hidden}
      .ql .pilot-dialog>header,.ql .pilot-proposal{flex:none}
      .ql .pilot-dialog>section{min-height:0;overflow-y:auto}
      .ql .pilot-proposal{font-size:12px;color:var(--dim);padding-bottom:10px;border-bottom:1px solid var(--line)}
      .ql .pilot-sources{border:0;margin:14px 0;padding:0;min-width:0}
      .ql .pilot-sources legend{font-size:13px;font-weight:600;margin-bottom:6px}
      .ql .pilot-source{display:flex;gap:10px;align-items:flex-start;padding:10px 0;cursor:pointer}
      .ql .pilot-source>span{display:flex;flex-direction:column;gap:3px;min-width:0}
      .ql .pilot-source input,.ql .pilot-check input{accent-color:var(--accent)}
      .ql .pilot-source input{margin-top:4px}
      .ql .pilot-project{display:flex;align-items:center;gap:16px;justify-content:space-between;border-top:1px solid var(--line);padding:12px 0}
      .ql .pilot-project>div:first-child{display:flex;flex-direction:column;gap:4px;min-width:0}
      .ql .pilot-project code{font-size:12px;overflow-wrap:anywhere}
      .ql .pilot-project .dim{font-size:12px}
      .ql .pilot-check{display:flex;gap:8px;align-items:center;margin:14px 0;cursor:pointer}
      .ql .pilot-actions{position:sticky;bottom:0;z-index:2;margin-top:20px;padding:12px 0 0;background:var(--bg);border-top:1px solid var(--line);gap:8px;flex-wrap:wrap}
      .ql .pilot-dialog :focus-visible{outline:2px solid var(--accent);outline-offset:3px}
      @media(max-width:600px){.ql .pilot-project{align-items:flex-start;flex-direction:column;gap:10px}.ql .pilot-dialog .st-r{flex-wrap:wrap;gap:8px}}
    `}</style><section className="dialog agent-dialog ml-dialog pilot-dialog" tabIndex={-1} ref={focusOnMount} role="dialog" aria-modal="true" aria-label="Import from Pilot Shell" onKeyDown={dialogKeys(close)}>
      <header className="row"><h2>Import from Pilot Shell</h2><span className="sp" /><IconBtn icon="x" label="Close" onClick={close} /></header>
      <p className="pilot-proposal">Design proposal · illustrative data. This preview reads no files and imports nothing.</p>
      {step === "source" ? <section id="pilot-source" data-screen-label="Choose memory source">
        <p>Bring your saved knowledge into QualityLayer. Choose what to import before anything is saved.</p>
        <fieldset className="pilot-sources"><legend>Memory source</legend>{[
          ["folder", "Pilot memory folder", "Read the local database and private knowledge together."],
          ["database", "Pilot SQLite database", "Choose a .db file; add private knowledge separately."],
          ["backup", "Pilot backup", "Use a .backup.json or .backup.gz archive."],
          ["files", "Exported memory files", "Use existing Markdown or JSONL exports."],
        ].map(([value, label, hint]) => <label className="pilot-source" key={value}><input type="radio" name="pilot-source" value={value} checked={source === value} onChange={() => set({ pilotSource: value, pilotPicked: false, pilotError: null })} /><span><b>{label}</b><span className="dim">{hint}</span></span></label>)}</fieldset>
        <div className="st-r"><div className="st-l"><b>{sourceNames[source]}</b><span>{c.pilotPicked ? source === "folder" ? "~/.pilot/memory" : source === "database" ? "pilot-memory.db" : source === "backup" ? "pilot-memory-example.backup.gz" : "memories.jsonl · architecture.md" : "Choose a location on this computer."}</span></div><Btn onClick={() => set({ pilotPicked: true, pilotError: null })}>{c.pilotPicked ? "Change" : source === "folder" ? "Choose folder" : source === "database" ? "Choose database" : "Choose files"}</Btn></div>
        <p className="dim">The import stays on this computer. Pilot Shell files stay as they are.</p>
        <details className="st-more"><summary><Icon name="chevron-right" size={14} />What is included</summary><p>Saved observations, knowledge documents and selected session learnings. Project knowledge can be added from checkout folders you choose. Prompts, transcripts, pending tool activity, credentials and settings are left out.</p><Btn onClick={() => set({ pilotError: "unreadable", pilotPicked: false })}>Preview unreadable source</Btn></details>
        {c.pilotError ? <p role="alert">Could not read this source. Choose another location or try again.</p> : null}
        <div className="row pilot-actions"><Btn onClick={close}>Cancel</Btn><span className="sp" /><Btn pri disabled={!c.pilotPicked} onClick={() => set({ pilotStep: "mapping", pilotRetried: false })}>Scan memories</Btn></div>
      </section> : step === "mapping" ? <section id="pilot-mapping" data-screen-label="Review memory destinations">
        <p>{found} memories found. Choose where each group belongs.</p>
        <p className="dim">Pilot’s private knowledge stays with its original project unless you choose Yours.</p>
        {source === "database" ? <div className="st-r"><div className="st-l"><b>Private knowledge documents</b><span>{c.pilotAttachedFolder ? "11 sample documents added from the selected memory folder." : "A database does not contain these files. Choose their memory folder to include them."}</span></div><Btn onClick={() => set({ pilotAttachedFolder: !c.pilotAttachedFolder })}>{c.pilotAttachedFolder ? "Remove memory folder" : "Add memory folder"}</Btn></div> : null}
        {groups.map(g => <div className="pilot-project" key={g.id}><div><b>{g.label}</b><code>{g.path}</code><span className="dim">{g.observations + g.knowledge + g.learned} memories · {g.observations} observations · {g.knowledge} knowledge · {g.learned} session learnings</span><details className="st-more"><summary><Icon name="chevron-right" size={14} />Review records</summary><ul>{Array.from({ length: g.observations + g.knowledge + g.learned }, (_, i) => <li key={i}>Illustrative {i < g.observations ? "observation" : i < g.observations + g.knowledge ? "knowledge document" : "session learning"} {i + 1} · {g.path}</li>)}</ul></details></div><Select label={"Destination for " + g.path} value={maps[g.id] || "skip"} options={destinations} onChange={value => setMap(g.id, value)} /></div>)}
        <div className="st-r"><div className="st-l"><b>Project knowledge</b><span>Add .pilot/knowledge and legacy exports from a checkout you choose.</span></div><Btn onClick={() => set({ pilotProjectFolder: !c.pilotProjectFolder })}>{c.pilotProjectFolder ? "Remove folder" : "Add folder"}</Btn></div>
        {c.pilotProjectFolder ? <p className="dim" role="status">2 project knowledge documents added from the sample checkout. Choose their destination above.</p> : null}
        <label className="pilot-check"><input type="checkbox" checked={includeLearned} onChange={e => set({ pilotLearned: e.target.checked })} />Include 3 saved session learnings</label>
        <details className="st-more"><summary><Icon name="chevron-right" size={14} />Review records and exclusions</summary><p>Sample record: “Keep invoice changes in one transaction” · observation · storefront. Original source and date are retained. Imported records are private and are not marked verified.</p><p>2 unreadable records are left out. Open the corresponding source document or choose a corrected source. Prompts and session history are not imported.</p><p>Same project names do not establish a match. Missing checkout folders can map to an existing project or Yours. Leave out keeps the original source untouched.</p></details>
        <p role="status"><b>{total - duplicates} to import</b> · {duplicates} already imported · {found - total} not selected · 2 unreadable</p>
        <div className="row pilot-actions"><Btn onClick={() => set({ pilotStep: "source" })}>Back</Btn><span className="sp" /><Btn pri disabled={!selected.length} onClick={() => set({ pilotStep: "receipt", pilotRetried: false })}>Import {total - duplicates} memories</Btn></div>
      </section> : <section id="pilot-receipt" data-screen-label="Memory import receipt">
        <h3>{c.pilotRetried ? "No new memories to import" : "Memories imported"}</h3><p role="status"><b>{imported} imported</b> · {unchanged} already imported · {found - total + 2} left out</p>
        {selected.map(g => <div className="st-r" key={g.id}><div className="st-l"><b>{g.label}</b><span>{destinations.find(d => d.value === maps[g.id])?.label} · {g.observations + g.knowledge + (includeLearned ? g.learned : 0)} memories</span></div></div>)}
        <p>Imported lessons are private. Your Pilot Shell files are unchanged.</p>
        <details className="st-more"><summary><Icon name="chevron-right" size={14} />Import details</summary><p>2 unreadable records were left out. No existing QualityLayer lesson was overwritten. Session prompts, transcripts, pending activity and settings were not imported.</p><p>Read-only source snapshot · {sourceNames[source]}. This receipt shows sample data only.</p></details>
        <div className="row pilot-actions"><Btn onClick={() => set({ pilotRetried: true })}>Import same source again</Btn><span className="sp" /><Btn pri onClick={() => set({ memorySource: "pilot", pilotImportedRecords: sampleRecords, memoryPage: 0, memoryImportOpen: false })}>View imported memories</Btn></div>
      </section>}
    </section></div>;
  };
})();
