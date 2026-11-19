# Artifact viewer stability contract

The canonical artifact collaboration and loading pages retain their existing controls and layout. Their source consumer is `src/ui/artifact/ArtifactPage.tsx`, carried by `src/ui/artifacts/ArtifactRoute.tsx`.

The approved compact Export and one-shot Feedback controls apply to task and Library viewers. Export opens the small three-format card (PDF, Images, Web page), defaults to PDF and All pages when several pages exist, and retains the filename and retry state. Model interactions are explicitly simulated and never claim to create a file. Existing Copy, navigation, view and agent controls remain in place.

The artifact remains interactive until Feedback is explicitly armed. One spot or area opens the existing quick field and disarms marking; Cancel or Escape restores normal interaction and focus. Selecting words only offers a Feedback chip, and copying remains ordinary copying. The quick field opens only when that chip is chosen. Changing page or leaving the viewer clears an armed mark and stale selected-word context. These controls do not change message delivery, approval or source-revision authority.

Non-gallery artifact reads (Plan previews, compact Files, individual task/Library viewers and Review draft status) request metadata without queuing thumbnails; the Artifacts gallery keeps its default thumbnail renderer.

The selected artifact page's valid numeric viewport is its desktop drawing width. Switching pages reads that page's own declaration; a page without one keeps the existing artifact-width/default fallback. Deliberately wider content can still expand the canvas, and the person's Phone viewport choice remains 390 pixels. Zoom and page navigation retain their existing behavior. This applies to Library artifacts as well as task artifacts; a Library metadata carrier with no width must not replace a page's declared width with 1280 pixels.

Verification uses the actual source viewer and its sandboxed page, including custom-width entry and secondary pages, default fallback, desktop/Phone choice and zoom. Source captures are evidence for this existing layout, not a new simplified model drawing or a claim that the desktop App supports phones.

Named sections can appear after the page loads. A valid section carries its unique id and data-screen-label on the same element. The frame reports added, removed or renamed sections even when its outer dimensions stay fixed; a person does not need to resize the viewer or switch themes to make a late section available. Part-affecting DOM changes reuse the existing animation-frame scheduling and unchanged-layout deduplication. Ordinary text changes do not cause repeated section scans, and frame-owned observers are disconnected when the frame leaves. Existing no-network, sandbox, explicit missing/ambiguous section and source revision boundaries remain unchanged.

Ask agent on an artifact spot opens the existing native Conversation with a compact removable context attachment and an editable ordinary message. It carries the exact artifact identity, selected page, stable section or spot, quote and source revision. Before staging context, read the existing source context and require that page's rendered server HTML to be byte-identical to the shown server HTML, before frame/query/theme presentation. The selected page/query/source epoch must still match after these asynchronous reads. A newly current context revision alone is not evidence for an older displayed screen. A failed read or stale revision keeps the request available for retry. Opening context never posts an annotation, starts a helper, submits native input or grants approval. The person sends through native input, or explicitly copies the request for a terminal-only agent. Existing native launch, question, permission, queue, retry and draft recovery behavior remains authoritative. A successful HTTP start records a run, not native consumption. Until the matching run generation has a native session and its first accepted native user-prompt observation, the original message, context and File references stay editable in the existing pending surface, including after asynchronous startup failure. Native consumption clears only that submitted snapshot; later edits and other targets remain unsent. The initial launch request is never sent a second time when the session becomes ready. A lost start response leaves delivery uncertain: the existing bounded pending slot retains the submitted snapshot identity, captured source revision and start key across remount. An explicit unchanged retry recovers that original logical submission with its captured source revision, request and key; it does not relabel the request as current source. A changed message, attachment identity, target or agent settings establish a separate launch. A later matching native observation consumes only its own snapshot, without automatically resubmitting it. A refused start keeps the editor and explicit retry available.

Standalone artifact sidebars contain Conversation, Terminal and Files, in that order. Files retains metadata, source editing, revisions, recovery and the tasks changing the artifact. The Library viewer keeps Rename, Duplicate and Copy or show in another project as direct utilities while they fit; its four fold levels put utilities into Artifact actions first and Archive/Restore and Delete there at level four. Returning room unfolds one level at a time with the existing 20 px margin. The menu retains Favorites, Artifact information and history, Source and history, and local browser preview; it adds no Agent or Share shortcut. Hosted Claude publication, comment import and human sharing controls are retired; historical link metadata remains local data.

