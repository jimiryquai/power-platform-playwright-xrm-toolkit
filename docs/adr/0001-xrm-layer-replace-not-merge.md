# Replace MS's monolithic FormComponent with CCA's granular per-concern Xrm classes

The fork's baseline (Microsoft's `power-platform-playwright-toolkit`) wraps the Xrm client API in one `FormComponent`/`form.context.ts` pair covering all form concerns in a single class. The CCA framework being merged in (`framework/xrm/*`) instead splits the same surface into one class per concern — `Attribute`, `Entity`, `WebApi`, `Control`, `SubGrid`, `Form`, `Navigation`, `Tab`, `Section` — each independently testable and each wrapping `window.Xrm.*` via `page.evaluate()`.

We decided to **replace** MS's `FormComponent` with CCA's granular split (exposed as `.attribute`/`.entity`/`.control`/`.subGrid`/`.navigation`/`.tab`/`.section` accessors on `ModelDrivenAppPage`, replacing the single `.form`) rather than merging CCA's methods into MS's existing class shape, or layering CCA's classes alongside MS's as a parallel opt-in API. The granular split is deeper and more testable per-concern, and a monolithic class would likely have been decomposed piecemeal as the fork grew anyway — doing it deliberately now avoids reinventing that split badly later, and avoids leaving two competing ways to do the same thing (the rejected "layer alongside" option).

As part of the same decision: CCA's `RethrownError` (preserves both the test-call-site and browser-side stack trace on `page.evaluate()` failures) is ported and applied fork-wide, not just in this layer — MS's toolkit has no equivalent and Playwright's raw `evaluate()` errors are harder to debug without it. CCA's `XrmHelper` (`waitForXrmReady`/`waitForIdleness`/`waitForFormReady` — polling for Xrm readiness and D365's idle state) is also ported as-is; MS's `page-waiters/` strategy solves a different problem (app-shell load, not Xrm/form idleness) and is left untouched.

## Considered Options

- **Merge into MS's shape**: keep one `FormComponent`, backfill missing methods (WebApi, SubGrid, Navigation, Tab/Section) onto it. Rejected — would produce an increasingly bloated single class rather than the focused, testable split CCA already has.
- **Layer alongside**: keep `FormComponent` for simple cases, add CCA's classes as an opt-in advanced surface. Rejected — leaves two ways to do the same thing, which is confusing for consumers and doubles the maintenance surface.

Decided via the wayfinder map's ["Reconcile the Xrm client-API layer"](https://github.com/jimiryquai/power-platform-playwright-xrm-toolkit/issues/2) ticket.
