// The task page: one amber card when something waits, the agent's turn when nothing does,
// the step's document, the build, the checks, the change, the reader and the artifact viewer.
(function () {
  const QL = (window.QL = window.QL || {});
  const { useState, useEffect, useRef } = React;
  const { Icon, Mark, Btn, IconBtn, fmt, Pips, Fold, CheckLine, Cmd, Seg, STEP_LABEL, STEPS } = QL;
  const D = () => QL.data.task;
  // Done means points still asked for (one was withdrawn while building), and the one only the person can confirm.
  const points = () => D().doneMeans.filter((p) => p.state !== "withdrawn");
  const POINTS = () => points().length;
  const YOURS = 7;
  // Illustrative long-branch review; the ordinary model retains its existing two-file example.
  const reviewForeign = () => new URLSearchParams(window.QL_PREVIEW_QUERY ?? location.search).get("reviewScope") === "large"
    ? { files: Array.from({ length: 574 }, (_, i) => `qualitylayer/${["src/core", "src/ui", "tests/core", "tests/ui"][i % 4]}/parallel-session/retained-file-${String(i + 1).padStart(3, "0")}.ts`), commits: Array.from({ length: 48 }, (_, i) => (0x9a00000 + i).toString(16)) }
    : { files: QL.data.pr.otherSession, commits: QL.data.pr.otherCommits || [] };
  // Files git shows as changed that no commit holds and no task made: already there before the build, or changed since. The push carries commits only, so these are not in it.
  const reviewUncommitted = () => QL.data.pr.otherUncommitted || { before: [], during: [] };

  /* ── building blocks ── */
  function YourTurn({ app, k, title, p, children, foot, keys, count, of, id, status, under, titleCls }) {
    return (
      <section className={"yt" + (app.s.flash ? " flash" : "")} id={id || "your-turn"} aria-label="Your turn" ref={app.turnRef}>
        <div className="yt-tag"><Mark state="you" />Your turn{k ? <span className="k">· {k}</span> : null}<span className="sp" />{of ? <span className="k" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Pips n={of} on={count} />{count} of {of}</span> : null}</div>
        {status}
        {title ? <h2 className={"yt-h" + (titleCls ? " " + titleCls : "")}>{title}</h2> : null}
        {under}
        {p ? <p className="yt-p">{p}</p> : null}
        {children ? <div className="yt-body">{children}</div> : null}
        {foot || keys ? (
          <div className="yt-ft">
            {keys ? <span className="keys">{keys.map(([k, l], i) => <span key={i}>{k.split(" ").map((x, j) => <kbd key={j}>{x}</kbd>)} {l}</span>)}</span> : null}
            <span className="sp" />
            {foot}
          </div>
        ) : null}
      </section>
    );
  }

  /** A choice list outside a question card (the existing-plan intake): the same rows, each the answer itself. */
  function Choices({ options, rec, picked, onPick, hints }) {
    return (
      <div className="qx-list" role="group" aria-label="Choices">
        {options.map((o, i) => (
          <button key={i} type="button" className={"qx-row qx-pick" + (rec === i && picked == null ? " rec" : "") + (picked === i ? " picked" : "")} onClick={() => onPick(i)} aria-pressed={picked === i}>
            <span className="qx-key">{i + 1}</span>
            <span className="qx-copy">{rec === i ? <span className="qx-rec">Recommended</span> : null}<span className="qx-lb">{o}</span>{hints && hints[i] ? <span className="qx-gist">{hints[i]}</span> : null}</span>
          </button>
        ))}
      </div>
    );
  }

  /** What a refused send says: the words and files stay, and the button reads Try again. */
  const SEND_FAILED = "Couldn't send. Your answer and files are kept.";
  function AnswerComposer({ app, id, placeholder, agent, label }) {
    const st = app.s.sent[id];
    const [text, setText] = useState(window.QL_ATTACHMENT_FAILURE_PREVIEW ? "The request failed again. These files show what happened." : "");
    const [files, setFiles] = useState(() => window.QL_ATTACHMENT_PREVIEW ? [
      { name: "server-error.log", size: 18432, type: "text/plain" },
      { name: "expected-behaviour.pdf", size: 248832, type: "application/pdf" }
    ] : []);
    const [previews, setPreviews] = useState(new Map());
    useEffect(() => {
      const urls = new Map(files.filter(file => file instanceof File && file.type.startsWith("image/")).map(file => [file, URL.createObjectURL(file)]));
      setPreviews(urls);
      return () => urls.forEach(url => URL.revokeObjectURL(url));
    }, [files]);
    const [problem, setProblem] = useState(window.QL_ATTACHMENT_FAILURE_PREVIEW ? SEND_FAILED : "");
    const [dragging, setDragging] = useState(false);
    const field = useRef(null);
    useEffect(() => { app.wordsRef.current = field.current; if (window.QL_ATTACHMENT_PREVIEW) field.current?.focus(); return () => { app.wordsRef.current = null; }; }, []);
    const add = picked => {
      const next = [...files, ...Array.from(picked || [])];
      const error = next.length > 6 ? "Attach at most 6 files." : next.find(file => file.size > 10 * 1024 * 1024) ? "Each file must be 10 MB or smaller." : "";
      setProblem(error);
      if (!error) setFiles(next);
    };
    const send = () => {
      if (!text.trim() && !files.length) return;
      app.send(id, text.trim() || "Attached " + files.length + (files.length === 1 ? " file" : " files"));
    };
    // As the App's Attachments: a picture as a small thumbnail with its name and size, any other file as one compact pill
    // (icon, name, its size or "PDF", and a remove button while the answer is still being written).
    const sizeOf = (file) => file.size < 1024 * 1024 ? Math.max(1, Math.round(file.size / 1024)) + " KB" : (file.size / 1024 / 1024).toFixed(1) + " MB";
    const fileList = removable => files.length ? <ul className="qa-files" aria-label="Attached files">{files.map((file, index) => {
      const remove = removable ? <button type="button" className="qa-x" aria-label={"Remove " + file.name} onClick={() => setFiles(files.filter((_, at) => at !== index))}><Icon name="x" size={12}/></button> : null;
      if (file.type.startsWith("image/") && previews.has(file)) return <li key={file.name + index} className="qa-file qa-image"><img src={previews.get(file)} alt={file.name}/><span className="qa-img-cap"><span>{file.name}</span><span>{sizeOf(file)}</span></span>{remove}</li>;
      return <li key={file.name + index} className="qa-file"><Icon name="file-text" size={14}/><span className="qa-file-n" title={file.name + " · " + sizeOf(file)}>{file.name}</span><span className="k">{file.type === "application/pdf" ? "PDF" : sizeOf(file)}</span>{remove}</li>;
    })}</ul> : null;
    if (st) return <div className="qa-receipt"><div className={"sent" + (st.state === "failed" ? " bad" : "")} role="status">
      <Icon name={st.state === "failed" ? "circle-alert" : st.state === "picked" ? "check-check" : "check"} size={14}/>
      <span>{st.state === "failed" ? "Not sent. Your answer and files are kept." : <><b>Sent:</b> {st.text}</>}</span>
      <span className="sp"/>{st.state === "failed" ? <Btn sm onClick={send}>Try again</Btn> : <button type="button" className="lnk" onClick={() => app.unsend(id)}>Edit</button>}
    </div>{fileList(false)}</div>;
    return <div id={window.QL_ATTACHMENT_PREVIEW ? "answer-files" : undefined} className={"qa-composer" + (dragging ? " dragging" : "")} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); add(event.dataTransfer.files); }}>
      <textarea ref={field} rows={2} value={text} placeholder={placeholder || "Or write your own answer…"} aria-label={label || "Your own answer"} onChange={event => setText(event.target.value)} onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); add(event.clipboardData.files); } }} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }}/>
      {fileList(true)}
      {problem ? <p className="qa-error" role="alert"><Icon name="circle-alert" size={14}/><span>{problem}</span>{problem === SEND_FAILED ? <button type="button" className="lnk qa-report" onClick={() => app.toast("Report this · simulated")}>Report this</button> : null}</p> : null}
      <div className="qa-actions"><label className="btn qa-attach"><Icon name="paperclip" size={14}/>Attach files<input type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.txt,.log,.json,.md,.csv,.yaml,.yml" aria-label="Attach files to your answer" onChange={event => { add(event.target.files); event.target.value = ""; }}/></label><span className="qa-hint">Paste or drop images, PDFs or logs</span><span className="sp"/><Btn sm pri={!!text.trim() || !!files.length} disabled={!text.trim() && !files.length} onClick={send}>{problem === SEND_FAILED ? "Try again" : "Send"}{text.trim() || files.length ? <kbd>↵</kbd> : null}</Btn></div>
    </div>;
  }

  function OwnWords(props) { return <AnswerComposer {...props}/>; }

  /** An artifact inside the card that asks about it: the real page, scaled, with its name and Full size. */
  // As ArtifactPreview.tsx (Plan decision d14, kept by Max on 5 November 2026): a preview stays compact. A short
  // page shows whole; a taller page shows its top within the 320 px cap and never scrolls inside at rest.
  // Enlarge (the picture) or Open full size shows the rest.
  function ArtifactFrame({ app, srcDoc, title, pins, cap = 320, at }) {
    const ref = useRef(null);
    const [full, setFull] = useState(0);
    useEffect(() => {
      const f = ref.current; if (!f) return;
      const apply = () => { try {
        const doc = f.contentDocument;
        doc.documentElement.dataset.theme = app.s.theme;
        f.style.height = "10px";
        const h = doc.documentElement.scrollHeight;
        f.style.height = h + "px";
        // A reference with a section (#alert) shows the picture from that section on.
        const part = at ? doc.getElementById(at) : null;
        const top = part ? Math.max(0, part.getBoundingClientRect().top + doc.documentElement.scrollTop - 24) : 0;
        f.style.marginTop = -Math.round(top / 2) + "px";
        setFull(Math.ceil((h - top) / 2));
      } catch (e) {} };
      f.addEventListener("load", apply); apply();
      return () => f.removeEventListener("load", apply);
    }, [app.s.theme, srcDoc, at]);
    const cut = full > cap + 1;
    return (
      <div className="dz-view" data-cut={cut ? "true" : undefined}>
        <div className="dz-frame" style={full ? { height: Math.min(cap, full), overflow: "hidden" } : undefined}>
          <iframe ref={ref} title={title} srcDoc={srcDoc} tabIndex={-1} data-feedback="off" />
          {pins ? <div className="pins">{pins.map((p, i) => <span key={i} className="pin" style={{ left: p[0] + "%", top: p[1] + "%" }}>{i + 1}</span>)}</div> : null}
        </div>
      </div>
    );
  }
  /* As ArtifactPreview.tsx and PreviewControls.tsx: the bar (window mark, the name, its age and comments, one icon button for full size), then the picture; no footer. */
  function ArtifactInCard({ app, id, section, pins }) {
    const d = D().plan.artifacts.find((x) => x.id === id);
    return (
      <div className="dz pv" data-testid="artifact-preview" data-file={"artifacts/" + d.id + ".html"}>
        <div className="pv-bar">
          <Icon name="app-window" size={14} />
          <div className="pv-heading"><b title={d.title}>{d.title}</b><span className="pv-meta"><span className="pv-ago" title={"Updated " + fmt.ago(Date.now() - d.at)}><Icon name="history" size={13} /><span className="sr">Updated </span>{fmt.ago(Date.now() - d.at)}</span>{d.comments ? " · " + d.comments + (d.comments === 1 ? " comment" : " comments") : ""}</span></div>
          {/* ArtifactPreview.tsx: one labelled Open in card with the focus mark (never the sidebar's panel mark); full size is one step further, inside the card (embed-card.html). In a gallery (the Plan's Interface tabs) this header goes: the tab names the screen and the tab row ends in the age and Open in card. */}
          <div className="pv-actions"><Btn sm icon="focus" onClick={() => app.openArtifact(id)}>Open in card</Btn></div>
        </div>
        <ArtifactFrame app={app} srcDoc={QL.artifactDocuments[id]} title={d.title} pins={pins} />
      </div>
    );
  }

  /**
   * The screen a question, or one of its choices, is about, inside the card (turn/QuestionScreen.tsx, approved by
   * Max on 10 November 2026: "I would follow your recommendations"). One row, as the Plan's Interface keeps for one
   * screen: its name, the age and Open in card; the picture under it, and a click on it opens the card too. The
   * agent names it in the question's or the choice's "artifact"; a choice's screen stands under its facts.
   */
  function QxArts({ app, arts, cap = 320 }) {
    const a = arts[0];
    const open = () => app.toast("Opens " + a.name + " in the card · simulated");
    const ago = fmt.ago(Date.now() - a.at);
    return (
      <div className="qx-arts" data-testid="question-artifacts">
        <div className="gal-head">
          <span className="gal-solo"><Icon name="app-window" size={14} />{a.name}</span>
          <span className="gal-act"><span className="pv-ago" title={"Updated " + ago + " ago"}><Icon name="history" size={13} /><span className="sr">Updated </span>{ago}</span><Btn sm icon="focus" onClick={open}>Open in card</Btn></span>
        </div>
        <QxShot app={app} a={a} cap={cap} onOpen={open} />
      </div>
    );
  }
  /** The compact picture: the page from its top (or from the section the reference names), cut at the cap with a fade; the whole picture is one button. */
  function QxShot({ app, a, cap, onOpen }) {
    return (
      <div className="qx-shot">
        <button type="button" className="qx-shot-b" aria-label={"Open " + a.name + " in card"} title="Open in card" onClick={onOpen}>
          <ArtifactFrame key={a.id + (a.section || "")} app={app} srcDoc={QL.artifactDocuments[a.id]} title={a.name} cap={cap} at={a.section} />
        </button>
      </div>
    );
  }

  /** A diagram is named by its kind, in words with a mark, never by the language it is written in; the tooltip says what the kind shows. */
  const DIAGRAM_KIND = { flow: ["spline", "Flow", "A rule and its outcomes"], sequence: ["arrow-right-left", "Sequence", "Who talks to whom, in order"], state: ["waypoints", "State", "What it can be and what moves it"], architecture: ["blocks", "Architecture", "What exists and how it connects"] };
  function Diagram({ g }) {
    const node = (n, i) => (
      <div key={i} className={"dn" + (n[2] === "code" ? " on" : n[2] === "you" ? " you" : "")}>
        {n[2] === "code" ? <code style={{ fontSize: 12.5 }}>{n[0]}</code> : n[0]}
        {n[1] ? <small>{n[1]}</small> : null}
      </div>
    );
    let body;
    if (g.branch) {
      body = (
        <div className="dgm-row">
          {node(g.nodes[0], 0)}<span className="dl" />{node(g.nodes[1], 1)}<span className="dl" />
          <div className="dgm-col">{g.nodes.slice(2).map(node)}</div>
        </div>
      );
    } else if (g.twoRows) {
      body = (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="dgm-row">{node(g.nodes[0], 0)}<span className="dl" />{node(g.nodes[1], 1)}</div>
          <div className="dgm-row">{node(g.nodes[2], 2)}<span className="dl" />{node(g.nodes[3], 3)}</div>
        </div>
      );
    } else if (g.fan) {
      body = (
        <div className="dgm-row">
          {node(g.nodes[0], 0)}<span className="dl" />{node(g.nodes[1], 1)}<span className="dl" />
          <div className="dgm-col">{g.nodes.slice(2).map(node)}</div>
        </div>
      );
    } else {
      body = <div className="dgm-row">{g.nodes.map((n, i) => <React.Fragment key={i}>{i > 0 ? <span className="dl" /> : null}{node(n, i)}</React.Fragment>)}</div>;
    }
    return (
      <div className="dgm">
        <div className="dgm-h"><span>{g.label}</span><span className="dgm-k" title={DIAGRAM_KIND[g.kind] ? DIAGRAM_KIND[g.kind][2] : undefined}><Icon name={DIAGRAM_KIND[g.kind] ? DIAGRAM_KIND[g.kind][0] : "chart-network"} size={14} />{DIAGRAM_KIND[g.kind] ? DIAGRAM_KIND[g.kind][1] : g.kind}</span></div>
        {body}
      </div>
    );
  }

  /*
   * The question card, drawn as option A of the 6 November 2026 redesign ("A · Compact list"; Max: "Let's do A").
   * No frame: amber marks only the Your turn mark and the current number in the strip. One header line, the title,
   * the reason, one meta line, then ONE column of choice rows at every width. A row without details is the answer
   * itself; a grade 2 or 3 row is a disclosure (its first fact while closed; the recommended row open by default with
   * its facts, the picture under them at the card's width, drawn left to right, and Choose this). The card shows only
   * what helps the person decide: where the agent read it (files, findings, evidence) stays in the agent's file. Every place
   * the App asks (a batch, a single question, a Plan decision, a check in your review, a question asked in the terminal) is
   * made of these parts; the production twins are src/ui/turn/QuestionBatch.tsx and its shared choice list.
   */

  /** A row that is the answer itself (grade 1, a choice without details, a toggle in a multi-select). */
  function QxPick({ i, label, rec, onPick, on, extra }) {
    const multi = on !== undefined;
    return (
      <button type="button" aria-keyshortcuts={String(i + 1)} {...(multi ? { role: "checkbox", "aria-checked": on } : {})} className={"qx-row qx-pick" + (rec ? " rec" : "") + (multi && on ? " on" : "")} onClick={() => onPick(i)}>
        {multi ? <span className="qx-tick" aria-hidden="true">{on ? <Icon name="check" size={12} /> : null}</span> : null}
        <span className="qx-key">{i + 1}</span>
        <span className="qx-copy">{rec ? <span className="qx-rec">Recommended</span> : null}<span className="qx-lb">{label}</span>{extra}</span>
      </button>
    );
  }

  /**
   * What kind of fact a choice's line is, so each leads with the mark for it: timing, what it adds, why it holds.
   * Read from the line's own words (src/ui/steps/research/model.ts), never asked of the agent; the tooltip names the kind.
   */
  const FACT_KIND = { timing: ["clock", "Timing"], adds: ["circle-plus", "What it adds"], why: ["info", "Why it holds"] };
  const factKind = (text) => /^(adds?|added|costs?|extra|needs?|requires?|nothing added|no extra|one more)\b/i.test(text.trim()) ? "adds" : /\b(\d+(\.\d+)?\s*(ms|s|sec|seconds?|min|minutes?|h|hours?|days?|weeks?)\b|within|late|later|hour|hourly|minute|nightly|daily|weekly|real[- ]time|latency|delay|instant|immediately|every)\b/i.test(text) ? "timing" : "why";
  function FactMark({ kind }) {
    const [icon, words] = FACT_KIND[kind];
    return <span className="qx-fk" title={words} role="img" aria-label={words}><Icon name={icon} size={15} /></span>;
  }

  /**
   * A choice's picture as a thumbnail: the flow it leads to, a corner label with the kind's mark and word, and one
   * Enlarge button placed outside role="img" so assistive technology reaches it. Beside the facts when it fits the side
   * column (236 to 300 px) at 80 % or more, so it is drawn whole there, top to bottom; otherwise under them, left to right.
   * The frame grows with the drawing up to about 240 px; a larger drawing is scaled down to fit whole, and Enlarge
   * shows it full size. `wide` is the same thumbnail at the card's full width, for the Plan's Your call (a Mermaid diagram
   * there is not a choice's, so it has no facts beside it).
   */
  function QxDiagram({ g, app, wide }) {
    const [mark, word, tip] = DIAGRAM_KIND[g.kind || "flow"] || DIAGRAM_KIND.flow;
    return (
      <div className={"qx-dgw" + (wide ? " wide" : "")}>
        <figure className="qx-dg" role="img" aria-label={word + ": " + g.nodes.concat(g.fan || []).join(", then ")}>
          <span className="qx-dgk" aria-hidden="true" title={tip}><Icon name={mark} size={13} />{word}</span>
          <div className="qx-flow">
            {g.nodes.map((n, i) => <React.Fragment key={n}>{i ? <span className="qx-arrow" /> : null}<span className="qx-node">{n}</span></React.Fragment>)}
            {g.fan ? <><span className="qx-arrow" /><span className="qx-fan">{g.fan.map((n) => <span key={n} className="qx-node">{n}</span>)}</span></> : null}
          </div>
        </figure>
        <button type="button" className="qx-enl" aria-label="Enlarge the diagram" title="Enlarge" onClick={() => app && app.toast("Enlarged diagram · simulated")}><Icon name="maximize-2" size={14} /></button>
      </div>
    );
  }

  /**
   * The one column of choices. Rows with details fold (grade 2 and 3: the recommended row opens by default, any row opens
   * and closes, several may be open); every other row answers on a click. A choice that ends in an ellipsis needs words
   * (Change…, Not yet…): it moves focus to the field instead of answering. Keys 1 to 9 answer directly.
   */
  function QxChoices({ app, q, grade, onPick, multi, onWords, uid }) {
    const [open, setOpen] = useState(() => [q.rec]);
    const go = (i) => (onWords && /…$/.test(q.choices[i]) ? onWords(i) : onPick(i));
    return (
      <div className="qx-list" role="group" aria-label={multi ? "Choices, pick one or more" : "Choices"}>
        {q.choices.map((c, i) => {
          const rec = multi ? multi.rec.includes(i) : q.rec === i;
          const facts = (q.facts && q.facts[i]) || [];
          const diagram = grade === 3 && q.diagrams ? q.diagrams[i] : null;
          const art = q.arts ? q.arts[i] : null;
          const detailed = grade >= 2 && !multi && (facts.length || diagram || art);
          if (multi) return <QxPick key={c} i={i} label={c} rec={rec} on={multi.on.includes(i)} onPick={onPick} extra={facts.length ? <ul className="qx-facts qx-facts-in">{facts.map((x) => <li key={x}><FactMark kind={factKind(x)} /><span>{x}</span></li>)}</ul> : null} />;
          if (!detailed) return <QxPick key={c} i={i} label={c} rec={rec} onPick={go} />;
          const on = open.includes(i);
          const id = "qx-" + uid + "-" + i;
          return (
            <div key={c} className={"qx-row" + (rec ? " rec" : "") + (on ? " open" : "")}>
              <button type="button" className="qx-rh" aria-expanded={on} aria-controls={id} aria-keyshortcuts={String(i + 1)} onClick={() => setOpen(on ? open.filter((x) => x !== i) : [...open, i])}>
                <span className="qx-key">{i + 1}</span>
                <span className="qx-copy">{rec ? <span className="qx-rec">Recommended</span> : null}<span className="qx-lb">{c}</span>{on || !facts.length ? null : <span className="qx-gist">{facts[0]}</span>}</span>
                <span className="qx-chev"><Icon name="chevron-down" size={16} /></span>
              </button>
              {on ? (
                <div className="qx-body" id={id}>
                  <div className="qx-detail">
                    {facts.length ? <ul className="qx-facts">{facts.map((x) => <li key={x}><FactMark kind={factKind(x)} /><span>{x}</span></li>)}</ul> : null}
                    {diagram ? <QxDiagram g={diagram} app={app} wide /> : null}
                    {art ? <QxArts app={app} arts={[art]} /> : null}
                  </div>
                  <div className="qx-go"><Btn pri={rec} icon="check" onClick={() => go(i)}>Choose this</Btn></div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  function OwnAnswer(props) { return <AnswerComposer {...props}/>; }

  /** The header line: Your turn, what the batch is about (or where a single question sits), the strip at the right. */
  function QxTop({ app, asked, cur, title, mark }) {
    const { s } = app;
    return (
      <div className="qx-top">
        {mark || <span className="qx-yt"><Mark state="you" />Your turn</span>}
        <span className="qx-bt" title={title}>{title}</span>
        <span className="sp" />
        {asked && asked.length > 1 ? (
          <span className="qx-strip" role="group" aria-label="Questions in this batch">
            {asked.map((q, j) => {
              const done = !!s.answers[q.id];
              const here = cur && q.id === cur.id;
              return <button key={q.id} type="button" className={"qx-si" + (done ? " done" : "") + (here ? " on" : "")} aria-current={here ? "step" : undefined} aria-label={"Question " + (j + 1) + (done ? ", answered" : "")} title={q.text + (done ? " · answered: " + s.answers[q.id] : "")} onClick={() => (done ? app.changeAnswer(q.id) : here ? null : app.set({ curQ: q.id }))}>{done ? <Icon name="check" size={12} /> : null}{j + 1}</button>;
            })}
          </span>
        ) : null}
      </div>
    );
  }

  /** The receipt of the answer just given: one line above the next question. */
  // "Question N sent" says the delivery once. A delivery state shows only when it changes, later: "picked up by Claude Code".
  function QxReceipt({ n, text, onChange, pickedUp }) {
    return <p className="qx-rc" role="status"><Icon name="check" size={14} /><span>Question {n} sent</span><b title={text}>{text}</b>{pickedUp ? <span className="dim">{pickedUp}</span> : null}<button type="button" className="lnk" onClick={onChange}>Change</button></p>;
  }

  /** The title, the reason and the meta line: what it settles, and whether the agent waits. */
  function QxHead({ title, why, settles, settlesWord, onSettles, who, off, id }) {
    return (
      <>
        <h2 className="qx-title" id={id} tabIndex={-1}>{title}</h2>
        {why ? <p className="qx-why">{why}</p> : null}
        <div className="qx-meta">
          <span className="qx-settles"><Icon name="list-checks" size={14} /><span>{settlesWord || "Settles"}</span><button type="button" className="lnk" title={settles} onClick={onSettles}>{settles}</button></span>
          {who ? <span className="qx-live"><i className={off ? "off" : ""} aria-hidden="true" />{who}</span> : null}
        </div>
      </>
    );
  }

  /** The step's document while a question waits: one row that opens it in the Reader. */
  function FoldedDoc({ app, file, status, read }) {
    return (
      <div className="qx-doc">
        <Icon name="file-text" size={15} />
        <span className="f">{file}</span>
        <span className="dim">{status}</span>
        <span className="sp" />
        <Btn sm icon="book-open" onClick={() => app.openFile(file)}>{read}</Btn>
      </div>
    );
  }

  /** Tell me more, step 1: a small choice in place under the links. */
  function MorePick({ app, q }) {
    const [text, setText] = useState("");
    const box = useRef(null);
    useEffect(() => { const el = box.current; if (!el) return; if (el.scrollIntoView) el.scrollIntoView({ block: "nearest" }); const b = el.querySelector(".more-btns .btn"); if (b) b.focus({ preventScroll: true }); }, []);
    return (
      <div ref={box} className="more-pick" role="group" aria-label="What would help?" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); app.moreCancel(); } }}>
        <div className="more-h"><b>What would help?</b><span className="sp" /><button type="button" className="lnk" onClick={app.moreCancel}>Cancel <kbd>Esc</kbd></button></div>
        <div className="more-btns">
          <Btn onClick={() => app.moreSend(q.id, "plain")}>I don't get the question</Btn>
          <Btn onClick={() => app.moreSend(q.id, "explain")}>Explain the choices</Btn>
        </div>
        <div className="own">
          <input className="field" value={text} placeholder="Or ask something specific…" aria-label="Ask something specific about this question" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) app.moreSend(q.id, "ask", text.trim()); }} />
          <Btn disabled={!text.trim()} onClick={() => app.moreSend(q.id, "ask", text.trim())}>Send</Btn>
        </div>
      </div>
    );
  }

  /** Tell me more, step 2: the request is seen at the top of the question until the question changes. */
  function MoreStatus({ app, more, agent }) {
    const box = useRef(null);
    // The request is seen where the person is: bring the panel into view when it appears and when it changes.
    useEffect(() => { const el = box.current; if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" }); }, [more.phase]);
    if (more.phase === "updated") {
      return (
        <div ref={box} className="more-st done" role="status">
          <Icon name="check" size={14} />
          <span><b>Updated</b> · {more.kind === "explain" ? "each choice explained below the reason" : more.kind === "ask" ? "answered below the reason" : "rewritten in plainer words"}</span>
          <span className="sp" />
          <button type="button" className="lnk" onClick={() => app.set({ more: null })}>Dismiss</button>
        </div>
      );
    }
    const doing = more.kind === "explain" ? "is adding more context to this question." : more.kind === "ask" ? "is answering your question here." : "is rewriting this question in plainer words.";
    const steps = [["Sent", more.step >= 1], [agent + " picked it up", more.step >= 2], ["Updated", false]];
    const curStep = more.step >= 2 ? 2 : 1;
    return (
      <div ref={box} className={"more-st" + (more.late ? " late" : "")} role="status" aria-live="polite">
        <Mark state={more.late ? "you" : "work"} />
        <div className="more-b">
          {more.late
            ? <div className="more-t"><b>{agent} hasn't picked it up yet.</b> It may be finishing something else; your request is queued.</div>
            : <div className="more-t"><b>{agent} {doing}</b> It updates here in a few seconds.</div>}
          <ol className="more-steps" aria-label="Progress">
            {steps.map(([l, done], i) => (
              <li key={i} className={done ? "done" : i === curStep ? "cur" : ""}>{done ? <Icon name="check" size={12} /> : <i className="dot" aria-hidden="true" />}{l}</li>
            ))}
          </ol>
          {more.progress && !more.late ? <div className="more-p">Latest: {more.progress}</div> : null}
          {more.text ? <div className="more-p">You asked: "{more.text}"</div> : null}
        </div>
        <div className="more-r"><span className="dim">You can still answer</span><button type="button" className="lnk" onClick={app.moreCancel}>Cancel</button></div>
      </div>
    );
  }

  /**
   * The helpers row under the field: Tell me more, Use all recommended (a batch with more than one open), Saved at the right.
   * There is no separate Use recommended button (the recommended row is one click; R and A still work) and no key hints show.
   */
  function QxActs({ app, cur, open, batch, choosing, takeRemaining, extra }) {
    const saved = "Answers are saved as you go. Change them under Decided with you until the Plan is written." + (batch ? " " + batch.ahead + ". More questions appear only if your answers open a new choice." : "");
    return (
      <div id="question-footer">
        <div className="qx-acts">
          <button type="button" className="btn sm" aria-keyshortcuts="M" aria-expanded={choosing} onClick={() => (choosing ? app.moreCancel() : app.moreOpen(cur.id))}><Icon name="message-circle-question-mark" size={14} />Tell me more</button>
          {open && open.length > 1 ? <button type="button" className="btn sm" aria-keyshortcuts="A" title="Each open question takes its recommendation" onClick={takeRemaining}><Icon name="chevrons-right" size={14} />Use all recommended</button> : null}
          {extra}
          <span className="qx-saved" tabIndex={0} title={saved} aria-label={"Saved. " + saved}><Icon name="check" size={14} />Saved</span>
        </div>
        {choosing ? <div className="qx-more"><MorePick app={app} q={cur} /></div> : null}
      </div>
    );
  }

  /**
   * The task's agent runs outside the App, so it asks there. The header says so first: answer in Codex, with Codex's mark,
   * where it waits, and the one action, Answer here instead. The choices are inert dashed rows, a quiet preview of what
   * Codex shows in the terminal, never buttons. Answer here instead turns this into the App's own question card; the waiting
   * session gets the answer through QualityLayer's message path and goes on.
   */
  function AskedOutside({ app, cur, asked, batch, step }) {
    const i = asked.indexOf(cur);
    const agentKey = app.s.externalAgent || (/codex/i.test(app.v.agent.name) ? "codex" : "claude");
    const agentName = QL.agentNameOf(agentKey);
    return (
      <section className="qx qx-outside" id="your-turn" aria-label={"Answer in " + agentName + ": question " + cur.n + ", " + cur.text} ref={app.turnRef} data-screen-label="Asked in your own agent">
        <div className="qx-top">
          <span className="qx-agent"><QL.AgentMark agent={agentKey} size={16} /><b>Answer in {agentName}</b></span>
          <span className="qx-bt"><Icon name={QL.ICON["run.terminal"]} size={13} />Waiting in your own agent</span>
          <span className="sp" />
          <Btn sm icon={QL.ICON["run.app"]} onClick={() => app.set({ askHere: true })}>Answer here instead</Btn>
        </div>
        <h2 className="qx-title">{cur.text}</h2>
        {cur.why ? <p className="qx-why">{cur.why}</p> : null}
        <div className="qx-meta">
          <span className="qx-settles"><Icon name="list-checks" size={14} /><span>Settles</span><span>{cur.settles}</span></span>
          {asked.length > 1 ? <span>Question {i + 1} of {asked.length} · {batch.title}</span> : <span>{batch.title}</span>}
        </div>
        <ol className="qx-inert" aria-label={"Choices " + agentName + " shows outside the App"}>
          {cur.choices.map((c, k) => <li key={c}><span className="qx-key">{k + 1}</span><span className="qx-copy">{cur.rec === k ? <span className="qx-rec">Recommended</span> : null}<span className="qx-lb">{c}</span></span></li>)}
        </ol>
        <p className="qx-why qx-eye"><Icon name="eye" size={13} />{agentName} shows these choices outside the App. Answer there, or here instead.</p>
      </section>
    );
  }
  /** Answering here instead of in the agent's own window: one line on the App's own card, then the answer's receipt. */
  function AnswerHereNote({ app, answered }) {
    const name = QL.agentNameOf(app.s.externalAgent || (/codex/i.test(app.v.agent.name) ? "codex" : "claude"));
    return <p className={"qx-here" + (answered ? " sent" : "")} role="status"><Icon name={answered ? "check" : QL.ICON["run.app"]} size={14} /><span>{answered ? "“" + answered + "” went to " + name + ". It picked the answer up and goes on. The next question is here too." : "Answering here instead of in " + name + ". It gets each answer at once and goes on."}</span>{answered ? null : <button type="button" className="lnk" onClick={() => app.set({ askHere: false })}>Answer in {name}</button>}</p>;
  }

  /**
   * A batch of questions from one step: 3 to 6 at once, so the person answers in one sitting. One question is in focus, the
   * strip shows the whole batch, answers reach the agent as they are given and stay changeable. `done` keeps the card on
   * screen after the last answer (the Plan's questions), as the Answered view with the list and Change.
   */
  function BatchCard({ app, step, done }) {
    const t = D();
    const { s } = app;
    const asked = t.questions.filter((q) => q.step === step);
    const batch = t.batches.find((b) => b.step === step);
    const open = asked.filter((q) => !s.answers[q.id]);
    const cur = open.find((q) => q.id === s.curQ) || open[0];
    const agent = app.v.agent.name;
    const takingAll = useRef(false);
    const openIds = open.map((q) => q.id).join(",");
    const [hint, setHint] = useState("");
    useEffect(() => { takingAll.current = false; }, [openIds]);
    useEffect(() => { setHint(""); }, [cur && cur.id]);
    // The receipt says "sent" once; a moment later the agent picks the answer up, and only that change is added to the line.
    const lastGiven = asked.filter((q) => s.answers[q.id]).pop();
    const lastKey = lastGiven ? lastGiven.id + ":" + s.answers[lastGiven.id] : "";
    const [pickedKey, setPickedKey] = useState("");
    useEffect(() => {
      setPickedKey("");
      if (!lastKey) return undefined;
      const timer = setTimeout(() => setPickedKey(lastKey), 3000);
      return () => clearTimeout(timer);
    }, [lastKey]);
    const takeRemaining = () => {
      if (takingAll.current || open.length < 2) return;
      takingAll.current = true;
      app.answerRest(open.map((q) => q.id));
    };
    useEffect(() => {
      const key = (event) => {
        if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.key.toLowerCase() !== "a") return;
        if (event.target?.closest?.('input, textarea, select, button, a, summary, [contenteditable]:not([contenteditable="false"])') || document.querySelector('[role="dialog"], [role="alertdialog"]') || s.more?.phase === "choose") return;
        if (open.length > 1) { event.preventDefault(); takeRemaining(); }
      };
      window.addEventListener("keydown", key);
      return () => window.removeEventListener("keydown", key);
    }, [openIds, app, s.more?.phase]);
    if (!cur) {
      if (!done || !asked.length) return null;
      const next = step === "research" ? "writing the Plan" : "reading the code for the choices";
      return (
        <section className="qx" id="your-turn" aria-label="Questions answered" ref={app.turnRef}>
          <QxTop app={app} asked={asked} cur={null} title={batch.title} mark={<span className="qx-yt off"><Icon name="check" size={13} />Answered</span>} />
          <div className="qx-done"><Icon name="circle-check" size={18} /><div><h2 className="qx-title" tabIndex={-1}>All {asked.length} answered</h2><p className="qx-why">{agent} is {next} with your answers.</p></div></div>
          <ol className="qx-answers">{asked.map((q, j) => <li key={q.id}><span className="qx-key">{j + 1}</span><span className="a"><span className="dim">{q.text}</span><b>{s.answers[q.id]}</b></span><button type="button" className="lnk" onClick={() => app.changeAnswer(q.id)}>Change</button></li>)}</ol>
        </section>
      );
    }
    const here = s.taskWhere === "terminal" && s.askHere;
    if (s.taskWhere === "terminal" && !s.askHere) return <AskedOutside app={app} cur={cur} asked={asked} batch={batch} step={step} />;
    // The answer just given, newest last in the answers (a Change deletes and re-adds it).
    const last = asked.filter((q) => s.answers[q.id]).pop();
    // Tell me more and multi-select: the same question, asked again in plainer words, or with toggles.
    const more = s.more && s.more.q === cur.id ? s.more : null;
    const plain = s.reworded[cur.id] && cur.plain;
    const multi = s.multiOn === cur.id && cur.multi;
    const shown = plain ? Object.assign({}, cur, cur.plain) : multi ? Object.assign({}, cur, { text: multi.text, why: cur.why, choices: multi.choices, facts: multi.facts }) : cur;
    const grade = cur.grade || 1;
    const pick = (k) => { app.answerQuestion(cur.id, shown.choices[k]); if (here) app.set({ answeredHere: shown.choices[k] }); };
    const on = multi ? s.multiPick[cur.id] || [] : null;
    const looking = more && more.phase !== "choose" && more.phase !== "updated";
    const stopped = app.v.agent.state === "stopped";
    const who = looking ? agent + " is looking into it" : stopped ? agent + " stopped waiting" : agent + " waits";
    const choosing = !!(more && more.phase === "choose");
    // Where the answer lands: what the question settles, opened in the Plan.
    const goSettles = () => app.openFile(t.files.docs.discuss[0]);
    return (
      <section className={"qx" + (s.flash ? " flash" : "")} id="your-turn" aria-label={"Question " + cur.n + ": " + shown.text} ref={app.turnRef}>
        {last ? <QxReceipt n={asked.indexOf(last) + 1} text={s.answers[last.id]} onChange={() => app.changeAnswer(last.id)} pickedUp={pickedKey === lastKey ? "picked up by " + agent : null} /> : null}
        <QxTop app={app} asked={asked} cur={cur} title={batch.title} />
        {here ? <AnswerHereNote app={app} answered={s.answeredHere || null} /> : null}
        <QxHead id={"qt-" + cur.id} title={plain && more && more.fresh ? <span className="changed">{shown.text}</span> : shown.text} why={shown.why} settles={cur.settles} onSettles={goSettles} who={who} off={stopped} />
        {plain ? (
          <details className="earlier">
            <summary>Earlier wording</summary>
            <div className="earlier-b"><p>{cur.text}</p><ol>{cur.choices.map((c) => <li key={c}>{c}</li>)}</ol></div>
          </details>
        ) : null}
        {more && more.phase !== "choose" ? <MoreStatus app={app} more={more} agent={agent} /> : null}
        {cur.art || cur.artifact ? <QxArts app={app} arts={[cur.art || { id: cur.artifact, name: (D().plan.artifacts.find((x) => x.id === cur.artifact) || {}).title || cur.artifact, at: Date.now() - 3 * 60000 }]} /> : null}
        {s.explained[cur.id] && cur.explain ? <div className="explain"><b>What each choice means</b><ol>{cur.explain.map((x) => <li key={x}>{x}</li>)}</ol></div> : null}
        <QxChoices key={"choices-" + cur.id + (multi ? "-multi" : "")} app={app} q={shown} grade={grade} uid={cur.id} onPick={multi ? (k) => app.multiToggle(cur.id, k) : pick} multi={multi ? { on, rec: multi.rec } : null} />
        {multi ? (
          <div className="multi-ft">
            <span className="dim">Pick one or more{on.length ? " · " + on.length + " of " + multi.choices.length + " on" : ""}</span>
            <Btn sm pri disabled={!on.length} onClick={() => app.multiSend(cur.id)}>{on.length ? "Send " + fmt.plural(on.length, "choice") : "Pick at least one"}</Btn>
          </div>
        ) : null}
        <OwnAnswer key={"own-" + cur.id} app={app} id={cur.id} agent={agent} placeholder={hint || undefined} />
        <QxActs app={app} cur={cur} open={open} batch={batch} choosing={choosing} takeRemaining={takeRemaining} />
      </section>
    );
  }

  function Blk({ app, id, children, n }) {
    const own = React.useRef(null);
    const [tapped, setTapped] = React.useState(false);
    React.useEffect(() => {
      const pick = (event) => setTapped(own.current?.contains(event.target) === true);
      document.addEventListener("click", pick);
      return () => document.removeEventListener("click", pick);
    }, []);
    return (
      <div ref={own} className={"blk" + (app.s.target === id ? " target" : "") + (tapped ? " tapped" : "")} id={id}>
        <button type="button" className={"cm" + (n ? " has" : "")} aria-label="Ask agent about this passage" onClick={(event) => { const box = own.current?.getBoundingClientRect(); if (QL.askInlineOpen && box) { let heading = "Summary"; for (const h of document.querySelectorAll(".rdr h2")) if (h.compareDocumentPosition(own.current) & Node.DOCUMENT_POSITION_FOLLOWING || h.contains(own.current)) heading = h.textContent.trim(); QL.askInlineOpen({ kind: "plan", page: "03-plan.md", place: "Plan › " + heading, section: id, quote: own.current.textContent.trim().slice(0, 600), point: { x: box.left, y: box.bottom + 6 }, rects: [] }); } else app.quoteBlock(id); }}>{n ? n : <Icon name="plus" size={14} />}</button>
        {children}
      </div>
    );
  }

  /** A small Markdown renderer for the working sections: paragraphs, lists, tables, fenced code, headings, quotes. */
  function Inline({ text }) {
    return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => (p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith("`") ? <code key={i}>{p.slice(1, -1)}</code> : p));
  }
  function Md({ text }) {
    const lines = text.split("\n");
    const out = [];
    let i = 0, k = 0;
    const key = () => "m" + k++;
    const block = /^(```|#{3,4} |\||- |\d+\. |> )/;
    while (i < lines.length) {
      const l = lines[i];
      if (l.startsWith("```")) {
        const lang = l.slice(3).trim(); const body = []; i++;
        while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
        i++;
        // A diagram fence names the finding whose view it draws: ```diagram f1```.
        if (lang.startsWith("diagram")) { const f = D().research.findings.find((x) => x.id === lang.split(" ")[1]); if (f && f.diagram) out.push(<Diagram key={key()} g={f.diagram} />); continue; }
        out.push(<pre key={key()} className={lang}>{body.map((b, j) => <span key={j} className={lang === "diff" ? (b.startsWith("+") ? "add" : b.startsWith("-") ? "del" : "ctx") : undefined}>{b + "\n"}</span>)}</pre>);
        continue;
      }
      if (l.startsWith("#### ")) { out.push(<h4 key={key()}>{l.slice(5)}</h4>); i++; continue; }
      if (l.startsWith("### ")) { out.push(<h3 key={key()}>{l.slice(4)}</h3>); i++; continue; }
      if (l.startsWith("|")) {
        const rows = []; while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
        const cells = (r) => r.slice(1, -1).split("|").map((c) => c.trim());
        const [head, ...rest] = rows; const body = rest.filter((r) => !/^\|\s*-/.test(r));
        out.push(<table key={key()}><thead><tr>{cells(head).map((c, j) => <th key={j}><Inline text={c} /></th>)}</tr></thead><tbody>{body.map((r, j) => <tr key={j}>{cells(r).map((c, x) => <td key={x}><Inline text={c} /></td>)}</tr>)}</tbody></table>);
        continue;
      }
      if (/^- /.test(l)) { const items = []; while (i < lines.length && /^- /.test(lines[i])) items.push(lines[i++].slice(2)); out.push(<ul key={key()}>{items.map((x, j) => <li key={j}><Inline text={x} /></li>)}</ul>); continue; }
      if (/^\d+\. /.test(l)) { const items = []; while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\d+\. /, "")); out.push(<ol key={key()}>{items.map((x, j) => <li key={j}><Inline text={x} /></li>)}</ol>); continue; }
      if (l.startsWith("> ")) { out.push(<blockquote key={key()}><Inline text={l.slice(2)} /></blockquote>); i++; continue; }
      if (l.trim() === "") { i++; continue; }
      const para = []; while (i < lines.length && lines[i].trim() !== "" && !block.test(lines[i])) para.push(lines[i++]);
      out.push(<p key={key()}><Inline text={para.join(" ")} /></p>);
    }
    return <div className="md">{out}</div>;
  }

  /** The working sections of a step's document, rendered whole in the Reader, after the lead sections. */
  function DetailSections({ app, step }) {
    // A working section the document draws in its own place (Implement's program design and code shape) is skipped here.
    const list = (D().files.details[step] || []).filter((d) => !d.inDoc);
    return list.map((d) => (
      <React.Fragment key={d.id}>
        <Blk app={app} id={"det-" + step + "-" + d.id}><h2 className="det-h">{d.title}</h2></Blk>
        <Md text={d.md} />
      </React.Fragment>
    ));
  }

  /** The step page ends with the working sections it does not show: each a link into the Reader at that section. */
  // `skip` leaves out sections the step page already draws; `extra` adds one link after the chips (Verify's pull request).
  function MoreIn({ app, step, skip, extra }) {
    const list = (D().files.details[step] || []).filter((d) => !d.lead && !(skip || []).includes(d.id));
    const [name] = D().files.docs[step];
    if (!list.length) return null;
    // As the App's strip (MoreInDocument.tsx): one plain line, each working section a link into the Reader at its heading.
    return (
      <p className="morein morein-doc" aria-label={"More in " + name} data-testid="more-in-document">
        More in this document:{" "}
        {list.map((d, i) => <span key={d.id}>{i > 0 ? ", " : ""}<button type="button" className="lnk" onClick={() => app.openSection(step, d.id)}>{d.title}</button></span>)}
        {extra ? <> · {extra}</> : null}
      </p>
    );
  }

  /*
   * The Reader's documents for the Plan's questions, its reading and the task cards: the whole Markdown file in file order. The step
   * pages (the Workflow model) draw the same files; the Reader is one click away from every page.
   */
  const boldLead = (x) => { const m = x.match(/^(.+?): (.+)$/); return m ? "**" + m[1] + ":** " + m[2] : x; };
  function docMarkdown(app, step) {
    const t = D();
    const { s } = app;
    const answered = (st) => t.questions.filter((q) => q.step === st && (s.answers[q.id] || STEPS.indexOf(app.v.stage) > STEPS.indexOf(st) || app.v.stage === "shipped"));
    const decided = (st) => answered(st).map((q) => "- **" + q.text + "** " + (s.answers[q.id] || q.answer));
    if (step === "discuss") {
      return md([
        "## Problem", "> " + t.request, "", ...t.problem.flatMap((p) => [p, ""]),
        "## Done means", ...t.doneMeans.map((p) => p.n + ". **" + p.text + ".** " + (p.state === "withdrawn" ? "Withdrawn. " : "") + p.detail), "",
        ...(answered("discuss").length ? ["## Decided with you", ...decided("discuss"), ""] : []),
        "## Scope", "### In this task", ...t.scope.in.map((x) => "- " + x), "", "### Not in this task", ...t.scope.out.map((x) => "- " + x), "",
        ...(t.amendments.length ? ["## Added while building", ...t.amendments.map((a) => "- **" + a[0] + ".** " + a[1]), ""] : []),
      ]);
    }
    if (step === "outline") {
      const o = t.outline;
      const det = (id) => ((t.files.details.outline || []).find((d) => d.id === id) || { md: "" }).md;
      const past = STEPS.indexOf(app.v.stage) > STEPS.indexOf("outline") || app.v.stage === "shipped";
      const slices = t.slices.filter((sl) => sl.n <= o.sliceCount);
      const risky = Object.keys(o.risky).map(Number);
      return md([
        "## Summary",
        "The build runs in " + o.sliceCount + " slices and " + o.taskCount + " tasks, in " + o.waves.length + " waves of slices that share no file. Each task is written test first. Slices " + risky.join(" and ") + " are risky: their scenarios come first in the independent review. Every Done means point has one scenario.", "",
        "**The oracle:** " + o.oracle, "",
        "## How the build runs",
        "| Wave | Slices | How it runs |", "|---|---|---|",
        ...o.waves.map((w) => "| " + w.n + " | " + w.slices.join(", ") + " | " + w.note + " |"), "",
        "The build session builds the slices in this order and hands slices that share no file to subagents only if it judges that pays. **Risky:** " + risky.map((n) => "slice " + n + " (" + o.risky[n] + ")").join("; ") + ".", "",
        ...(past && o.added.length ? ["**Added while building:** slices " + o.added.join(", ") + ", each recorded as a change to the Plan you see in Verify.", ""] : []),
        "## Program design", det("program"), "",
        "## Shape of the code", det("shape"), "",
        ...slices.flatMap((sl) => {
          const sc = o.scenarios.filter((x) => x[2] === sl.n);
          return [
            "## Slice " + sl.n + ": " + sl.title, sl.words, "",
            "#### Tasks", ...sl.tasks.map((x) => { const m = x.match(/^(T\d+) (.+)$/); return m ? "- `" + m[1] + "` " + m[2] : "- " + x; }), "",
            ...(o.risky[sl.n] ? ["**Risky:** " + o.risky[sl.n] + ", so this slice's scenarios come first in the independent review.", ""] : []),
            ...(sc.length ? ["#### Scenarios", ...sc.map((x) => "- **Done means " + x[0] + ":** " + x[1]), ""] : []),
          ];
        }),
        "## Decided while outlining", ...o.decisions.map((x) => "- " + boldLead(x)), "",
      ]);
    }
    const r = t.research;
    return md([
      "## Summary", r.summary, "",
      "## The questions", ...r.questions.map((q) => q.n + ". " + q.text + " · helper " + q.helper), "",
      "## What the code does today", ...r.findings.flatMap((f) => ["### " + f.title, f.p, "", ...(f.diagram ? ["```diagram " + f.id, "```", ""] : []), "**Code:** " + f.refs.map((x) => "`" + x + "`").join(" · "), ""]),
      "## What the goal puts at risk", ...(r.atRisk || []).map((x) => "- " + boldLead(x)), "",
      "## How it is tested today", r.testing.replace("npm test runs", "`npm test` runs").replace("npm test -- tests/invoicing/tiers.test.ts", "`npm test -- tests/invoicing/tiers.test.ts`"), "",
      "## Open question", ...r.open.map((x) => "- " + x), "",
      ...(answered("research").length ? ["## Decided with you", ...decided("research"), ""] : []),
    ]);
  }
  const md = (lines) => lines.join("\n");
  const slug = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  /** The lead sections' headings, for the Reader's Sections outline. */
  function docHeadings(app, step) {
    return docMarkdown(app, step).split("\n").filter((l) => l.startsWith("## ")).map((l) => ["md-" + step + "-" + slug(l.slice(3)), l.slice(3)]);
  }
  /** The whole file: each ## section a commentable heading, its body through the one Markdown renderer. */
  function StepDoc({ app, step }) {
    const t = D();
    const stage = app.v.stage;
    const parts = [];
    docMarkdown(app, step).split("\n").forEach((l) => { if (l.startsWith("## ")) parts.push({ h: l.slice(3), body: [] }); else if (parts.length) parts[parts.length - 1].body.push(l); });
    const after = (st) => STEPS.indexOf(stage) > STEPS.indexOf(st) || stage === "shipped";
    const meta = step === "discuss"
      ? t.kind + " · " + t.project + " · branch " + t.branch + " · " + (after("plan") ? "approved with the Plan " + fmt.clock(t.plan.approvedAt) : after("discuss") ? "finished · approved together with the Plan" : "being written")
      : step === "outline"
      ? (after("outline") ? "written by the build session from the approved Plan, " + fmt.clock(t.outline.written) : "written by the build session after your approval") + " · needs no approval; feedback on any slice reaches the build"
      : "Reading the code · " + t.research.questions.length + " questions · " + t.research.helpers.length + " helpers that never saw your request · a record to read, nothing to approve";
    return (
      <article className="doc" id={"doc-" + step}>
        <div className="rdr">
          <h1>{step === "discuss" ? t.title : step === "outline" ? "The build in " + t.outline.sliceCount + " slices" : t.files.docs.research[1]}</h1>
          <div className="meta">{meta}</div>
          {parts.map((p) => {
            const id = "md-" + step + "-" + slug(p.h);
            return (
              <React.Fragment key={id}>
                <Blk app={app} id={id}><h2>{p.h}</h2></Blk>
                <Md text={p.body.join("\n")} />
              </React.Fragment>
            );
          })}
          <DetailSections app={app} step={step} />
        </div>
      </article>
    );
  }
  /** The step pages are the Workflow model's; the Reader shows this file whole, so no step is a page of the Reader any more. */
  function docPage() { return false; }

  /**
   * The late choice, inside the Plan where it belongs: the person settles it while reading, before Approve unlocks. It is the
   * question card every other question uses (option A): the header line with where it sits, the title, the reason, what it
   * settles, the artifact, rows with the recommended one first, one own-answer field. One call has no strip and no
   * "Decision 1 of 1".
   */
  // The Plan's Your call can rest on a Mermaid diagram instead of an artifact: the same thumbnail as a choice's, in a
  // height-capped frame at the card's width (corner label and one Enlarge; no zoom, fit or code bar, no Tell me more).
  const CALL_DIAGRAM = { kind: "flow", nodes: ["Account page", "Both invoices previewed"], fan: ["Switch to usage billing", "Keep seats"] };
  function YourCall({ app, d }) {
    const recommended = d.rec ?? 0;
    const hints = ["Finance sees exactly what the customer will pay", "faster for many accounts; no preview"];
    const pick = (k) => app.decide(d.id, k === recommended ? "agree" : "change");
    const order = d.options.map((o, i) => i).sort((a, b) => (b === recommended) - (a === recommended));
    const [hint, setHint] = useState("");
    return (
      <section className="qx qx-call" id={"call-" + d.id} aria-label={"Your call: " + d.title} tabIndex={-1}>
        <QxTop app={app} title="Plan · your call, then Approve the Plan" />
        <QxHead title={d.title} why={"It showed up only once the design was drawn, and only you can weigh it: " + hints[0].toLowerCase() + " with A; B " + hints[1] + "."} settlesWord="In the Plan" settles="Engineering decisions" onSettles={() => app.jump("h-decisions")} who={app.v.agent.name + " waits"} />
        {app.s.callMedia === "diagram" ? <QxDiagram g={CALL_DIAGRAM} app={app} wide /> : <ArtifactInCard app={app} id={d.artifact} section={d.artifactAt} />}
        <QxChoices app={app} q={{ choices: order.map((k) => d.options[k]), rec: 0 }} grade={1} uid={d.id} onPick={(place) => pick(order[place])} onWords={() => { setHint("What should change? Typing here makes it a change"); app.wordsRef.current && app.wordsRef.current.focus(); }} />
        <OwnAnswer key={"own-" + d.id} app={app} id={d.id} agent={app.v.agent.name} placeholder={hint || undefined} />
        <div className="qx-acts"><span className="qx-saved" tabIndex={0} title="Your call is saved as you give it."><Icon name="check" size={14} />Saved</span></div>
      </section>
    );
  }

  /** The Plan as the Reader shows it: every section, in file order. */
  function PlanDoc({ app, live }) {
    const t = D();
    const { s } = app;
    const dec = s.decided; // {d1:'agree'|'change'}
    const settled = app.v.planSettled;
    const findingOf = (id) => t.research.findings.find((f) => f.id === id);
    const yours = t.questions.filter((q) => s.answers[q.id] || settled);
    const wireframePage = t.plan.wireframe ? `<!doctype html><html><head>
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
      <style>
        :root{color-scheme:${s.theme === "dark" ? "dark" : "light"};--ink:${s.theme === "dark" ? "#ededed" : "#171717"};--paper:${s.theme === "dark" ? "#0a0a0a" : "#fff"};--line:${s.theme === "dark" ? "#444" : "#bdbdbd"};--fill:${s.theme === "dark" ? "#202020" : "#f3f3f3"}}
        *{box-sizing:border-box}body{margin:0;padding:20px;color:var(--ink);background:var(--paper);font:14px/1.5 system-ui}
        h1{font-size:20px;margin:0 0 16px}.row{display:flex;gap:8px;flex-wrap:wrap}
        .pill,.box,button{border:1px solid var(--line);border-radius:5px;padding:5px 9px;background:var(--fill);color:var(--ink)}
        .on{font-weight:600}.field{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin:18px 0}.box{margin-left:auto}button{font:inherit}
      </style></head><body>${t.plan.wireframe.source.split('\n\n').slice(1).join('\n\n')}</body></html>` : "";
    return (
      <article className="doc" id="doc-plan">
        <div className="rdr">
          <h1>Count every request once, bill it by tier</h1>
          <div className="meta">{live ? "draft · 5 of " + t.plan.decisions.length + " decisions written" : settled ? "approved " + fmt.clock(t.plan.approvedAt) + " · outlined in " + t.outline.sliceCount + " slices" : s.moment === "plan-findings" ? "Codex's second opinion is being folded in" : s.moment === "plan-decide" && !t.plan.decisions.some((d) => d.late && s.decided[d.id]) ? "one call is left for you below" : "ready for your review · feedback you leave is saved for the agent"}</div>
          <div className="model-document-tools"><Btn sm icon="list" onClick={() => app.set({ pop: s.pop === "plan-sections" ? null : "plan-sections" })}>Sections</Btn><Btn sm icon="triangle-alert" onClick={() => app.jump("p-risky")}>1 risky section</Btn><Btn sm icon="copy" onClick={() => app.toast("Copied the Plan as Markdown · simulated")}>Copy</Btn>{s.pop === "plan-sections" ? <div className="model-section-menu" role="menu">{[["h-summary","Summary"],["p-risky","Risk to review"],["h-decisions","Engineering decisions"],["h-yours","Decided by you"],["h-made","Decisions made for you"],["h-before","Before the build"]].map(([id,label])=><button role="menuitem" key={id} onClick={()=>{app.set({pop:null});app.jump(id);}}>{label}</button>)}</div> : null}</div>
          <Blk app={app} id="h-summary"><h2>Summary</h2></Blk>
          <Blk app={app} id="p-summary">{(() => { const lines=t.plan.summary.split(/(?<=[.!?])\s+/);return <><p className="model-plan-lead">{lines[0]}</p>{lines.length>1?<ul className="model-plan-summary">{lines.slice(1).map((line,index)=><li key={index}>{line}</li>)}</ul>:null}</>;})()}</Blk>
          <Blk app={app} id="p-risky"><p className="model-plan-risk"><Icon name="triangle-alert" size={15}/><span><b>Risk to review:</b> {t.plan.risky}</span></p></Blk>
          <details className="model-reference"><summary>What the Plan rests on · {t.plan.rests.length} findings</summary>
          <h2 id="h-rests">What the Plan rests on<span className="n">{t.plan.rests.length} findings</span><span className="r"><button type="button" className="lnk" onClick={() => app.openFile("research/r1.md")}>Read the helpers' reports</button></span></h2>
          <ul className="rests">{t.plan.rests.map(([id, line]) => <Blk key={id} app={app} id={"p-r" + id}><li><b>{findingOf(id).title}.</b> {line}</li></Blk>)}</ul>
          </details>
          <h2 id="h-shape">Today and after the change</h2>
          <div className="ba"><Diagram g={t.plan.today} /><Diagram g={t.plan.after} /></div>
          {t.plan.wireframe ? <>
            <h2 id="h-interface">Interface</h2>
            <p>{t.plan.wireframe.lead}</p>
            <div className="dz" data-testid="plan-wireframe">
              <div className="dz-hd"><b>{t.plan.wireframe.name}</b><span className="k">· {t.plan.wireframe.surface} · wireframe</span></div>
              <iframe title={t.plan.wireframe.title} sandbox="" style={{ width: "100%", height: 370, border: 0 }} srcDoc={wireframePage} />
            </div>
          </> : null}
          <h2 id="h-artifacts">Artifacts<span className="n">{t.plan.artifacts.length}</span><span className="r">drawn by Claude Code</span></h2>
          <div className="dm">
            {t.plan.artifacts.map((d, i) => (
              <div key={d.id} className="dmr decide" onClick={() => app.openArtifact(d.id)}>
                <span className="num">{i + 1}</span>
                <span><b style={{ fontWeight: 600 }}>{d.title}.</b> {d.what}<span className="sub" style={{ display: "block" }}><code>{d.file}</code></span></span>
                <span className={"tag" + (s.artifacts[d.id] || settled ? "" : " you")}>{s.artifacts[d.id] === "change" ? "change sent" : s.artifacts[d.id] || settled ? "looks right" : live ? "" : "to look at"}</span>
              </div>
            ))}
          </div>
          <h2 id="h-decisions">Engineering decisions<span className="n">{t.plan.decisions.length}</span></h2>
          <div className="dm">
            {t.plan.decisions.slice(0, live ? 5 : undefined).map((d, i) => {
              const open = d.late && !dec[d.id] && s.moment === "plan-decide";
              return (
                <div key={d.id} className={"dmr" + (open ? " call" : "")} id={"dec-" + d.id}>
                  <span className="num">{i + 1}</span>
                  <span>{d.title}{<span className="sub" style={{ display: "block" }}>{d.p}</span>}{open ? <YourCall app={app} d={d} /> : null}</span>
                  <span className={"tag" + (open ? " you" : "")}>{live ? <span className="pillt draft">draft</span> : open ? "your call" : d.late ? (dec[d.id] === "change" ? "change sent" : "you chose A") : "documented"}</span>
                </div>
              );
            })}
          </div>
          {!live ? (
            <>
              <details id="h-second" className="model-reference" open={s.moment === "plan-findings"}><summary>Reviewed by Codex · {s.moment === "plan-findings" ? "findings are being addressed" : t.plan.findings.length + " findings addressed"}</summary><CheckLine label="Reviewed by" items={["Second opinion · Codex · " + t.plan.findings.length + " findings, all taken"]} open={s.checksOpen} onToggle={() => app.set({checksOpen:!s.checksOpen})}>
                <div className="check-source-row"><div><b>Second opinion · Codex, GPT-6.1 Sol</b><span>{s.moment==="plan-findings"?"Claude Code is folding the findings in":"Read the Plan for a simpler shape, missed risks and decisions that do not follow · " + t.plan.findings.length+" findings, all taken"}</span></div><Btn sm onClick={()=>app.openFile("reviews/plan.md")}>Read review</Btn></div>
              </CheckLine></details>
              <Fold id="h-yours" title="Decided by you" n={yours.length} right="in the Plan · part of this approval" open={!!s.yoursOpen} onToggle={() => app.set({ yoursOpen: !s.yoursOpen })}>
                <table><thead><tr><th>Step</th><th>Question</th><th>Your decision</th></tr></thead><tbody>{yours.map((q) => <tr key={q.id}><td>Plan</td><td>{q.text}</td><td>{s.answers[q.id] || q.answer}</td></tr>)}</tbody></table>
              </Fold>
              <h2 id="h-made">Decisions made for you<span className="n">{t.plan.madeForYou.length}</span></h2>
              <table><thead><tr><th>Decision</th><th>Reason and effect</th></tr></thead><tbody>{t.plan.madeForYou.map((text, index) => { const parts=text.split(" — ");return <tr key={index}><td>{parts.length>1?parts[0]:"Decision "+(index+1)}</td><td>{parts.length>1?parts.slice(1).join(" — "):text}</td></tr>;})}</tbody></table>
              <h2 id="h-not">Not doing</h2>
              <ul>{t.plan.notDoing.map((x, i) => <li key={i}>{x}</li>)}</ul>
              <h2 id="h-before">Before the build</h2>
              <table><thead><tr><th>#</th><th>What</th><th>Met by</th><th>Status</th></tr></thead><tbody>{t.plan.before.map((b, i) => <tr key={i}><td>{i + 1}</td><td>{b[0]}</td><td>{b[1]}</td><td>{b[2]}</td></tr>)}</tbody></table>
              <h2 id="h-assume">Assumptions<span className="n">{t.plan.assumptions.length} · unconfirmed</span></h2>
              <ul>{t.plan.assumptions.map((a, i) => <li key={i}>{a[0]} <span className="dim">· {a[1]}</span></li>)}</ul>
            </>
          ) : null}
          {!live ? (
            <>
              <h2 id="h-know">How we will know it works</h2>
              <Blk app={app} id="p-oracle"><p><b>The one signal that proves it:</b> {t.plan.oracle}</p></Blk>
              <Blk app={app} id="p-size"><p><b>Size:</b> {t.plan.size}</p></Blk>
              <p className="dim">{settled ? <>Implement cut this into {t.outline.sliceCount} slices. <button type="button" className="lnk" onClick={() => app.go({ view: "task", step: "outline" })}>Open Implement</button></> : "Once you approve, your chosen build session cuts the Plan into slices and task cards, then builds them. The cards need no approval; you can give feedback on any slice."}</p>
            </>
          ) : <p className="dim">{app.v.agent.name} is writing decision 6 of {t.plan.decisions.length}…</p>}
          {!live ? <DetailSections app={app} step="plan" /> : null}
        </div>
      </article>
    );
  }

  /* ── The task cards before the build session writes them: who writes it and when; while it is written, how far it is ── */
  function OutlinePending() {
    return (
      <section className="rh" aria-label="The task cards are written by the build session">
        <div className="rh-hd">
          <Mark state="wait" />
          <div><h2>Written after Plan approval</h2><p>Your chosen build session writes the task cards from the approved Plan, then builds them. Nothing to read here yet; the Plan is what you approve.</p></div>
        </div>
      </section>
    );
  }

  /** The task cards while the build session writes them: the sections written so far (6 of 11 slices), on the page and in the Reader. */
  function OutlineWriting({ app }) {
    return <QL.StepPages.outline app={app} written={6} />;
  }

  /** After approval: the start card until a build session takes the task; then that session writes the task cards. */
  function OutlineStart({ app }) {
    const { s, v } = app;
    if (v.stage !== "outline") return null;
    return (
      <div className="rdr-top">
        {s.buildWaiting
          ? <div className="mw"><Mark state="work" /><div><b>Codex is writing the task cards, then builds them.</b> Nothing needs you until the change is checked.</div></div>
          : <ImplementStart app={app} early />}
      </div>
    );
  }

  /**
   * The start card's Lands on row: the branch the build lands on and the one the pull request goes into, with two choices.
   * On the base branch the row turns amber, says that a pull request cannot be opened from there and recommends the new
   * branch. Nothing moves before the person picks.
   */
  function StartBranch({ app, onMain, branch, head, newBranch, repo, worktree, continuing }) {
    const target = branch === "new" && !continuing ? newBranch : head;
    return (
      <section className={"handover-workspace" + (onMain && target === head ? " warn" : "")} aria-label="Build workspace">
        <div className="handover-workspace-head"><Icon name="git-branch" size={14} /><b>{worktree ? "This task's worktree" : "This task's checkout"}</b></div>
        <code className="handover-path">{repo}</code>
        <div className="handover-property"><span>Build branch</span>{continuing ? <code>{head}</code> : <QL.Select label="Build branch" width="100%" value={branch} options={[{ value: "stay", label: "Stay on " + head }, { value: "new", label: "New branch · " + newBranch }]} onChange={(v) => app.set({ startBranch: v })} />}</div>
        <p className="handover-landing">{branch === "new" && !continuing ? <>Starts from <code>{head}</code> · creates <code>{newBranch}</code> when you start.</> : <>Builds on <code>{head}</code>.</>} {target === D().base ? "No pull request from the base branch." : <>Pull request to <code>{D().base}</code>.</>}</p>
        <p className="handover-continuity">Implement and Verify keep this workspace and the approved Plan together.</p>
        {onMain && target === head ? <p role="note" className="pw-bp">Choose a new branch here to open a pull request into <code>{D().base}</code> in Verify.</p> : null}
      </section>
    );
  }

  function ImplementStart({app}) {
    return <QL.BuildLaunchCard app={app} embedded/>;
  }

  /** The build as the Reader shows 02-implement.md: the slices, the checks and the decisions, every section open. */
  function BuildView({ app, all }) {
    const { s } = app;
    const original = D();
    const timingFixture = s.moment === "impl-timing";
    const base = timingFixture ? { ...original, slices: original.slices.map((slice) => ({ ...slice, minutes: slice.n === 2 ? 42 : null })) } : original;
    const t = s.completed12 ? { ...base, tasksTotal:30, tasksDone:30, slices:base.slices.concat({n:12,title:"Record final acceptance evidence",state:"done",minutes:8,tasks:["T29 Keep the verification receipts", "T30 Record the final source identity"],words:"The retained evidence belongs to this build."}) } : base;
    const complete = all || s.completed12;
    const done = t.slices.filter((x) => x.state === "done" || complete);
    const open = s.sliceOpen;
    const now = QL.useNow(30000);
    const minutesLeft = Math.max(0, Math.round((QL.data.T0 + 123 * 60000 - now) / 60000));
    const timed = done.filter((slice) => Number.isFinite(slice.minutes));
    const estimateKnown = s.buildPaceFresh !== false && timed.length === done.length;
    const stateOf = (sl) => (complete ? "done" : sl.state);
    return (
      <>
        <section className="slc" id="build">
          <div className="slc-h"><span>Slices</span><span className="n">{done.length} of {t.slices.length} done · {complete ? t.tasksTotal : t.tasksDone} of {t.tasksTotal} tasks</span><span className="r">{complete ? "finished " + fmt.clock(QL.data.T0 + 118 * 60000) : (estimateKnown ? "about " + fmt.min(minutesLeft * 60000) + " left · " : "") + (timed.length === 1 ? "slice " + timed[0].n + " took " + timed[0].minutes + " min" : timed.length > 1 ? "last slices took " + timed.slice(-4).map((x) => x.minutes).join(", ") + " min" : "")}</span></div>
          {t.slices.map((sl) => {
            const st = stateOf(sl);
            const isOpen = open === sl.n || st === "running";
            const showWords = st !== "done" || isOpen;
            return (
              <React.Fragment key={sl.n}>
                <button type="button" className={"slr " + st} onClick={() => app.set({ sliceOpen: open === sl.n ? null : sl.n })} aria-expanded={isOpen}>
                  {st === "done" ? <Icon name="check" /> : st === "running" ? <Mark state="work" /> : st === "held" ? <Mark state="you" /> : <i className="dot-o" />}
                  <span className="num">{sl.n}</span>
                  <span className="slr-t">{sl.title}</span>
                  <span className="slr-r">{st === "done" ? (sl.minutes != null ? sl.minutes + " min" : "done") : st === "running" ? sl.doneCount + " of " + sl.tasks.length : st === "after" ? sl.after : st === "held" ? "waits for you" : "next"}</span>
                  {showWords ? <span className="slr-s">{st === "running" ? <><b>{sl.nowTask}: {sl.tasks.find((x) => x.startsWith(sl.nowTask + " ")).slice(sl.nowTask.length + 1)}</b></> : st === "held" ? "waits for your answer on one file" : sl.words}</span> : null}
                </button>
                {isOpen?<div className="model-task-list">{sl.tasks.map((task)=>{const id=task.split(" ")[0], detail=QL.taskDetails[id], chosen=s.taskDetail===id;return <div key={id}><button type="button" className="model-task-row" aria-expanded={chosen} onClick={()=>app.set({taskDetail:chosen?null:id})}><code>{id}</code><span>{task.slice(id.length+1)}</span><Icon name={chosen?"chevron-down":"chevron-right"} size={14}/></button>{chosen && detail?<div className="model-task-detail"><p>{detail.objective}</p>{detail.files.length?<><h4>Files</h4><ul>{detail.files.map((f)=><li key={f}><code>{f}</code></li>)}</ul></>:null}{detail.testFirst?<><h4>{QL.testFirstLabel(detail.testFirst)}</h4><p>{detail.testFirst.text}</p></>:null}{detail.dod.length?<><h4>Done when</h4><ul>{detail.dod.map((d)=><li key={d}>{d}</li>)}</ul></>:null}</div>:null}</div>;})}</div>:null}
              </React.Fragment>
            );
          })}
        </section>
        <CheckLine label="Checked as it builds" items={all ? ["2,480 tests pass", "types and lint clean"] : ["1,180 tests pass", "types and lint clean"]} open={s.checksOpen} onToggle={() => app.set({ checksOpen: !s.checksOpen })}>
          {[["typecheck", "reused · unchanged since " + fmt.at(15), "check"], ["lint", "reused · unchanged since " + fmt.at(15), "check"], ["npm test · 372 files", all ? "passed · 7 min" : "142 of 372 · 1,180 passed", all ? "check" : "work"], ["npm run test:e2e", "passed · 3 min", "check"]].map((r, i) => <div key={i} className="r"><Mark state={r[2]} sm /><span>{r[0]}</span><span className="s">{r[1]}</span></div>)}
        </CheckLine>
        <Fold title="Decided while building" n={t.buildDecisions.length} right="each kept the Plan" open={s.bdOpen} onToggle={() => app.set({ bdOpen: !s.bdOpen })}>
          {t.buildDecisions.map((d) => <div key={d.n} className="dr"><span className="k">{d.where}</span><span>{d.what} <span className="dim">· {d.note}</span></span><button type="button" className="ask-why" aria-label="Ask why" title="Ask why" onClick={() => app.toast("Asks " + app.v.agent.name + " why; the answer lands in Feedback.")}><Icon name="message-circle-question-mark" size={14} /></button></div>)}
        </Fold>
      </>
    );
  }

  /** Codex stopped mid-build: one status line on the page, the grey stop square the agent chip uses. The Agent sidebar owns Continue and the terminal prompt; with it closed the line carries one quiet Continue that opens it. */
  function StoppedCard({ app }) {
    return (
      <div className="stopped-line" role="status" data-testid="interaction-agent-turn">
        <i className="stop-sq" aria-hidden="true" />
        <b>Codex stopped in slice 6</b>
        <span>1 of 3 tasks done · work kept</span>
        {app.s.railOpen ? null : <Btn sm quiet className="stopped-continue" data-testid="agent-continue" onClick={() => app.set({ railOpen: true, railTab: "agent" })}>Continue</Btn>}
      </div>
    );
  }

  const WAKE_SKIPPED = new URLSearchParams(window.location.search).get("wake") === "skipped";
  /** The pull request after the approval: its checks and reviews, until it is merged. */
  function PullRequestCard({ app, state }) {
    const P = QL.data.pr;
    const min = (n) => n * 60000;
    // A check is its mark and its name; only a failing one adds its log. The words are the accessible name.
    const rows = state === "merged"
      ? [["check", "All checks passed", "5 checks"]]
      : state === "threads"
        ? [["fail", P.failing.name, ""], ["check", "Lint and types", ""], ["check", "Migrations dry run", ""], ["check", "Load test · gateway p99", ""]]
        : P.checks.running.map(([n]) => ["work", n, ""]).concat(P.checks.passed.map(([n]) => ["check", n, ""]));
    return (
      <section className="slc pw-pr" aria-label="Pull request">
        <div className="slc-h"><Icon name="git-pull-request" size={15} style={{ color: state === "merged" ? "var(--check)" : "var(--accent)", alignSelf: "center" }} /><span>Pull request #{P.number}</span><span className="n">{P.branch} → {P.base} · {P.commits} commits · {stat(P.add, P.del)}</span><span className="r"><a href="#pull-412" onClick={(e) => { e.preventDefault(); app.toast("Opens the pull request on GitHub."); }}>Open on GitHub</a></span></div>
        <div className="pw-prb">
          <div className="pw-prk">{state === "merged" ? "Merged" : "Checks"}</div>
          <div>
            {state === "merged" ? <div className="pw-prr"><Mark state="check" sm /><span>Merged into <code>{P.base}</code> by {P.mergedBy} at {fmt.clock(P.mergedAt)} · {P.commits} commits as they were, nothing squashed by QualityLayer</span></div> : null}
            {rows.map(([m, text, r]) => <div key={text} className="pw-prr"><Mark state={m} sm /><span>{text}<span className="sr-only"> · {m === "fail" ? "failed" : m === "work" ? "running" : "passed"}</span></span>{r === "log" ? <a className="s" href="#check-log" onClick={(e) => { e.preventDefault(); app.toast("Opens the check's log on GitHub."); }}>Read the log</a> : <span className="s">{r}</span>}</div>)}
          </div>
          {/* A failing check resumes the task's stopped session and wakes it: once per failure, at most 3 per pull request a day,
              never with less than 10 % of the plan left. ?wake=skipped draws the "not woken" line with its reason. */}
          {state === "threads" ? <>
            <div className="pw-prk">Agent</div>
            <div>{WAKE_SKIPPED
              ? <div className="pw-prr"><Mark state="wait" sm /><span>Agent not woken · less than 10 % of the Claude Max plan left</span><span className="s">28 min ago</span></div>
              : <div className="pw-prr"><Mark state="work" sm /><span>Agent woken · its stopped session resumed for the failing check</span><span className="s">28 min ago</span></div>}</div>
          </> : null}
          <div className="pw-prk">Reviews</div>
          <div>
            {state === "open" ? <div className="pw-prr"><Mark state="wait" sm /><span>Checks running · nothing waits on you</span><span className="s">opened {fmt.clock(P.openedAt)}</span></div> : null}
            {state === "threads" ? <div className="pw-prr"><Mark state="fail" sm /><span>1 check failing · the agent has a fix</span><span className="s">18 min</span></div> : null}
            {state === "merged" ? <div className="pw-prr"><Mark state="check" sm /><span>Merged by you · all checks passed</span><span className="s">{fmt.clock(P.mergedAt - min(40))}</span></div> : null}
          </div>
        </div>
        {state === "merged" ? null : <p className="pw-prf dim">QualityLayer follows the pull request and never merges it. Merge in your own process; the task closes by itself when the pull request is merged.</p>}
      </section>
    );
  }

  /** What Verify shows once the change is approved: open and waiting on GitHub, waiting on you, or merged. */
  function PullRequestStage({ app, state }) {
    const { s } = app;
    const t = D();
    const P = QL.data.pr;
    const cmd = "Using QualityLayer, review task " + t.slug;
    const fold = () => <QL.StepPages.review app={app} />;
    if (state === "threads") {
      return (
        <>
          <YourTurn app={app} k="pull request #412" title="1 failing check waits on you"
            foot={<span>The fix is pushed only when you say so.</span>}>
            <div className="pw-th">
              {P.threads.map((th) => (
                <div key={th.id} className="pw-thr">
                  <span className="av">{th.av}</span>
                  <div><div className="msg-h"><b>{th.by}</b><span>{th.when} · {th.via} · <code>{th.file.split("/").slice(-2).join("/")}:{th.line}</code></span></div><p className="msg-p">{th.text}</p></div>
                  <button type="button" className="lnk" onClick={() => app.toast("Opens the line in the diff below.")}>Open the line</button>
                </div>
              ))}
              <div className="pw-thr"><span className="av" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}><Icon name="x" size={12} /></span><div><div className="msg-h"><b>{P.failing.name}</b><span>failed 18 min ago</span></div><p className="msg-p">1 test in <code>{P.failing.test}</code>: {P.failing.text}</p></div><a href="#check-log" onClick={(e) => { e.preventDefault(); app.toast("Opens the check's log on GitHub."); }}>Read the log</a></div>
            </div>
            <div className="row dim" style={{ fontSize: 12.5 }}>In your agent, in <code>{QL.data.projects[0].folder}</code></div>
            <Cmd text={cmd} copied={s.copied === "review"} onCopy={() => app.copy("review", cmd)} />
            {s.copied === "review" ? <div className="mw"><Mark state="wait" /><div><b>Copied. Waiting for Codex to start…</b> It takes the threads one at a time: fix as asked, fix differently, answer instead, or replan.</div></div> : null}
            <div className="row" style={{ gap: 14, fontSize: 12.5, flexWrap: "wrap" }}><button type="button" className="lnk" onClick={() => app.toast("The threads stay open on GitHub; nothing waits for you in the App until a new one arrives.")}>Leave them for now</button></div>
          </YourTurn>
          <PullRequestCard app={app} state="threads" />
          {fold("as you approved it")}
        </>
      );
    }
    if (state === "merged") {
      return (
        <>
          <section className="calm"><h3>Merged into {P.base} · pull request #{P.number}</h3><div className="nextyou" style={{ margin: "12px -18px -16px" }}><span className="k">Duration</span><span>Plan to merged in 9 h 5 min</span></div></section>
          <PullRequestCard app={app} state="merged" />
          {fold("as it was merged")}
        </>
      );
    }
    return (
      <>
        <section className="calm"><h3>Approved · pull request #{P.number} opened on {P.branch}</h3><p>{t.slices.length} slices, {t.tasksTotal} tasks, {POINTS()} points checked. Checks run on GitHub now; you are told when a review or a failing check needs you.</p><div className="nextyou" style={{ margin: "12px -18px -16px" }}><span className="k">Duration</span><span>Plan to the pull request in 7 h 40 min</span></div></section>
        <PullRequestCard app={app} state="open" />
        {fold("as you approved it · feedback on any line, your agent reads it")}
      </>
    );
  }

  /* ── Fold in at Verify: a task whose drafts sit on a lasting artifact shows one card per artifact. Each page the drafts change gets a row (a check,
     its name, Changed or New page, the lasting page and the draft's page); warnings stand above the footer; the footer folds the checked pages in as one
     revision named after the task, and they go into the task's own commits, so the pull request carries them. As src/ui/steps/review/FoldCard.tsx draws it. ── */
  const FOLD_ROWS = [
    { key: "Account", name: "Account", status: "changed", kind: "dash", draft: "account-billing-mode" },
    { key: "Plan and limits", name: "Plan and limits", status: "new", kind: "app", draft: "plan-limits" },
  ];
  function FoldCard({ app }) {
    const { s } = app;
    const artifact = "App Model";
    const [off, setOff] = useState({});
    const [force, setForce] = useState(false);
    const [stage, setStage] = useState("ready");
    const [all, setAll] = useState(false);
    const rows = FOLD_ROWS;
    const picked = rows.filter((r) => !off[r.key]);
    const changed = rows.filter((r) => r.status === "changed").length, fresh = rows.length - changed;
    const warnings = [
      { key: "since", text: "Account changed in " + artifact + " since this draft began (Export invoices as CSV, 3 d ago). Compare it first: folding replaces it with the draft's." },
      { key: "also", text: "Provision users from the identity provider, Anna's open task, also drafts on Account. The page folded last wins; compare it with her draft first." },
    ].filter(() => !off.Account);
    const head = (title, n) => <header className="fc-h"><Icon name={QL.ICON.library} size={15} className="fc-icon" /><h2>{title}</h2>{n ? <span className="fc-n">{n}</span> : null}</header>;
    if (stage === "later") return null;
    if (stage === "done")
      return (
        <section className="fc" aria-label={"Fold into " + artifact} data-testid="fold-card" data-state="done">
          {head("This task changed " + artifact)}
          <p className="fc-line" role="status"><Icon name="circle-check" size={15} /><span>Folded {fmt.plural(picked.length, "page")} into {artifact}: one revision named "{QL.data.task.title}", in this task's commit <code>4e1f7a2</code> and so in its pull request.</span></p>
        </section>
      );
    const shown = all ? rows : rows.slice(0, 4);
    const go = () => {
      if (warnings.length && !force) { setForce(true); return; }
      setStage("done");
      app.toast("Folded " + fmt.plural(picked.length, "page") + " into " + artifact);
    };
    return (
      <section className="fc" aria-label={"Fold into " + artifact} data-testid="fold-card" data-state="ready">
        {head("This task changes " + artifact, [changed ? fmt.plural(changed, "page") + " changed" : null, fresh ? fresh + " new" : null].filter(Boolean).join(" · "))}
        <ul className="fc-rows">
          {shown.map((r) => (
            <li key={r.key} className="fc-row" data-page={r.key} data-status={r.status}>
              <label className="fc-pick">
                <input type="checkbox" checked={!off[r.key]} onChange={() => setOff((o) => Object.assign({}, o, { [r.key]: !o[r.key] }))} />
                <span className="fc-pn"><b>{r.name}</b><span>{r.status === "new" ? "New page" : "Changed"} · from {r.draft}</span></span>
              </label>
              <span className="fc-ba" aria-hidden="true">
                {r.status === "new" ? <span className="fc-shot fresh">Not in {artifact} yet</span> : <span className="fc-shot"><QL.Thumb kind={r.kind} bare /></span>}
                <Icon name="arrow-right" size={16} className="fc-arrow" />
                <span className="fc-shot"><QL.Thumb kind={r.kind} bare /></span>
              </span>
            </li>
          ))}
        </ul>
        {rows.length > 4 ? <button type="button" className="lnk fc-more" onClick={() => setAll(!all)}>{all ? "Show fewer pages" : "Show all " + rows.length + " pages"}</button> : null}
        {warnings.length ? <ul className="fc-warns">{warnings.map((w) => <li key={w.key} className="fc-warn" data-testid="fold-warning"><Icon name="triangle-alert" size={14} /><span>{w.text}</span></li>)}</ul> : null}
        <footer className="fc-f">
          <p className="fc-say">{force ? "Some pages changed in " + artifact + " since this draft began. Compare them first; folding anyway replaces them with the draft's." : artifact + " gets one revision named after this task. The pages go into this task's commits and pull request."}</p>
          <span className="fc-acts">
            <Btn sm onClick={() => app.toast("Compare: the lasting page beside the draft's, one tab per page")}>Compare</Btn>
            <Btn sm quiet onClick={() => setStage("later")}>Not now</Btn>
            <Btn sm pri disabled={!picked.length} onClick={go}>{force ? "Fold anyway" : "Fold " + fmt.plural(picked.length, "page") + " in"}</Btn>
          </span>
        </footer>
      </section>
    );
  }

  /** Your review's cards: the Your turn card (confirm what only you can confirm, then approve) and the need the build queued. The step page stands them first. */
  function ReviewMove({ app }) {
    const { s } = app;
    const left = (s.confirmed ? 0 : 1) + (s.fineBd ? 0 : 1);
    // Only the point nobody but you can confirm blocks the final Approve; "Fine" is not blocking, so Approve accepts it while it is open.
    const blocked = !s.confirmed;
    const agent = app.v.agent.name;
    // The build ran outside the App and its agent asks for the approval in the terminal: the code stays one click
    // away above the Answer in Codex card, which never takes its place.
    if (s.taskWhere === "terminal") {
      const ask = { id: "review-approve", n: 1, text: "Approve the change?", why: "Every Done means point the agents can check passed; one only you can confirm is listed in the walkthrough.", choices: ["Approve", "Request changes"], rec: 0, settles: "the change" };
      return (
        <>
          <div className="rw-entry rw-entry-alone">
            <div><b>The code · 18 of {QL.data.pr.files} files read</b><span>Every changed file, split or unified, with a comment on any line</span></div>
            <Btn sm pri icon="file-code" onClick={() => (QL.openWorkspace ? QL.openWorkspace(app) : app.toast("Opens the Review workspace."))}>Review the code</Btn>
          </div>
          <AskedOutside app={app} cur={ask} asked={[ask]} batch={{ title: "Review the finished change" }} step="review" />
        </>
      );
    }
    return (
      <>
        <YourTurn app={app} k="then approve" title={left ? fmt.plural(left, "thing") + ", then approve" : "Everything is settled"} p={"Agents checked everything they can; " + (POINTS() - 1) + " of " + POINTS() + " points passed. Approve opens the pull request unless you pick otherwise." + (left > 0 && !blocked ? " Approving accepts what is still open." : "")} count={2 - left} of={2}
          keys={[["Y", "confirm"], ["F", "the code"], ["↵", "approve"]]}
          foot={<span className="split"><Btn pri disabled={blocked} icon="git-pull-request" onClick={() => app.set({ approved: true, moment: "pr-open" })}>Approve</Btn><Btn pri disabled={blocked} aria-label="More ways to approve" onClick={() => app.toast("Approve and open a pull request · Approve only · Copy the git commands")}><Icon name="chevron-down" size={14} /></Btn></span>}>
          <div className="rw-entry">
            <div><b>The code · 18 of {QL.data.pr.files} files read</b></div>
            <Btn sm pri icon="file-code" onClick={() => (QL.openWorkspace ? QL.openWorkspace(app) : app.toast("Opens the Review workspace."))}>Review the code</Btn>
          </div>
          {!s.confirmed ? (
            <div style={{ borderTop: "1px solid var(--line)", margin: "0 -18px", padding: "14px 18px 0" }}>
              <div className="row dim" style={{ fontSize: 12.5 }}>Only you can confirm · Done means {YOURS}</div>
              <div style={{ fontSize: 15, fontWeight: 600, margin: "4px 0 6px" }}>{D().doneMeans[YOURS - 1].text}.</div>
              <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.55 }}>Agents cannot sign in to the live admin. With a Finance login, switch a test account to usage billing and back: both invoices preview first, and the audit log lists both switches.</p>
              <div className="row" style={{ gap: 8, marginTop: 10 }}><Btn sm pri onClick={() => app.set({ confirmed: true })}>I confirm</Btn><Btn sm onClick={() => app.toast(agent + " records that you have not confirmed this point; it stays open in the pull request.")}>Ask the agent to record it</Btn></div>
            </div>
          ) : <div className="sent"><Icon name="check" size={14} /><span>You confirmed: Finance controls each account's billing mode</span><span className="r">just now</span><button type="button" className="lnk" onClick={() => app.set({ confirmed: false })}>Undo</button></div>}
          {!s.fineBd ? (
            <div style={{ borderTop: "1px solid var(--line)", margin: "0 -18px", padding: "14px 18px 0" }}>
              <div className="row dim" style={{ fontSize: 12.5 }}>Decided by {agent} while building · 1 of {D().buildDecisions.length} flagged for you</div>
              <div style={{ fontSize: 15, fontWeight: 600, margin: "4px 0 6px" }}>Proration rounds to the cent per line, matching the seat invoices.</div>
              <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.55 }}>Your Plan priced usage per window. Rounding every window would drift up to a cent a day against the seat invoices, so the build rounds once per invoice line, the way seat invoices already do.</p>
              <div className="row" style={{ gap: 8, marginTop: 10 }}><Btn sm pri onClick={() => app.set({ fineBd: true })}>Fine</Btn><Btn sm onClick={() => app.toast(agent + " explains in Feedback.")}>Ask why</Btn></div>
            </div>
          ) : <div className="sent"><Icon name="check" size={14} /><span>Fine: proration rounds to the cent per line</span><span className="r">just now</span><button type="button" className="lnk" onClick={() => app.set({ fineBd: false })}>Undo</button></div>}
        </YourTurn>
        <details className="model-reference" open><summary>Queued from the build · 1 check unverified</summary><p>{D().need.what}. {D().need.why}</p><p><code>{D().need.check}</code></p>{s.needSet === "set" ? <p>Your note is saved. The agent must check it before this can be marked passed.</p> : <div className="row" style={{gap:8}}><Btn sm onClick={() => app.set({needSet:"set"})}>It's set</Btn><span className="dim">This saves your note; it does not pass the check.</span></div>}</details>
      </>
    );
  }

  /** Your review before the approval is the step page; after it, the pull request until it is merged. */
  function ReviewStage({ app }) {
    const { s } = app;
    if (s.approved) {
      const m = QL.baseMoment(s.moment);
      if (["pr-open", "pr-threads", "pr-merged"].includes(m) || s.reviewShipChoice === "pr")
        return <PullRequestStage app={app} state={m === "pr-threads" ? "threads" : m === "pr-merged" ? "merged" : "open"} />;
      return <QL.StepPages.review app={app} />;
    }
    return <QL.StepPages.review app={app} />;
  }

  function StepEmpty({ app, step }) {
    const current=app.v.stage;
    const copy={research:["The Plan is being written","Helpers read the code for it. They never see your request."],plan:["The Plan is being written","The Plan appears here once your questions are settled."],outline:["Implement comes after you approve the Plan","The agent turns the approved Plan into slices here. It needs no approval."],implement:["Implementation hasn’t started","Build work appears here once the task cards are ready and you start the build."],verify:["Verification hasn’t started","The built change will be checked here after implementation."],review:["Your review comes after the checks","You’ll review the finished work and its evidence before the task ships."]}[step];
    return <section className="quiet-empty"><div className="quiet-empty-icon"><Mark state="open" /></div><h1>{copy[0]}</h1><p>{copy[1]}</p><Btn icon="arrow-left" onClick={()=>app.go({view:"task",step:current})}>Back to {STEP_LABEL[current]}</Btn></section>;
  }

  /* ── Opening a task, an artifact, the Artifacts list or Home: the App's own frame stays; only the content waits as a quiet outline under one status line.
     s.loading is "opening", "finding" (an artifact whose own details have not arrived), "slow" (after five seconds, with the time) or "failed" (a card with Try again). ?state= picks one. ── */
  const LOADING_STATES = [["opening", "Opening"], ["slow", "Slow"], ["failed", "Failed"]];
  const FINDING = ["finding", "Finding it"];
  function LoadingSwitch({ app, kind }) {
    const [target, setTarget] = useState(null);
    useEffect(() => { setTarget(document.querySelector(".pstrip-bar")); }, []);
    const states = kind === "artifact" ? [LOADING_STATES[0], FINDING].concat(LOADING_STATES.slice(1)) : LOADING_STATES;
    return target ? ReactDOM.createPortal(<label className="pstrip-k">Loading <select aria-label="Loading state" value={app.s.loading} onChange={(e) => app.set({ loading: e.target.value })}>{states.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>, target) : null;
  }
  /** The content while it loads. kind "task" draws a step page's outline; "artifact" a framed page on the canvas; "library" two project groups of rows. */
  function LoadingState({ app, kind, what, why, back }) {
    const state = app.s.loading;
    const slow = state === "slow", failed = state === "failed";
    const retry = () => app.set({ loading: "opening" });
    const bar = (w, extra) => <div className={"ld-bar " + w + (extra ? " " + extra : "")} />;
    const outline = kind === "artifact"
      ? <div className="ld-frame ld-out ld-sheen" aria-hidden="true"><div className="wf"><i className="side" /><i className="top" /><div className="main"><i className="w7" /><i className="w5" /><i className="big" /><i /><i className="w7" /></div></div></div>
      : kind === "library"
        ? <div className="ld-out ld-sheen ld-list" aria-hidden="true">{[0, 1].map((g) => <div className="ld-group" key={g}><div className="ld-head"><span className="ld-dot" />{bar("w40")}</div><div className="ld-card">{[70, 55, 80].map((w) => <div className="rowl" key={w}><span className="ld-thumb" />{bar("w" + w)}<span className="ld-pill" /></div>)}</div></div>)}</div>
        : <div className="ld-out ld-sheen ld-doc" aria-hidden="true">{bar("h1")}{bar("meta")}{bar("w90")}{bar("w80")}{bar("w60")}<div className="ld-card">{[70, 60, 80].map((w) => <div className="rowl" key={w}><span className="ld-dot" />{bar("w" + w)}<span className="ld-pill" /></div>)}</div><div className="ld-block" />{bar("w90")}{bar("w40")}</div>;
    const status = <p className={kind === "artifact" ? "ld-float" : "ld-status"} role="status"><span className="ld-spin" aria-hidden="true" /><b>{slow ? "Still " + what[0].toLowerCase() + what.slice(1) : what}</b>{slow ? <span className="t">· {kind === "task" ? "7 s" : "6 s"}</span> : null}{slow && kind === "artifact" ? <button type="button" className="lnk" onClick={back[1]}>{back[0]}</button> : null}</p>;
    const fail = { artifact: ["This page didn't load", "Reload"], task: ["This task didn't open", "Try again"], library: ["The Artifacts list didn't open", "Try again"] }[kind];
    return (
      <div className={"ld ld-" + kind} data-state={state} aria-busy={!failed}>
        <LoadingSwitch app={app} kind={kind} />
        {failed ? null : status}
        {slow && kind === "task" ? <p className="ld-sub">Large plans take a moment. You can keep working: <button type="button" className="lnk" onClick={() => app.go({ view: "home" })}>Home</button> · <button type="button" className="lnk" onClick={() => app.set({ search: true })}>another task</button></p> : null}
        {slow && kind === "library" ? <p className="ld-sub">A large library takes a moment. You can keep working: <button type="button" className="lnk" onClick={back[1]}>{back[0]}</button></p> : null}
        {outline}
        {failed ? <div className="ld-over"><section className="ld-fail" role="alert"><h2><i aria-hidden="true" />{fail[0]}</h2><p>{why}</p><div className="ld-act"><Btn pri onClick={retry}>{fail[1]}</Btn>{kind === "artifact" ? <Btn onClick={() => app.toast("Opens the page's source in your editor")}>Show the source</Btn> : null}<Btn quiet onClick={back[1]}>{back[0]}</Btn></div></section></div> : null}
      </div>
    );
  }
  /** Home on its first read: the two sections keep their names and wait as outlines; no count and no sentence says "nothing" before the read lands. */
  function HomeLoading({ app }) {
    const bar = (w) => <div className={"ld-bar " + w} />;
    const rows = (widths) => <div className="ld-rows ld-out ld-sheen" aria-hidden="true">{widths.map((w) => <div className="rowl" key={w}><span className="ld-dot" />{bar("w" + w)}<span className="ld-pill" /></div>)}</div>;
    // The Running mark is the neutral hollow one: no agent is known to work before the list has arrived (as the App's LoadingState).
    return (
      <>
      <header className="qh-heading"><h1>Home</h1></header>
      <div className="stage-in wide qh ld-home" style={{ marginTop: 16 }} data-state={app.s.loading} aria-busy="true">
        <LoadingSwitch app={app} kind="home" />
        <p className="sr" role="status">Opening Home</p>
        <section className="qh-sec" aria-labelledby="qh-needs"><header className="qh-h"><h2 id="qh-needs"><Mark state="you" />Needs you</h2></header>{rows([70, 55])}</section>
        <section className="qh-sec" aria-labelledby="qh-running"><header className="qh-h"><h2 id="qh-running"><Mark state="open" />Running</h2></header>{rows([60, 80, 45])}</section>
      </div>
      </>
    );
  }
  /** The sidebar's project list on the first read: tiles and names wait as outlines, so "No projects yet" is never said before the list is known. */
  function NavLoading() {
    const bar = (w) => <div className={"ld-bar " + w} />;
    return (
      <div className="ld-nav ld-out ld-sheen" aria-hidden="true">
        {[60, 45, 70].map((w) => <div key={w}><div className="rowl"><span className="ld-tile" />{bar("w" + w)}</div>{w === 60 ? <div className="sub">{bar("w70")}{bar("w60")}</div> : null}</div>)}
      </div>
    );
  }
  /** The right sidebar's body while a task or artifact opens: its tabs are real, its body waits. */
  function LoadingRail() {
    return <div className="rs-b ld-rail ld-out ld-sheen" aria-hidden="true"><div className="ld-term"><div className="ld-bar w60" /><div className="ld-bar w80" /><div className="ld-bar w40" /><div className="ld-bar w70" /></div><div className="ld-bar w60" /><div className="ld-bar w40" /></div>;
  }

  /* ── the stage: the step's page, by moment. A step's page is drawn in the Workflow model; a step not reached is one quiet line ── */
  function Stage({ app }) {
    const { s, v } = app;
    const agent = v.agent.name;
    const step = s.route.step;
    const stage = v.stage;
    const idx = STEPS.indexOf(step), cur = stage === "shipped" ? STEPS.length : STEPS.indexOf(stage);
    const P = QL.StepPages;
    let body;
    if (s.loading) body = <LoadingState app={app} kind="task" what={"Opening the " + STEP_LABEL[step]} why="QualityLayer didn't answer within 30 seconds. Nothing was changed, and no agent was started." back={["Home", () => app.go({ view: "home" })]} />;
    else if (s.moment === "new" && step === "discuss") body = <section className="task-preparing"><h1>{agent} is preparing the discussion</h1><p>Your task is ready. The discussion appears here as it is written, and its questions open here in one batch.</p><blockquote>{D().request}</blockquote><p className="dim">You can keep working. QualityLayer notifies you when an answer is needed.</p></section>;
    else if (step === "outline" && s.moment === "plan-approve") body = <OutlinePending />;
    else if (idx > cur) body = <StepEmpty app={app} step={step} />;
    else if (["discuss", "research"].includes(step) && QL.baseMoment(s.moment) === step + "-q") {
      const count = step === "discuss" ? v.openQ : v.openR;
      body = <div className="sp-page" data-step={step}>
        <section className="sp-move" aria-label="Your move"><BatchCard app={app} step={step} done /></section>
        {count > 0 ? <FoldedDoc app={app} file={D().files.docs[step][0]} status={"Draft · " + count + (count === 1 ? " question open" : " questions open")} read={"Read " + STEP_LABEL[step]} /> : step === "discuss" ? <P.discuss app={app} /> : <P.research app={app} />}
      </div>;
    }
    else if (step === "discuss") body = <P.discuss app={app} />;
    else if (step === "research") body = <P.research app={app} />;
    else if (step === "plan") body = <P.plan app={app} />;
    else if (step === "outline") {
      // Approved, no build session yet: the start card first, then who writes the task cards; once one started, the map fills slice by slice.
      body = stage === "outline" && !s.buildWaiting
        ? <div className="sp-page"><section className="sp-move" aria-label="Your move"><OutlineStart app={app} /></section></div>
        : <P.outline app={app} written={stage === "outline" ? 6 : null} />;
    } else if (step === "implement") body = <P.implement app={app} />;
    else if (step === "verify") body = <P.verify app={app} />;
    else if (step === "review") body = <ReviewStage app={app} />;
    // The agent's own start-up question (trust this folder, …) shows only in its terminal: the page says so, above whatever it holds.
    // One surface: the Agent tab carries the card while it is in view, the page only when the sidebar is closed or shows another tab.
    const asking = s.run?.state === "starting" && !s.run.recovering && QL.StartupPromptCard && !(s.railOpen && s.railTab === "agent");
    return <div className="stage-in" style={s.reading ? {display:"flex",flexDirection:"column",flex:1,minHeight:0,height:"100%",width:"100%",maxWidth:"none",margin:0} : undefined}>{asking ? <QL.StartupPromptCard app={app} agent={QL.agentNameOf(s.run.agent)} kind={s.run.startup || "trust"} onOpen={() => app.set({ railOpen: true, railTab: "agent", agentView: "terminal" })} /> : null}{body}{["implement", "verify", "review"].includes(step) && s.workspace && QL.ReviewWorkspace ? <QL.ReviewWorkspace app={app} /> : null}</div>;
  }

  /* ── records/pull-request-body.md: the pull request's description as GitHub gets it ── */
  // Three sections are written by QualityLayer from the task cards, the commits and the verdicts, and tagged generated in the outline.
  const BODY_GENERATED = ["Built, slice by slice", "What was asked for, and how each point was proved", "Deliberately not changed"];
  function bodyLines() {
    const t = D();
    const P = QL.data.pr;
    return [
      "[Task folder](docs/plans/" + t.slug + ") · [Reviewed in QualityLayer](#shared)",
      "",
      "## Why the change", "", P.why, "",
      "## What a reviewer must know", "", ...P.mustKnow.map((m) => "- " + m), "",
      "## What changed", "", "The meter feeds the windows; the ledger and the invoices read from them.", "", "```diff", ...P.changedView, "```", "",
      "## Built, slice by slice", "", "_Written by QualityLayer from the task cards and the build's commits. Each file links to the pull request's Files changed view._", "",
      ...t.slices.slice(0, 5).flatMap((sl) => ["**Slice " + sl.n + " · " + sl.title + "** · " + fmt.plural(sl.tasks.length, "task") + " · " + fmt.plural(P.fileCount[sl.n] || 0, "file"), ...(P.sliceFiles[sl.n] ? P.sliceFiles[sl.n].map(([p, , a, d, tk]) => "- [" + p + "](#diff-" + sl.n + ") · " + tk + " · +" + a + " −" + d) : []), ""]),
      "_" + (t.slices.length - 5) + " more slices as above._", "",
      "## What was asked for, and how each point was proved", "", "_One line per Done means point: the point, the scenario that proved it and where its evidence lives._", "",
      ...t.outline.scenarios.map(([dm, text, after]) => "- **" + dm + ". " + (t.doneMeans[dm - 1] || { text: "" }).text + ".** Scenario " + dm + ": " + text + " · passed after slice " + after + " · `records/it1-scenario-" + dm + ".txt`"),
      "- **" + YOURS + ". " + t.doneMeans[YOURS - 1].text + ".** Only the author can confirm: confirmed at the approval.", "- _" + (POINTS() - t.outline.scenarios.length - 1) + " more points, each with its scenario._", "",
      "## Deliberately not changed", "", ...t.plan.notDoing.map((x) => "- " + x), "- Committed by another session on this branch, not part of this change: " + P.otherSession.join(", "), ...(reviewUncommitted().before.length ? ["- Uncommitted changes that were already there before the build, not part of this change: " + reviewUncommitted().before.join(", ")] : []), "",
      "## How it was verified", "", "Project checks and the independent review ran on this change, with the Security review first and a Second opinion beside the review: " + (POINTS() - 1) + " of " + POINTS() + " points passed on the running program; 1 only the author can confirm.", "",
      "## Try it yourself", "", ...P.tryIt.flatMap((x, i) => ["### " + (i + 1) + ". " + x.h, "- Do: " + x.do, ...(x.run ? ["- Run: `" + x.run + "`"] : []), "- Expect: " + x.expect, "- Saw: " + x.saw, ""]), "### Not verified", "", ...P.notVerified.map((x) => "- " + x), "",
      "## Security", "", ...P.security.map((x) => "- " + x),
    ];
  }
  function BodyInline({ text }) {
    return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|_[^_]+_)/g).map((p, i) => (p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith("`") ? <code key={i}>{p.slice(1, -1)}</code> : p.startsWith("[") ? <a key={i} href={p.slice(p.indexOf("](") + 2, -1)} onClick={(e) => e.preventDefault()}>{p.slice(1, p.indexOf("]("))}</a> : p.startsWith("_") && p.endsWith("_") && p.length > 2 ? <em key={i} className="dim">{p.slice(1, -1)}</em> : p));
  }
  const bodyId = (title) => "pb-" + title.toLowerCase().replace(/[^a-z]+/g, "-");
  function BodyMarkdown({ lines }) {
    const out = []; let i = 0, k = 0;
    const key = () => "b" + k++;
    while (i < lines.length) {
      const l = lines[i];
      if (l.startsWith("```")) { const lang = l.slice(3); const body = []; i++; while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]); i++; out.push(<pre key={key()} className={lang}>{body.map((b, j) => <span key={j} className={lang === "diff" ? (b.startsWith("+") ? "add" : b.startsWith("-") ? "del" : "ctx") : undefined}>{b + "\n"}</span>)}</pre>); continue; }
      if (l.startsWith("## ")) { out.push(<h2 key={key()} id={bodyId(l.slice(3))}>{l.slice(3)}</h2>); i++; continue; }
      if (l.startsWith("### ")) { out.push(<h3 key={key()}>{l.slice(4)}</h3>); i++; continue; }
      if (l.startsWith("- ")) { const items = []; while (i < lines.length && lines[i].startsWith("- ")) items.push(lines[i++].slice(2)); out.push(<ul key={key()}>{items.map((x, j) => <li key={j}><BodyInline text={x} /></li>)}</ul>); continue; }
      if (l.trim() === "") { i++; continue; }
      out.push(<p key={key()}><BodyInline text={l} /></p>); i++;
    }
    return <div className="md">{out}</div>;
  }
  function BodyReader({ app }) {
    const P = QL.data.pr;
    const lines = bodyLines();
    const sections = lines.filter((l) => l.startsWith("## ")).map((l) => l.slice(3));
    const back = app.s.readFrom || { label: "Back to Verify" };
    return (
      <div className="main" style={{ minHeight: 0 }}>
        <div className="rbar"><Icon name="file-text" size={14} /><code className="rpath">records/pull-request-body.md</code><span className="dim rabout" style={{ fontSize: 12.5 }}>sent to GitHub as the pull request's description</span><span className="sp" /><Btn sm quiet className="back" icon="arrow-left" aria-label={back.label} onClick={() => app.unread()}><span className="bl">{back.label}</span> <kbd>Esc</kbd></Btn></div>
        <div className="reader">
          <nav className="otl" aria-label="On this page"><div className="otl-h">On this page</div>{sections.map((x) => <button key={x} type="button" className={BODY_GENERATED.includes(x) ? "det" : ""} onClick={() => app.jump(bodyId(x))}>{x}{BODY_GENERATED.includes(x) ? <span>generated</span> : null}</button>)}</nav>
          <div className="rdr-wrap" ref={app.readerRef}>
            <div className="rdr">
              <h1>{D().title}</h1>
              <div className="meta">pull request #{P.number} · {P.branch} → {P.base} · the first sections are the agent's; the three marked generated are written by QualityLayer from the task cards, the commits and the verdicts, and no agent writes them</div>
              <BodyMarkdown lines={lines} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── records/memory-activity.md: the lessons each step used and saved, by name ── */
  // Each title opens that lesson in Settings → Memory; a lesson no longer saved has no title to open.
  function MemoryRecordReader({ app }) {
    const M = D().files.memory;
    const cur = app.v.stage === "shipped" ? STEPS.length : STEPS.indexOf(app.v.stage);
    const steps = M.steps.filter((x) => STEPS.indexOf(x.step) <= cur && x.used.length + x.saved.length + (x.kept || []).length > 0);
    const distinct = (key) => new Set(steps.flatMap((x) => x[key].map((l) => l.id))).size;
    const open = (id) => {
      app.set((p) => ({ config: Object.assign({}, p.config, { memoryLessonOpen: id }) }));
      app.go({ view: "settings", tab: "memory" });
    };
    // As MemoryRecord.tsx inside RecordReader.tsx: the record's own crumb (Back to the step, the file, Read only), then 680 px of lessons by name.
    const row = (kind, l) => (
      <li key={kind + l.id} className="mrec-row">
        <span className="mrec-kind">{kind}</span>
        {l.title === null ? <span className="mrec-gone">This lesson is no longer saved</span> : <button type="button" className="mrec-link" onClick={() => open(l.id)}>{l.title}</button>}
        {/* A lesson about you says so after its title; it applies in every repository. */}
        {l.about === "you" ? <span className="mrec-yours">Yours</span> : null}
      </li>
    );
    const kept = steps.flatMap((x) => x.kept || []);
    const savedIds = new Set(steps.flatMap((x) => x.saved.map((l) => l.id)).concat(kept.filter((k) => k.kind === "Saved").map((k) => k.id)));
    const n = (kind) => kept.filter((k) => k.kind === kind).length;
    const extra = [["Revised", "revised"], ["Retired", "retired"], ["Still holds", "still holds"]].filter(([kind]) => n(kind) > 0).map(([kind, words]) => " · " + n(kind) + " " + words).join("");
    const usedN = distinct("used");
    return (
      <div className="main" style={{ minHeight: 0 }}>
        <section className="ir-record-reader" aria-label="Read-only agent record" data-testid="record-reader" ref={app.readerRef}>
          <div className="rs-crumb"><button type="button" className="back" onClick={() => app.unread()}>Back to the step</button><span className="fname">memory-activity.md</span><span>Read only</span></div>
          <div className="mrec" data-testid="memory-record" id="memory-record" data-screen-label="Task memory record">
            <h2>Memory</h2>
            {steps.length === 0 ? <p className="mrec-dim">No lessons used yet.</p> : <p className="mrec-dim">{usedN + (usedN === 1 ? " lesson" : " lessons")} used · {savedIds.size} saved{extra}</p>}
            {steps.map((x) => (
              <section key={x.step} className="mrec-step">
                <h3>{STEP_LABEL[x.step]}</h3>
                <ul className="mrec-list">{x.used.map((l) => row("Used", l))}{x.kept && x.kept.length ? null : x.saved.map((l) => row("Saved", l))}</ul>
                {/* What Verify did to the project's lessons, by name: saved, revised, retired, or read again and still holding. */}
                {x.kept && x.kept.length ? (
                  <div className="mrec-kept" data-testid="kept-at-review">
                    <h4>Kept at Verify</h4>
                    <p>At Verify the agent checked this task's decisions against the lessons they touch, so the project's memory matches what was built.</p>
                    <ul>{x.kept.map((k) => (
                      <li key={k.kind + k.id}><span className="mrec-k">{k.kind}</span><span className="mrec-b"><span className="mrec-t"><button type="button" className="mrec-link" onClick={() => open(k.id)}>{k.title}</button></span>{k.kind !== "Saved" && k.why ? <span className="mrec-why">{k.why}</span> : null}</span></li>
                    ))}</ul>
                  </div>
                ) : null}
              </section>
            ))}
            <p className="mrec-note">Project lessons are historical evidence. Required instructions and the approved plan remain authoritative.</p>
          </div>
        </section>
      </div>
    );
  }

  /**
   * The whole document: every section in file order, the lead sections as the step page draws them and the
   * working sections rendered from their Markdown after them, with an outline that dims the working sections.
   * The three reviews are the only other Markdown files; they open here too.
   */
  function CurrentReaderHtml({ html, doc, theme }) {
    const host = useRef(null);
    const [error, setError] = useState(null);
    useEffect(() => {
      const nodes = Array.from(host.current?.querySelectorAll("[data-reader-diagram]") || []);
      if (!nodes.length) return;
      let live = true;
      const viewers = [];
      QL.loadReaderDiagramViewer().then((viewer) => {
        if (!live) return;
        for (const node of nodes) {
          const index = Number(node.dataset.readerDiagram);
          const source = QL.readerDiagramSources[doc.sourceSha256]?.[index];
          if (source === undefined || !doc.diagrams?.[theme]?.[index]) throw new Error("The recorded Reader diagram is unavailable");
          viewers.push(viewer.mount(node, { source, theme, drawings: Object.fromEntries(Object.entries(doc.diagrams).map(([mode, diagrams]) => [mode, diagrams[index]])) }));
        }
        setError(null);
      }).catch((cause) => { if (live) setError(String(cause)); });
      return () => { live = false; viewers.forEach((viewer) => viewer.unmount()); };
    }, [html, doc.sourceSha256, theme]);
    return <>{error ? <p role="alert">{error}</p> : null}<div className="model-reader-markdown" style={{ position: "static", inset: "auto", display: "block", padding: 0, background: "transparent", gridColumn: "auto", placeItems: "normal" }} ref={host} dangerouslySetInnerHTML={{ __html: html }} /></>;
  }

  function CurrentReaderAgents({ app, doc }) {
    const [open, setOpen] = React.useState(false);
    const jump = app.s.target === "for-agents" && app.s.readerAgentsJump?.file === doc.file ? app.s.readerAgentsJump.n : 0;
    React.useEffect(() => { if (jump > 0) setOpen(true); }, [jump]);
    return <section id="for-agents" className="model-reader-agents" tabIndex={-1} aria-label="For agents" data-testid="reader-agents">
      <div className="model-reader-agents-head"><h2><Icon name="bot" size={16} />For agents</h2><span className="model-reader-agents-chip">not approved</span><Btn sm aria-expanded={open} aria-controls="reader-agents-body" onClick={() => setOpen(!open)}><Icon name={open ? "chevron-down" : "chevron-right"} size={14} />{open ? "Hide" : "Show"}</Btn></div>
      <p className="model-reader-agents-path" title={doc.agents.file}>{doc.agents.file}</p>
      <div id="reader-agents-body" aria-live="polite">{open ? <><p className="model-reader-agents-note">Changes nothing agreed; where it differs from the step file above, the step file wins.</p><CurrentReaderHtml html={doc.agents.html} doc={doc.agents} theme={app.s.theme} /></> : null}</div>
    </section>;
  }

  function Reader({ app, page }) {
    if (!page && app.s.route.file === "records/pull-request-body.md") return <BodyReader app={app} />;
    if (!page && app.s.route.file === "records/memory-activity.md") return <MemoryRecordReader app={app} />;
    if (!page && app.s.route.file === "records/checks.md") return (
      <div className="main" style={{ minHeight: 0 }}>
        <div className="rbar"><Btn sm quiet className="back" onClick={() => app.unread()}>Back to the step</Btn><code className="rpath">records/checks.md</code><span className="dim">Read only</span></div>
        <div className="reader"><div className="rdr-wrap" ref={app.readerRef}><div className="rdr">
          <h1>Checks</h1>
          <BodyMarkdown lines={[
            "- all · working tree (base 7bd83f4) · `bun run typecheck` · reused: nothing changed since it passed at 14:06",
            "- all · isolated copy (base 7bd83f4) · `bun run lint` · exit 0 · 1.4s · on a clean copy of HEAD plus this task's own files (in the checkout: exit 1; left out 1 file that is not this task's: src/billing/preview.ts)",
            "- scans · 7bd83f4 · gitleaks 8.30.0 · secrets · 18 files · none found",
            "## Earlier checks",
            "- T1 · 92584c1 · `bun run typecheck` · exit 0 · 3.1s",
          ]} />
        </div></div></div>
      </div>
    );
    const { s, v } = app;
    const t = D();
    const f = t.files;
    // page: the Plan's questions or reading, which is this same Reader on the step's own file.
    const file = page ? QL.currentReaderFile?.(s.route.step, s.route.file) || f.docs[s.route.step][0] : s.route.file || "01-plan.md";
    const currentDoc = QL.currentReaderDocument?.(file, app) || null;
    const step = currentDoc ? currentDoc.step : STEPS.find((st) => f.docs[st][0] === file) || null;
    // A task started from an existing plan draws its own files: the original, the Plan that maps it and its cards
    // (existing-plan.jsx). It returns null for any file it does not own.
    const adoptedDoc = t.adopted && QL.adoptedDoc ? QL.adoptedDoc(app, file, step) : null;
    // The task cards are not written yet (the Plan waits, or the build session has not finished it): nothing to navigate.
    const writing = step === "outline" && (s.moment === "plan-approve" || v.stage === "outline");
    const lead = adoptedDoc ? adoptedDoc.lead : step === "review" && window.QL_REVIEW_SIMPLIFIED ? [["review-checks","Checks and outcomes"],["review-screens","Screenshots"],["review-details","Change details"]] : writing ? [] : step === "discuss" || step === "research" || step === "outline" ? docHeadings(app, step) : { plan:[["h-summary", "Summary"], ["h-rests", "What the Plan rests on", t.plan.rests.length], ["h-shape", "Today and after"], ["h-artifacts", "Artifacts", t.plan.artifacts.length], ["h-decisions", "Engineering decisions", t.plan.decisions.length], ["h-second", "Reviewed by", t.plan.findings.length], ["h-yours", "Decided by you", t.questions.length], ["h-made", "Decisions made for you", t.plan.madeForYou.length], ["h-not", "Not doing"], ["h-before", "Before the build"], ["h-assume", "Assumptions", t.plan.assumptions.length], ["h-know", "How we will know"], ["det-plan-contracts", "System design contracts", 3]], implement: [["build", "Slices", t.slices.length], ["bd", "Decided while building", t.buildDecisions.length]], verify: [["verify-lanes", "How it is checked", 6], ["verify-list", "Done means, checked", POINTS()]], review: [["pw-why", "Why"], ["pw-asked", "What you asked for", POINTS()], ["pw-built", "Built, slice by slice", t.slices.length], ["pw-not", "Deliberately not changed"], ["pw-checked", "How it was checked"], ["pw-ship", "Ship"]] }[step] || [];
    // A working section the step page also draws (the contracts fold) is listed with the lead sections.
    const details = step && !(step === "review" && window.QL_REVIEW_SIMPLIFIED) && !writing && !adoptedDoc ? (f.details[step] || []).filter((d) => !d.lead && !d.inDoc).map((d) => ["det-" + step + "-" + d.id, d.title]) : [];
    if (currentDoc) {
      lead.splice(0, lead.length, ...currentDoc.sections.map((section) => [section.id, section.name]), ...(currentDoc.agents ? [["for-agents", "For agents", "not approved"]] : []));
      details.splice(0);
    }
    const review = f.reviews.find((r) => r.file === file) || null;
    const reviewDoc = {
      "reviews/plan.md": ["Second opinion on the Plan · Codex, GPT-6.1 Sol", t.plan.findings.length + " changes asked. Each finding carries the planner's answer: Taken, Kept with a reason, or Ask when only you can decide. The Plan's Reviewed by line is drawn from this file.", t.plan.findings.map((x) => x.n + ". " + x.where + " · " + x.what + "  Answer: Taken · " + x.taken)],
      "reviews/verify.md": ["Second opinion on the change · Codex, GPT-6.1 Sol", "4 changes asked. Another vendor read the diff for what would break. The independent review proves Done means, so this review skipped that.", ["1. services/aggregator/src/windows.ts · a retry that arrived after its window closed was counted in the next window too  Answer: Taken · the dedupe key outlives its window by seven days", "2. services/invoicing/src/proration.ts · proration rounded half a cent down  Answer: Taken · it rounds half up, as seat invoices do", "3. tests/invoicing/tiers.test.ts · the test built its expected prices from the same pricing table as the code  Answer: Taken · the expected prices are written out by hand", "4. services/gateway/src/meter.ts · the gateway reads the plan on every request  Answer: Kept · the plan is cached for 60 s, so the read is a cache hit"]],
    }[file];
    let doc;
    if (currentDoc) doc = <article className="doc rdr model-current-reader" id={"doc-" + currentDoc.step}>
      <h1>{currentDoc.title}</h1>
      {currentDoc.sections.map((section) => {
        const html = section.html;
        return <section key={section.id} id={section.id} className="blk">
          <h2>{section.name}</h2>
          {section.name === "Summary" ? <div className="blk" id="p-summary"><CurrentReaderHtml html={html} doc={currentDoc} theme={s.theme} /></div> : <CurrentReaderHtml html={html} doc={currentDoc} theme={s.theme} />}
          {section.name === "Interface" ? t.plan.artifacts.map((artifact) => <ArtifactInCard key={artifact.id} app={app} id={artifact.id} />) : null}
        </section>;
      })}
      {currentDoc.agents ? <CurrentReaderAgents key={file + ":" + currentDoc.sourceMoment} app={app} doc={currentDoc} /> : null}
    </article>;
    else if (adoptedDoc) doc = adoptedDoc.doc;
    else if (step === "discuss" || step === "research") doc = <StepDoc app={app} step={step} />;
    else if (step === "plan") doc = <PlanDoc app={app} live={s.moment === "plan-work"} full />;
    else if (step === "outline") doc = s.moment === "plan-approve" ? <OutlinePending /> : v.stage === "outline" ? (s.buildWaiting ? <OutlineWriting app={app} /> : page ? <OutlineStart app={app} /> : <OutlinePending />) : <StepDoc app={app} step="outline" />;
    else if (step === "implement") doc = <div className="rdr"><h1>{t.title} · the build</h1><div className="meta">{t.slices.length} slices from the task cards, each built test first. QualityLayer writes the first sections from the build's records; the helpers append theirs.</div><div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}><BuildView app={app} full all={STEPS.indexOf(v.stage) > STEPS.indexOf("implement") || v.stage === "shipped"} /></div><DetailSections app={app} step="implement" /></div>;
    else if (step === "verify") doc = <div className="rdr"><h1>{t.title} · what was checked</h1><div className="meta">The Verify page and its files are drawn in the Workflow model.</div><DetailSections app={app} step="verify" /></div>;
    else if (step === "review") doc = <div className="rdr"><h1>Verify · the change, top to bottom</h1><div className="meta">Verify's review page and its files are drawn in the Workflow model. <button type="button" className="lnk" onClick={() => app.openFile("records/pull-request-body.md")}>Read the pull request as GitHub gets it</button></div><DetailSections app={app} step="review" /></div>;
    else if (reviewDoc) doc = (
      <div className="rdr">
        <h1>{reviewDoc[0]}</h1>
        <div className="meta">a review, as the reviewer wrote it · {file}</div>
        <p className="dim">{reviewDoc[1]}</p>
        <ol className="agent-lines">{reviewDoc[2].map((x, i) => <li key={i}>{x.replace(/^\d+\. /, "")}</li>)}</ol>
      </div>
    );
    else doc = (
      <div className="rdr">
        <h1>{file}</h1>
        <div className="meta">a file in the task folder</div>
        <p className="dim">The task folder holds three documents, the artifacts, the reviews and the records. Everything else is the build's own output.</p>
      </div>
    );
    const back = s.readFrom || { label: "Back to " + STEP_LABEL[s.route.step] };
    const hasOutline = lead.length > 0 || details.length > 0;
    // Sections shows or hides the outline: a column at desktop width, a menu on a phone.
    const narrow = app.width <= 640;
    const secOn = hasOutline && (s.secOpen == null ? !narrow : s.secOpen);
    const path = "docs/plans/" + t.slug + "/" + file;
    const outline = (close) => (
      <>
        <div className="otl-h">On this page</div>
        {lead.map(([id, l, n]) => <button key={id} type="button" className={s.target === id ? "on" : ""} onClick={() => { if (id === "for-agents" && currentDoc?.agents) app.set((before) => ({ readerAgentsJump: { file, n: (before.readerAgentsJump?.n || 0) + 1 } })); app.jump(id); close && close(); }}>{id === "for-agents" ? <><Icon name="bot" size={13} />{l}</> : l}{n ? <span>{n}</span> : null}</button>)}
        {details.length ? <div className="otl-g">Also in this document</div> : null}
        {details.map(([id, l]) => <button key={id} type="button" className={"det" + (s.target === id ? " on" : "")} onClick={() => { app.jump(id); close && close(); }}>{l}</button>)}
      </>
    );
    const closePop = () => app.set({ pop: null });
    const copyItem = (l, n, fn, icon = "copy") => <button type="button" className="mi" onClick={() => { closePop(); fn(); }}><Icon name={icon} size={14} /><span>{l}</span><span className="n">{n}</span></button>;
    return (
      <div className="main" style={{ minHeight: 0 }}>
        <div className="rbar">
          {page ? null : <Btn sm quiet className="back" icon="arrow-left" aria-label={back.label} onClick={() => app.unread()}><span className="bl">{back.label}</span> <kbd>Esc</kbd></Btn>}
          <Icon name="file-text" size={14} />
          <code className="rpath" title={path}>{file}</code>
          {review ? <span className="dim rabout" style={{ fontSize: 12.5 }}>about <button type="button" className="lnk" onClick={() => app.openFile(f.docs[review.step][0])}>{f.docs[review.step][0]}</button></span> : null}
          <span className="sp" />
          {hasOutline ? (
            <span className="ranchor">
              <Btn sm icon="list" data-pop-anchor aria-expanded={secOn} aria-pressed={narrow ? undefined : secOn} onClick={() => app.set({ secOpen: !secOn })}>Sections</Btn>
              {narrow && secOn ? <QL.Popover open onClose={() => app.set({ secOpen: false })} style={{ width: 280, maxHeight: 420, overflow: "auto" }}><nav className="otl otl-pop" aria-label="On this page">{outline(() => app.set({ secOpen: false }))}</nav></QL.Popover> : null}
            </span>
          ) : null}
          {step === "plan" && !adoptedDoc && !currentDoc ? <Btn sm icon="triangle-alert" onClick={() => app.jump("p-risky")}>1 risky section</Btn> : null}
          <span className="ranchor">
            <Btn sm icon="copy" className="copy" data-pop-anchor aria-label="Copy" aria-haspopup="menu" aria-expanded={s.pop === "rcopy"} onClick={() => app.togglePop("rcopy")}><span className="bl">Copy</span><Icon name="chevron-down" size={13} /></Btn>
            <QL.Popover open={s.pop === "rcopy"} onClose={closePop} style={{ width: 260 }}>
              <div className="menu">
                {copyItem("Copy as Markdown", currentDoc?.step === "plan" && currentDoc.kind === "people" ? "Jira, GitHub, Linear · names only; plan export writes picture files" : "Jira, GitHub, Linear", () => app.toast(currentDoc ? "Prototype: Copy as Markdown. No clipboard content changed." : "Copied " + file + " as Markdown"))}
                {copyItem("Copy formatted", "Confluence, Docs, Notion, Word · pictures included", () => app.toast(currentDoc ? "Prototype: Copy formatted. No clipboard content changed." : "Copied " + file + " as rich text"))}
                {currentDoc?.agents ? copyItem("Copy for an agent", "The step file, then its agents’ file", () => app.toast("Prototype: Copy for an agent. No clipboard content changed."), "bot") : null}
                {currentDoc?.kind === "people" && currentDoc.step === "plan" && QL.currentReaderHasBuildPrompt?.(app) ? copyItem("For another agent", "A prompt that starts the build in any agent", () => app.toast("Prototype: For another agent. No clipboard content changed."), "square-terminal") : null}
                <div className="menu-sep" />
                {copyItem("Copy path", "", () => app.copy("path", path))}
              </div>
            </QL.Popover>
          </span>
        </div>
        <div className={"reader" + (secOn && !narrow ? "" : " noline")}>
          {secOn && !narrow ? <nav className="otl" aria-label="On this page">{outline()}</nav> : null}
          <div className="rdr-wrap" ref={app.readerRef}>
            {doc}
          </div>
        </div>
      </div>
    );
  }

  /* ── an artifact at full size ── */
  /* The canvas: every artifact of the task as an artboard, found by name, compared side by side. */
  function ArtifactCanvas({ app, current, theme, onFocus, onClose }) {
    const all = D().plan.artifacts;
    const [q, setQ] = useState("");
    const [compare, setCompare] = useState([]);
    const [scale, setScale] = useState(33);
    const [fitted, setFitted] = useState(true);
    const room = React.useRef(null);
    const shown = all.filter((d) => (compare.length === 0 || compare.includes(d.id)) && (d.title + " " + d.what).toLowerCase().includes(q.toLowerCase()));
    /* As the App's fit: the boards fill the room's width, two to a row, 10 % to 100 %. */
    const fit = () => {
      const w = (room.current && room.current.clientWidth) || 900;
      const columns = w < 700 ? 1 : Math.min(shown.length || 1, 2);
      const pad = w < 600 ? 32 : 64;
      setScale(Math.round(Math.max(0.1, Math.min(1, (w - pad - (columns - 1) * 32 - 2) / (1280 * columns))) * 100));
      setFitted(true);
    };
    React.useLayoutEffect(() => { if (fitted) fit(); }, [fitted, shown.length, compare.length]);
    return (
      <section className="dw" aria-label="Artifact canvas">
        <div className="dw-tools dw-bar" role="toolbar" aria-label="Canvas tools">
          <IconBtn icon="arrow-left" label="Back to artifact" side="right" onClick={onClose} />
          <b className="dw-nm">Compare</b><span className="dw-n" role="status" aria-label={shown.length + " artboards"}>{shown.length}</span>
          <span className="tb-sep" />
          <fieldset className="dw-pick" aria-label="Artboards to compare">
            {all.map((d) => { const on = compare.includes(d.id); return <button key={d.id} type="button" className="dw-chip" aria-pressed={on} title={d.title} onClick={() => setCompare((l) => on ? l.filter((x) => x !== d.id) : l.concat(d.id))}><Icon name="frame" size={14} /><span>{d.title}</span></button>; })}
          </fieldset>
          <label className="dw-find"><Icon name="search" size={14} /><input type="search" aria-label="Find artifacts" placeholder="Find" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <span className="artifact-header-zoom" role="group" aria-label="Zoom"><IconBtn icon="zoom-out" label="Zoom canvas out" onClick={() => { setFitted(false); setScale((z) => Math.max(10, z - 10)); }} /><button type="button" className="btn sm" aria-label={fitted ? "Fit canvas" : scale + " %, fit canvas"} title="Fit the width" onClick={fit}>{fitted ? "Fit" : scale + "%"}</button><IconBtn icon="zoom-in" label="Zoom canvas in" onClick={() => { setFitted(false); setScale((z) => Math.min(150, z + 10)); }} /></span>
        </div>
        <div className="dw-room" ref={room} tabIndex={0} aria-label="Artboards, scroll to pan">
          {shown.length === 0 ? <div className="nav-empty">No artifacts match your search.</div> : null}
          <div className="dw-boards">
            {shown.map((d) => (
              <section key={d.id} className="dw-board" aria-label={d.title}>
                <button type="button" className="dw-name" onClick={() => onFocus(d.id)} title={"Open " + d.title}><span>{d.title}</span></button>
                <div className="dw-frame" style={{ width: 1280 * scale / 100, height: 800 * scale / 100 }}>
                  <iframe title={d.title} srcDoc={QL.artifactDocuments[d.id]} tabIndex={-1} style={{ width: 1280, height: 800, transform: "scale(" + scale / 100 + ")" }} data-theme={theme} onLoad={(e) => { try { e.target.contentDocument.documentElement.dataset.theme = theme; } catch (err) {} }} />
                  <button type="button" className="dw-open" aria-label={"Focus " + d.title} onClick={() => onFocus(d.id)} />
                </div>
                <p className="dim">{d.what}</p>
              </section>
            ))}
          </div>
        </div>
      </section>
    );
  }

  /* Artifact details: what the artifact is for, its source and its history; duplicate, rename or delete it. */
  function ArtifactManage({ app, d, onClose }) {
    const [tab, setTab] = useState(app.s.dm === "history" ? "history" : "details");
    const [title, setTitle] = useState(d.title);
    const [name, setName] = useState(d.id + "-alternative");
    const [sure, setSure] = useState(false);
    const revs = [["now", "Claude Code · " + fmt.ago(Date.now() - d.at) + " ago", "the current artifact"], ["r2", "Claude Code · 3 h ago", "before your feedback on the header"], ["r1", "Claude Code · yesterday", "first draft"]];
    return (
      <aside className="dw-manage" aria-label="Artifact details">
        <div className="dw-mh"><b>Artifact details</b><IconBtn icon="x" label="Close details" onClick={onClose} /></div>
        <Seg value={tab} options={[{ value: "details", label: "Details" }, { value: "source", label: "Source" }, { value: "history", label: "History" }]} onChange={setTab} />
        {tab === "details" ? (
          <div className="dw-form">
            <label>Title<input className="field" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label>Purpose<textarea className="field" rows={3} defaultValue={d.what} /></label>
            <Btn sm onClick={() => app.toast("Saved. The agent sees the new title and purpose.")}>Save details</Btn>
            <div className="menu-sep" />
            <label>New artifact name<input className="field mono" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <div className="row"><Btn sm onClick={() => app.toast("Duplicated as " + name + ". The original stays as it is.")}>Duplicate</Btn><Btn sm quiet onClick={() => app.toast("Renamed to " + name + ". Feedback and links follow it.")}>Rename</Btn></div>
            <div className="menu-sep" />
            {sure ? <div className="row"><span className="dim">Remove this artboard? Its source stays in version history.</span><Btn sm danger className="delete-confirm" onClick={() => { setSure(false); app.toast("In the App this deletes the artifact. The model keeps it."); }}>Delete</Btn><Btn sm quiet onClick={() => setSure(false)}>Keep it</Btn></div> : <Btn sm quiet icon="trash-2" onClick={() => setSure(true)}>Delete this artifact</Btn>}
          </div>
        ) : tab === "source" ? (
          <div className="dw-form"><textarea className="field mono" rows={12} aria-label="Artifact source" defaultValue={"<!doctype html>\n<html lang=\"en\">\n<!-- " + d.file + " -->\n…"} /><Btn sm onClick={() => app.toast("Saved. A wrong edit is one restore away in History.")}>Save source</Btn><span className="dim">Source is checked before saving. History keeps earlier versions for restoration.</span></div>
        ) : (
          <ul className="dw-hist">{revs.map(([id, who, what]) => <li key={id}><span><b>{who}</b><br /><span className="dim">{what}</span></span>{id === "now" ? <span className="dim">current</span> : <Btn sm quiet onClick={() => app.toast("Restored. The current version is kept in History.")}>Restore</Btn>}</li>)}</ul>
        )}
      </aside>
    );
  }

  function ArtifactExportModel({ app, title, pages = 1 }) {
    const root = useRef(null), trigger = useRef(null), timer = useRef(null);
    const [format, setFormat] = useState("pdf"), [scope, setScope] = useState("all"), [status, setStatus] = useState("");
    const [failNext, setFailNext] = useState(new URLSearchParams(window.QL_PREVIEW_QUERY ?? location.search).get("export") === "error");
    const open = app.s.pop === "artifact-export";
    const choices = [["pdf", "file-text", "PDF", "Document"], ["png", "image", "Images", "PNG per page"], ["html", "globe", "Web page", "Opens offline"]];
    const selected = choices.find(([id]) => id === format);
    const extension = format === "png" && scope === "all" && pages > 1 ? "zip" : format;
    const filename = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "." + extension;
    const close = () => { clearTimeout(timer.current); app.set({ pop: null }); trigger.current?.focus({ preventScroll: true }); };
    useEffect(() => {
      if (!open) return;
      requestAnimationFrame(() => root.current?.querySelector('input:checked')?.focus());
      const outside = event => { if (!root.current?.contains(event.target)) close(); };
      const key = event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } };
      document.addEventListener("pointerdown", outside); document.addEventListener("keydown", key, true);
      return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key, true); clearTimeout(timer.current); };
    }, [open]);
    return <span ref={root} className="artifact-model-export dv-menu">
      <button ref={trigger} type="button" className="btn sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => app.togglePop("artifact-export")}><Icon name="share" size={14}/>Export</button>
      {open ? <section className="pop artifact-export-card" role="dialog" aria-label="Export">
        <div className="artifact-export-head"><b>Export</b><span title={title}>{title}</span><IconBtn icon="x" label="Close export" onClick={close}/></div>
        <fieldset className="artifact-export-formats" disabled={status === "busy"}><legend className="sr">Format</legend>{choices.map(([id, icon, label, hint]) => <label key={id} data-selected={format === id}><input type="radio" name="artifact-export-format" value={id} checked={format === id} onChange={() => { setFormat(id); setStatus(""); }}/><Icon name={icon} size={20}/><b>{label}</b><small>{hint}</small></label>)}</fieldset>
        {pages > 1 ? <fieldset className="artifact-export-scope" disabled={status === "busy"}><legend>Pages</legend>{[["current", "This page"], ["all", "All " + pages]].map(([id, label]) => <label key={id}><input type="radio" name="artifact-export-pages" checked={scope === id} onChange={() => { setScope(id); setStatus(""); }}/>{label}</label>)}</fieldset> : null}
        <div className="artifact-export-file"><Icon name={selected[1]} size={16}/><span title={filename}>{filename}</span><small>{scope === "all" ? pages : 1} {format === "png" ? "image" : "page"}{scope === "all" && pages > 1 ? "s" : ""}</small></div>
        {status === "error" ? <p role="alert" className="artifact-export-error">Could not export. Try again.</p> : null}
        {status === "done" ? <div className="artifact-export-result" role="status"><Icon name="circle-check" size={16}/><span>Download started · simulated</span><Btn sm quiet onClick={() => setStatus("")}>Export again</Btn></div> : <Btn pri className="artifact-export-go" disabled={status === "busy"} onClick={() => { setStatus("busy"); timer.current = setTimeout(() => { setStatus(failNext ? "error" : "done"); setFailNext(false); }, 350); }}><Icon name="download" size={15}/>{status === "busy" ? "Exporting…" : "Export " + (format === "png" ? "images" : selected[2])}</Btn>}
      </section> : null}
    </span>;
  }

  function ArtifactViewer({ app }) {
    const { s } = app;
    const d = D().plan.artifacts.find((x) => x.id === s.route.artifactId) || D().plan.artifacts[0];
    const ref = useRef(null);
    const zoom = s.artifactZoom;
    const setZoom = (value) => app.set({ artifactZoom: typeof value === "function" ? value(zoom) : value });
    const theme = s.artifactTheme || s.theme;
    const setTheme = (value) => app.set({ artifactTheme: value });
    const device = s.artifactDevice;
    const setDevice = (value) => app.set({ artifactDevice: value });
    const [canvas, setCanvas] = useState(s.dm === "canvas");
    const [selectedWords, setSelectedWords] = useState(null), [dragMark, setDragMark] = useState(null);
    const feedbackButton = useRef(null);
    const [manage, setManage] = useState(s.dm === "details" || s.dm === "history");
    const openMark = (mark) => {
      app.set({ artifactCommenting: false, artifactSpot: null }); setSelectedWords(null); setDragMark(null);
      if (QL.askInlineOpen) QL.askInlineOpen(Object.assign({ kind: "artifact", page: d.file || d.id + ".html", place: d.title, section: "artifact", rects: [] }, mark));
      else app.askAgent({ artifact: d, page: d.file || d.id + ".html", section: mark.section || "selection", revision: "local-current", quote: mark.quote, ...(mark.region ? { region: mark.region } : {}) });
    };
    const startMark = event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      setDragMark({ x: event.clientX, y: event.clientY, toX: event.clientX, toY: event.clientY });
    };
    const finishMark = event => {
      if (!dragMark) return;
      const f = ref.current, r = f.getBoundingClientRect(), scale = r.width / f.offsetWidth;
      const x = Math.round((dragMark.x - r.left) / scale), y = Math.round((dragMark.y - r.top) / scale);
      const region = Math.abs(event.clientX - dragMark.x) + Math.abs(event.clientY - dragMark.y) > 6;
      const el = f.contentDocument?.elementFromPoint(x, y), section = el?.closest('[data-screen-label]');
      openMark({ section: section?.id || "spot-" + x + "-" + y, place: d.title + (section ? " › " + section.dataset.screenLabel : ""), quote: (el?.textContent || d.title).trim().slice(0, 300), point: { x: event.clientX, y: event.clientY + 12 }, ...(region ? { region: { x: Math.min(x, Math.round((event.clientX-r.left)/scale)), y: Math.min(y, Math.round((event.clientY-r.top)/scale)), w: Math.round(Math.abs(event.clientX-dragMark.x)/scale), h: Math.round(Math.abs(event.clientY-dragMark.y)/scale) }, box: { x: Math.min(dragMark.x,event.clientX), y: Math.min(dragMark.y,event.clientY), w: Math.abs(event.clientX-dragMark.x), h: Math.abs(event.clientY-dragMark.y) } } : { pin: { x: event.clientX, y: event.clientY } }) });
    };
    useEffect(() => {
      const f = ref.current; if (!f) return;
      let doc;
      const words = () => {
        const selection = doc?.getSelection(), quote = selection?.toString().trim();
        if (s.artifactCommenting || !quote || quote.length < 3 || !selection.rangeCount) { setSelectedWords(null); return; }
        const frame = f.getBoundingClientRect(), scale = frame.width / f.offsetWidth;
        const rects = Array.from(selection.getRangeAt(0).getClientRects()).filter(r => r.width > 0).map(r => ({ x: frame.left + r.left * scale, y: frame.top + r.top * scale, w: r.width * scale, h: r.height * scale }));
        if (rects.length) setSelectedWords({ quote: quote.slice(0, 600), rects });
      };
      const apply = () => { try { doc = f.contentDocument; doc.documentElement.dataset.theme = theme; doc.addEventListener("selectionchange", words); doc.addEventListener("scroll", () => setSelectedWords(null), { once: true }); } catch (e) {} };
      f.addEventListener("load", apply); apply();
      return () => { f.removeEventListener("load", apply); doc?.removeEventListener("selectionchange", words); };
    }, [theme, d.id, canvas, s.artifactCommenting]);
    useEffect(() => { app.set({ artifactCommenting: false, artifactSpot: null }); setSelectedWords(null); }, [d.id]);
    // Fold one view group into More view options per pass while the title is cut or the bar overflows (ArtifactPage.tsx).
    const [measuredFold, setFold] = useState(0);
    const fold = app.width <= 480 ? 3 : measuredFold;
    React.useLayoutEffect(() => {
      const bar = document.getElementById("artifact-header");
      if (!bar || fold >= 3) return;
      const cut = Array.from(bar.querySelectorAll(".dv-title")).some((el) => el.scrollWidth > el.clientWidth + 1);
      // The bar's own children, not tooltips drawn past its edge.
      const edge = bar.getBoundingClientRect().right - parseFloat(getComputedStyle(bar).paddingRight) + 1;
      if (cut || Array.from(bar.children).some((el) => el.getBoundingClientRect().right > edge)) setFold(fold + 1);
    });
    useEffect(() => setFold(0), [d.id, s.navOpen, s.railOpen, s.full]);
    useEffect(() => { const again = () => setFold(0); window.addEventListener("resize", again); return () => window.removeEventListener("resize", again); }, []);
    const back = s.readFrom || { label: "Back to " + STEP_LABEL[s.route.step || "plan"] };
    const agentChip = app.v.agent;
    // A working draft of this task, never the Library's copy: what it drafts on links to that artifact, and Save to library is one step away.
    const base = QL.draftOf(d.id, s);
    const baseRec = base && !base.gone ? (s.lib || []).find((x) => x.id === base.id) : null;
    const saveToLibrary = () => { QL._libReturn = document.activeElement; app.set({ pop: null, dialog: "lib-save", libTarget: { draft: d.id } }); };
    const relation = (
      <span className="dv-rel">
        <span className="dv-kind" title="A working artifact of this task. It stays in this task's Files until you save it to the Library or Verify folds it in.">Draft</span>
        {baseRec ? <button type="button" className="dv-on" title={"Open " + baseRec.title + " in the Library"} onClick={() => QL.openLibrary(app, baseRec, { page: base.pages[0] || null })}><Icon name="layers" size={13} /><span className="dv-on-t">on {baseRec.title}{base.pages.length ? " › " + base.pages.join(", ") : ""}{base.archived ? " (archived)" : ""}</span></button>
          : base && base.gone ? <span className="dv-on off">its base was deleted</span>
          : <button type="button" className="dv-on" onClick={saveToLibrary}>not in the Library · Save…</button>}
      </span>
    );
    if (canvas)
      return (
        <div className="main" style={{ minHeight: 0 }}>
          <ArtifactCanvas app={app} current={d.id} theme={theme} onClose={() => setCanvas(false)} onFocus={(id) => { setCanvas(false); app.set({ route: Object.assign({}, s.route, { artifactId: id }) }); }} />
        </div>
      );
    return (
      <div className="main" style={{ minHeight: 0 }}>
        <div className="dv-bar compact-tools" id="artifact-header" data-screen-label="Task artifact · its bar and Back to the step">
          {/* Back to the step is a real button first in the bar; the title names this draft and its page once. */}
          <Btn sm icon="arrow-left" className="dv-back" onClick={() => app.unread()}>{back.label}</Btn>
          <span className="dv-title" title={d.title + (base && base.pages.length ? " · " + base.pages[0] : "")}><b>{d.title}</b></span>
          {relation}
          <span className="sp" />
          {/* ArtifactPage.tsx's order: zoom, theme and device, which fold into More view options (device first) while the
              title is cut or the bar overflows; then Give feedback and More. Full screen is in More's place only while on. */}
          {fold < 3 ? <span className="artifact-header-zoom zoom-group" role="group" aria-label="Zoom"><IconBtn icon="zoom-out" label="Zoom out · −" onClick={() => setZoom((z) => Math.max(25, z - 25))} /><button type="button" className="btn sm" aria-label={zoom === 100 ? "Fit the width" : zoom + " %, fit the width"} title="Fit the width · 0" onClick={() => setZoom(100)}>{zoom === 100 ? "Fit" : zoom + "%"}</button><IconBtn icon="zoom-in" label="Zoom in · +" onClick={() => setZoom((z) => Math.min(200, z + 25))} /></span> : null}
          {fold < 2 ? <span className="artifact-header-seg" role="group" aria-label="Theme">{[["light", "sun", "Light"], ["dark", "moon", "Dark"]].map(([value, icon, label]) => <IconBtn key={value} icon={icon} label={label} on={theme === value} aria-pressed={theme === value} onClick={() => setTheme(value)} />)}</span> : null}
          {fold < 1 ? <span className="artifact-header-seg" role="group" aria-label="Device">{[["desk", "monitor", "Desktop"], ["phone", "smartphone", "Phone"]].map(([value, icon, label]) => <IconBtn key={value} icon={icon} label={label} on={device === value} aria-pressed={device === value} onClick={() => setDevice(value)} />)}</span> : null}
          {fold ? <span className="dv-menu dv-view"><IconBtn icon="sliders-horizontal" label="More view options" aria-haspopup="menu" aria-expanded={s.pop === "artifact-view"} on={s.pop === "artifact-view"} onClick={() => app.togglePop("artifact-view")} />{s.pop === "artifact-view" ? <div className="pop menu" role="menu" aria-label="More view options" style={{ right: 0, top: "calc(100% + 6px)" }}>
            {fold >= 3 ? <><QL.MenuItem icon={QL.ICON["zoom.in"]} onClick={() => { setZoom((z) => Math.min(200, z + 25)); app.set({ pop: null }); }}>Zoom in <span className="kbd-hint">+</span></QL.MenuItem><QL.MenuItem icon={QL.ICON["zoom.out"]} onClick={() => { setZoom((z) => Math.max(25, z - 25)); app.set({ pop: null }); }}>Zoom out <span className="kbd-hint">−</span></QL.MenuItem><QL.MenuItem radio checked={zoom === 100} icon={QL.ICON["zoom.fit"]} onClick={() => { setZoom(100); app.set({ pop: null }); }}>Fit the width <span className="kbd-hint">0</span></QL.MenuItem></> : null}
            {fold >= 2 ? <>{fold >= 3 ? <div className="menu-sep" /> : null}{["light", "dark"].map((value) => <QL.MenuItem key={value} radio checked={theme === value} icon={QL.ICON["theme." + value]} onClick={() => { setTheme(value); app.set({ pop: null }); }}>{value === "light" ? "Light" : "Dark"}</QL.MenuItem>)}</> : null}
            {fold >= 2 ? <div className="menu-sep" /> : null}
            {["desk", "phone"].map((value) => <QL.MenuItem key={value} radio checked={device === value} icon={QL.ICON[value === "desk" ? "device.desktop" : "device.phone"]} onClick={() => { setDevice(value); app.set({ pop: null }); }}>{value === "desk" ? "Desktop" : "Phone"}</QL.MenuItem>)}
          </div> : null}</span> : null}
          <span className="tb-sep dv-vs" aria-hidden="true" />
          <span className="artifact-header-feedback-tools artifact-feedback-tools"><button ref={feedbackButton} type="button" className={"btn sm" + (s.artifactCommenting ? " on" : "")} aria-label="Feedback" aria-pressed={s.artifactCommenting} title="Mark a spot or area for feedback" onClick={() => { setSelectedWords(null); app.set({ artifactCommenting: !s.artifactCommenting }); }}><Icon name="message-square-plus" size={14}/><span>Feedback</span></button><ArtifactExportModel app={app} title={d.title} pages={Array.isArray(d.pages) ? d.pages.length : 1}/></span>
          <span className="dv-menu"><IconBtn icon="ellipsis" label="More artifact tools" aria-expanded={s.pop === "artifact-more"} onClick={() => app.togglePop("artifact-more")} />{s.pop === "artifact-more" ? <div className="pop menu" role="menu" aria-label="More artifact tools" style={{ right: 0, top: "calc(100% + 6px)" }}>
            {baseRec ? <QL.MenuItem icon={QL.ICON.library} onClick={() => { app.set({ pop: null }); QL.openLibrary(app, baseRec, { page: base.pages[0] || null }); }}>Open {baseRec.title} in the Library</QL.MenuItem> : null}
            <QL.MenuItem icon={QL.ICON["library.save"]} onClick={saveToLibrary}>Save to library…</QL.MenuItem>
            <div className="menu-sep" />
            {/* On a phone the bar keeps Back, the title and Give feedback; zoom, theme and device move here. */}
            {app.width <= 640 ? <>
              {["light", "dark"].map((value) => <QL.MenuItem key={value} radio checked={theme === value} icon={QL.ICON["theme." + value]} onClick={() => { setTheme(value); app.set({ pop: null }); }}>{value === "light" ? "Light" : "Dark"}</QL.MenuItem>)}
              {["desk", "phone"].map((value) => <QL.MenuItem key={value} radio checked={device === value} icon={QL.ICON[value === "desk" ? "device.desktop" : "device.phone"]} onClick={() => { setDevice(value); app.set({ pop: null }); }}>{value === "desk" ? "Desktop" : "Phone"}</QL.MenuItem>)}
              <QL.MenuItem icon={QL.ICON["zoom.fit"]} onClick={() => { setZoom(100); app.set({ pop: null }); }}>Fit the width</QL.MenuItem>
              <div className="menu-sep" />
            </> : null}
            <QL.MenuItem icon={QL.ICON.history} onClick={() => { setManage(true); app.set({ pop: null }); }}>Source and history</QL.MenuItem>
            <QL.MenuItem icon={QL.ICON.compare} onClick={() => { setCanvas(true); app.set({ pop: null }); }}>Compare artboards</QL.MenuItem>
            <QL.MenuItem icon="external-link" onClick={() => { app.set({ pop: null }); app.toast("Opens " + d.title + " in your browser · simulated"); }}>Open in browser</QL.MenuItem>
            {app.width <= 640 ? <QL.MenuItem icon={QL.ICON.fullscreen} onClick={() => app.set({ full: !s.full, artifactZoom: 100, pop: null })}>{s.full ? "Leave full screen" : "Full screen"}</QL.MenuItem> : null}
            <div className="menu-sep" /><span className="dim" style={{ padding: 10, fontSize: 12 }}>Updated {fmt.ago(Date.now() - d.at)} ago · {d.by}</span>
          </div> : null}</span>
        </div>

        {dragMark ? <div className="artifact-feedback-area" style={{left:Math.min(dragMark.x,dragMark.toX),top:Math.min(dragMark.y,dragMark.toY),width:Math.abs(dragMark.toX-dragMark.x),height:Math.abs(dragMark.toY-dragMark.y)}}/> : null}
        {selectedWords && !s.artifactCommenting ? <button type="button" className="artifact-feedback-selection" style={{ left: Math.max(8, Math.min(selectedWords.rects.at(-1).x, app.width - 112)), top: Math.max(8, selectedWords.rects.at(-1).y - 34) }} onPointerDown={event => event.preventDefault()} onClick={() => openMark({ quote: selectedWords.quote, rects: selectedWords.rects, point: { x: selectedWords.rects[0].x, y: selectedWords.rects.at(-1).y + selectedWords.rects.at(-1).h + 8 } })}><Icon name="message-square-plus" size={14}/>Feedback</button> : null}
        <div className="dv-split">
          <div className="dv-canvas">
            {s.artifactCommenting ? <div className="artifact-feedback-hint" role="status"><Icon name="mouse-pointer-2" size={14}/><span>Click a spot or drag an area</span><button type="button" aria-label="Cancel feedback" onClick={() => { app.set({ artifactCommenting: false }); feedbackButton.current?.focus(); }}>Esc</button></div> : null}
            <div className={"frame " + device} style={{ transform: "scale(" + zoom / 100 + ")", height: device === "phone" ? 760 : "calc(100vh - 150px)", minHeight: 520 }}>
              <iframe ref={ref} title={d.title} srcDoc={QL.artifactDocuments[d.id]} />
              {s.artifactCommenting ? <button type="button" className="dv-spot-target" aria-label="Click a spot or drag an area for feedback" onPointerDown={startMark} onPointerMove={event => { if (dragMark) setDragMark(Object.assign({}, dragMark, { toX: event.clientX, toY: event.clientY })); }} onPointerUp={finishMark} onPointerCancel={() => setDragMark(null)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); const r = event.currentTarget.getBoundingClientRect(); openMark({ quote: d.title, point: { x: r.left + 20, y: r.top + 30 }, pin: { x: r.left + 20, y: r.top + 20 } }); } }}/> : null}

            </div>
          </div>
          {manage ? <ArtifactManage key={d.id} app={app} d={d} onClose={() => setManage(false)} /> : null}
        </div>
      </div>
    );
  }

  // The interaction cards and shared pieces the page frame and the other pages draw with.
  Object.assign(QL, { FoldedDoc, QxTop, AskedOutside, LoadingState, LoadingRail, HomeLoading, NavLoading, Stage, Reader, ArtifactViewer, ArtifactExportModel, ArtifactManage, BuildView, StepDoc, docPage, PlanDoc, YourTurn, Choices, OwnWords, ImplementStart, BatchCard, YourCall, StoppedCard, ReviewMove, FoldCard, ArtifactInCard, ArtifactFrame, Diagram, Blk, MoreIn });
})();