Annotation history in Files leads with readable historical text and the source, date, author and context when known. Original JSON and unknown fields remain available in an explicit Original record disclosure and Copy original record. Back to records returns keyboard focus to its row. Available attachments download through opaque snapshot/entry/asset references; missing or unsafe attachments have an unavailable state. A failed record read retains its row and offers Try again. No record creates an answer, approval, agent message, delivery state or thread action.

The artifact-only status contract distinguishes verified absence from ready and preserved history. Preserved unprepared, incomplete, busy, late-write, invalid, conflict, limit, changed and fault states keep all available saved versions and current source readable. A version picker distinguishes a saved immutable archive from current source that is not archived. Malformed source remains plain original text; undecodable bytes have an inert download rather than a lossy text conversion. Original-source and attachment references contain opaque snapshot/source or snapshot/entry/asset identities, never filesystem paths. A read failure or completed-reader 404 cannot hide historical content or establish absence. The artifact-only data upgrade and its writer/alias qualification remain a separate source prerequisite before Feedback retirement.

The canonical `artifact-header.html?archive=complete|entry|missing|unsafe|unavailable` states and each preserved reason above use explicitly illustrative record content and attachment bytes. `archive=invalid&format=bytes` shows undecodable original bytes; `archive=absent` models positively verified absence. They perform no migration or service call. The known remark, source and date are historical labels only; they transfer no approval, question-answer or native input authority.

On each standalone open attempt, read status first. Make at most one artifact-only upgrade request when preserved history has a readable current source and the reason is unprepared, incomplete or late-write. Keep the current evidence visible during the save and on failure. Ready and verified absent states need no upgrade. Background polling never saves history. Save history or Save new history explicitly rereads status and may make one eligible save; Load history again only rereads unavailable, invalid, busy, fault or limit evidence. These actions do not loop and never apply to Task records. The version picker and Original record disclosure reuse the App's dropdown and fold components.

The task sidebar and foreground build dialog share a stable parent portal through desktop/compact resizing. Only a visible compact sidebar mounts its popup; desktop adds no hidden focus manager or second agent anchor. The nested build dialog retains its form and the existing AgentSurface host. Native child/parent semantics own dismissal; closing restores the current task's opener and preserves the sidebar. Geometry, controls, wording, approvals and input authority stay unchanged. Real task/artifact resize, keyboard, form and native-window parity remains pending.

## Screenshot evidence

Returning from a task artifact restores the document's remembered position while
late preview layout and sidebar transitions settle, correcting movement in either
direction. Wheel, touch, pointer or keyboard input gives control back to the reader.

Keep the complete screenshot pixels and their embedded annotations readable. The existing Enlarge screenshot hint sits below the image inside its existing button, followed by the existing external caption. It must not paint over either caption. Enlarging, Fit image/Actual size, Escape and focus return keep their existing behavior; a longer external caption wraps in the page's normal flow.

Review comparisons adapt to their available pane width. Artifact and Built stack
when the comparison is narrow, including beside an open sidebar in a wide window.
The artifact kind stays one word; its path and sandbox status wrap while the
fullscreen action stays visible. Captured pixels, source identity, enlargement
and keyboard behavior are unchanged. The actual Review consumer is the visual
reference for this state, including both themes at a700px page width.

Conversation reads the native session's saved messages as soon as that session is first observed, including when a quick reply has already finished. An earlier read before the session existed must not delay this discovery until another terminal event. The existing missing-record retry interval still applies within the same session; a changed or removed session never shows the previous session's messages.

## Illustrative billing page

The account tile and selected billing-mode button use the normal ink colour on
their blue-tinted backgrounds. The tint carries selection; readable text keeps
the same contrast in light and dark themes. These illustrative controls do not
change account permissions or billing behavior.

Terminal build approval saves pending feedback first and starts only after an
approved response. A changed or turned approval keeps the existing refusal
message and does not report a build start. Late artifact metadata establishes
the tracked revision so later dependency revisions still refresh the preview.
Sections navigation scrolls to and focuses the current document's section heading, including headings with a status mark. When the document has no matching section or heading, navigation returns to its top.
