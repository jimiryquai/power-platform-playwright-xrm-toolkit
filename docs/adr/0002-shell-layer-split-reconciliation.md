# Reconcile the DOM/shell layer per-component, not uniformly

Unlike the Xrm client-API layer (ADR 0001), where CCA's classes won outright, the shell/DOM layer — Grid, Sidebar, Commanding — does not have a single winning side. Each component was decided independently based on which side actually had deeper coverage for that specific concern, verified against the real source (not the earlier, partially-inaccurate exploration summary — CCA's `Sidebar.ts` in particular was initially misreported as only having a single `navigate()` method, when the real file already implements menus, recent/pinned items, area switcher, and groups).

- **Grid**: CCA's `Grid.ts` is the base (broader coverage: checkbox selection, column header menu/sort, view selector). MS's `GridComponent` contributes two methods CCA lacked: `getCellValue` (col-id/schema-name based cell reading) and `filterByColumn` (per-column "begins with" filter).
- **Sidebar**: CCA's `Sidebar.ts` is ported essentially as-is, exposed as `.sidebar`. This is a pure capability gain, not a reconciliation — MS's toolkit has no dedicated Sidebar component, only two ad hoc methods (`navigateToRuntimeItem`, `expandNavigationGroup`) directly on `ModelDrivenAppPage`.
- **Commanding/Button**: the only component where MS wins outright. MS's `CommandingComponent` is more mature (context-aware Form/Grid/SubGrid command bars, many named convenience methods, overflow-menu handling, enabled/visible checks, `executeCommand(dataId)`) and already covers everything CCA's `Button.ts` did. CCA's `Button.ts` — which was also mis-homed under `framework/xrm/` despite being DOM/ribbon-oriented, not an Xrm-API wrapper — is dropped entirely.

Deciding per-component rather than picking one side for the whole shell layer avoided two bad outcomes: discarding MS's `getCellValue`/`filterByColumn` (real gaps in CCA) purely for the sake of "CCA is the base," and discarding MS's materially better `CommandingComponent` purely for consistency with the Grid/Sidebar decisions.

Decided via the wayfinder map's ["Reconcile the DOM/shell layer (Grid, Sidebar/Commanding)"](https://github.com/jimiryquai/power-platform-playwright-xrm-toolkit/issues/3) ticket.
