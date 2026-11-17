# Continue in another agent

Status: Max approved the displayed `app-ui-14-2` design on16November2026, revision75445da8a5ad7345e3ce5563032658adc48ddfbd38f0ba2355b12af811607ee4. Implementation and actual App parity remain pending.

The current task's agent controls offer deliberate continuation in another installed native agent. A stopped task also offers its previous session and read-only history. The chooser reuses the launch agent, model and effort controls and the agent's native permission choices. Bypass requires explicit confirmation for this new conversation. The checkout stays visible and unchanged.

The existing Stop owner must confirm that the old generation has ended before Start can launch the replacement. An incomplete or failed Stop starts nothing. Cancel before Start prevents the replacement; a failed Start keeps the choices and the stopped session's history. No other agent is selected or started as a fallback. Launch choices affect this conversation only, without changing global profiles or saved defaults.

The replacement starts a new native conversation on the same task and checkout. The Plan, answers, current work and approval records retain their identities and authority. Existing build handoff and approval requirements are not bypassed. The previous conversation opens through the existing read-only history surface: no composer, resume, settings or agent-switch action can control it there. Current native-session and generation checks still own control.

Archived tasks, historical seven-step tasks, unsupported hosting and non-task or outside sessions keep their existing read-only or supported continuation paths. This introduces no migration, new workflow stage, background quota retry or provider fallback. A quota-related stop uses the same deliberate choice; only actual reported errors are shown.

The sidebar reserves at least one control's width and grows to fit both the agent-switch action and the existing session menu. Both controls retain their natural width and complete hit targets; neither is clipped or shrunk into the other.
