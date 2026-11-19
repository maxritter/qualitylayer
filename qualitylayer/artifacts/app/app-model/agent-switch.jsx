(function () {
  const QL = window.QL;
  const { useState } = React;
  const { Btn, Icon, IconBtn, Popover, Select, LaunchCard, LaunchFields } = QL;
  const ExistingDialog = QL.AgentDialog;
  const ExistingPanel = QL.AgentPanel;
  const ExistingMenu = QL.AgentMenu;
  if (window.QL_SWITCH_PREVIEW) {
    window.QL_PAGE_PRESET = { ...window.QL_PAGE_PRESET, route: { view: "task", step: "plan" }, reading: true, navOpen: false, phoneTab: "agent" };
  }
  const nameOf = QL.agentNameOf;
  const openSwitch = (app) => app.set({ agentDialog: "switch", switchHistory: false, pop: null });
  const folderOf = (app) => app.s.taskWorkspace?.path || QL.launchDefaults(app).checkout;
  const showHistory = (app, run) => app.set({ switchHistory: run.id, pop: null });
  const selectedHistory = (app) => app.s.switchHistory === app.s.run?.id
    ? app.s.run
    : app.s.previousAgentRun || app.s.run;

  function Folder({ app }) {
    const folder = folderOf(app);
    return <div className="switch-folder" title={folder}><Icon name="folder" size={14}/><b>{folder.split(/[\\/]/).filter(Boolean).at(-1)}</b><code>{folder}</code></div>;
  }

  function SwitchDialog({ app }) {
    const prior = app.s.run;
    const current = prior?.agent || "claude";
    const other = QL.installedAgentsOf(app).find(agent => agent.value !== current)?.value;
    const [value, setValue] = useState(() => QL.launchDefaults(app, { agent: other || current, works: "checkout" }));
    const [permission, setPermission] = useState("own");
    const [bypassConfirmed, setBypassConfirmed] = useState(false);
    const [step, setStep] = useState("choose");
    const [failure, setFailure] = useState("");
    const active = prior && !["stopped", "failed"].includes(prior.state);
    const ready = value.agent !== current && value.agent !== "other" && !failure && (permission !== "bypass" || bypassConfirmed);
    const modes = (QL.AgentPerms || {})[value.agent] || [];
    const close = () => app.set({ agentDialog: null });
    const change = patch => {
      setValue(now => ({ ...now, ...patch }));
      setFailure("");
      if (patch.agent) { setPermission("own"); setBypassConfirmed(false); }
    };
    const continueTask = () => {
      if (!ready) return;
      if (active) { setStep("stopping"); return; }
      const id = "example-new-" + value.agent;
      app.set({
        previousAgentRun: prior,
        run: { ...prior, id, nativeSession: "illustrative-new-conversation", agent: value.agent, model: value.model, effort: value.effort, permission, state: "running", phase: "building" },
        sessionPermissions: { ...app.s.sessionPermissions, [id]: permission },
        cvState: "ready", agentView: "conversation", agentDialog: null, switchComplete: true, switchHistory: false,
      });
    };
    return <div className="switch-preview-card"><LaunchCard app={app} title={active ? "Stop and continue in another agent" : "Continue in another agent"} onClose={close} actions={<><Btn onClick={close}>Cancel</Btn>{step === "choose" ? <Btn pri disabled={!ready} onClick={continueTask}>{active ? "Stop & continue with " + nameOf(value.agent) : "Continue with " + nameOf(value.agent)}</Btn> : null}</>}>
      <section id="agent-switch" data-screen-label={active ? "Switch a running agent" : "Choose another agent"} className="switch-choice">
        <p className="switch-task">{QL.data.task.title}</p>
        <p className="switch-lead">{active ? nameOf(current) + " is still working. Stop its session before a replacement starts." : nameOf(current) + (prior?.phase === "planning" ? " has stopped. Continue planning with another installed agent." : " has stopped. Continue the approved work with another installed agent.")}</p>
        {step === "stopping" ? <div className="switch-stopping" role="status">
          <Icon name="loader-circle" size={16} className="mt-spin"/><b>Waiting for {nameOf(current)} to stop</b>
          <p>No replacement starts until the current session has ended.</p>
          <div className="switch-example-controls"><span>Illustrative transition</span><Btn sm onClick={() => { app.set({ run: { ...prior, state: "stopped" }, cvState: "stopped" }); setStep("choose"); }}>Show stopped example</Btn><Btn sm onClick={() => { setStep("choose"); setFailure("The current agent could not be stopped. It is still running; no replacement started."); }}>Show failed stop</Btn></div>
        </div> : <>
          <LaunchFields app={app} value={value} onChange={change} scope="Continue task" workspace={false} location={false}/>
          {value.agent === current ? <p className="switch-validation">Choose a different agent, or Cancel to resume the previous conversation.</p> : null}
          {modes.length ? <label className="switch-permission">Permissions<Select label="New conversation permissions" width={150} value={permission} options={modes.map(([value, label]) => ({ value, label, icon: QL.ICON["perm." + value] || "sliders-horizontal" }))} onChange={next => { setPermission(next); setBypassConfirmed(false); }}/></label> : <p className="dim">This agent's native settings control its permissions.</p>}
          {permission === "bypass" && !bypassConfirmed ? <div className="cv-permission-confirm"><b>Use {modes.find(mode => mode[0] === "bypass")?.[1]}?</b><p>This new conversation skips the agent's normal permission checks.</p><div className="row"><Btn sm onClick={() => setPermission("own")}>Cancel</Btn><Btn sm onClick={() => setBypassConfirmed(true)}>Use for this conversation</Btn></div></div> : null}
          <Folder app={app}/>
          <div className="switch-kept"><Icon name="clipboard-check" size={15}/><span><b>{prior?.phase === "planning" ? "Same task" : "Same approved task"}</b><span>Plan, answers, current work and approvals stay.</span></span></div>
          <p className="switch-note">A new conversation starts. The previous conversation stays in History.</p>
          {failure ? <p role="alert" className="agent-validation">{failure} <button type="button" className="lnk" onClick={() => setFailure("")}>Try again</button></p> : null}
        </>}
      </section>
    </LaunchCard></div>;
  }

  QL.AgentDialog = function ProposedAgentDialog({ app }) {
    return app.s.agentDialog === "switch" ? <SwitchDialog app={app}/> : <ExistingDialog app={app}/>;
  };

  QL.AgentPanel = function ProposedAgentPanel({ app }) {
    if (!window.QL_SWITCH_PREVIEW) return <ExistingPanel app={app}/>;
    if (app.s.switchHistory) {
      const previous = selectedHistory(app);
      return <div className="switch-panel"><div className="switch-history-bar"><Btn sm icon="arrow-left" onClick={() => app.set({ switchHistory: false })}>Back</Btn><span>{nameOf(previous?.agent)} · prior conversation · read only</span></div><QL.PriorConversationTranscript app={app} agent={previous.agent}/></div>;
    }
    const stopped = app.s.run && ["stopped", "failed"].includes(app.s.run.state);
    if (app.s.switchComplete && !stopped) return <div className="switch-panel"><div className="switch-history-bar"><span><b>{nameOf(app.s.run.agent)}</b> · new conversation</span><button type="button" className="lnk" onClick={() => showHistory(app, app.s.previousAgentRun)}>Previous conversation</button></div><ExistingPanel app={app}/></div>;
    if (!stopped) return <ExistingPanel app={app}/>;
    return <section className="switch-ended" id="agent-switch-entry" data-screen-label="Continue a stopped task">
      <h2><QL.AgentMark agent={app.s.run.agent} size={18}/>{nameOf(app.s.run.agent)} stopped</h2>
      <p>Your task, draft and current work are kept.</p>
      <Folder app={app}/>
      <Btn pri onClick={() => openSwitch(app)}>Continue in another agent…</Btn>
      <div className="switch-ended-links"><button type="button" className="lnk" onClick={() => app.set({ run: { ...app.s.run, state: "running" }, cvState: "ready" })}>Resume previous session</button><button type="button" className="lnk" onClick={() => showHistory(app, app.s.run)}>Read previous conversation</button></div>
    </section>;
  };

  QL.SwitchHistoryMenu = function SwitchHistoryMenu({ app }) {
      const prior = app.s.previousAgentRun;
      const open = app.s.pop === "history-controls";
      return <span className="agent-menu-anchor">
        <IconBtn icon="ellipsis" label="Agent controls" sm on={open} onClick={() => app.togglePop("history-controls")}/>
        <Popover open={open} onClose={() => app.set({ pop: null })} className="agent-menu" align="right">
          <button type="button" role="menuitem" onClick={() => app.set({ switchHistory: false, pop: null })}><Icon name="arrow-right" size={14}/><span>Current agent</span></button>
          {prior && prior.id !== selectedHistory(app)?.id ? <button type="button" role="menuitem" onClick={() => showHistory(app, prior)}><Icon name="history" size={14}/><span>Earlier conversation · {nameOf(prior.agent)}</span></button> : null}
        </Popover>
      </span>;
  };

  // The existing menu retains its controls; this adjacent shortcut opens the same chooser.
  QL.AgentMenu = function ProposedAgentMenu({ app }) {
    if (app.s.switchHistory) return <QL.SwitchHistoryMenu app={app}/>;
    return window.QL_SWITCH_PREVIEW ? <span className="switch-menu"><QL.IconBtn icon="arrow-right-left" sm label="Continue in another agent" onClick={() => openSwitch(app)}/><ExistingMenu app={app}/></span> : <ExistingMenu app={app}/>;
  };
})();
