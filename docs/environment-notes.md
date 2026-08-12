# Environment notes

Operational facts about the provisioned test environment and the local setup, recorded
because each one cost real debugging time and none of them is discoverable from the code.

Kept separate from `CLAUDE.md` (agent-facing conventions and anti-patterns) and from
`docs/adr/` (decisions with alternatives). This file is for "here is how the world
actually is".

---

## The Dataverse org is not on `crm.dynamics.com`

The provisioned org is `org1b8e393e.**crm11**.dynamics.com` — `crm11` is the UK
datacenter. Regional hosts (`crm4` = Europe, `crm11` = UK, and so on) do **not** contain
the substring `crm.dynamics.com`.

Upstream code assumed they did. `validate-auth-state.ts` filtered CRM cookies with
`domain.includes('crm.dynamics.com')`, which found zero cookies in a perfectly good
storage state and blocked the whole `model-driven-app` project with
"MDA state has no CRM cookies". Fixed in #22 by matching `/(^|\.)crm\d*\.dynamics\.com$/`.

**If you see a Dataverse host treated as absent, check for a hardcoded
`crm.dynamics.com` first.** Grep before assuming the session is broken.

---

## Managed Edge cannot run the auth flow on this machine

`playwright-ms-auth` hardcodes `channel: 'msedge'`. On a corporate-managed device the
Edge process exits the instant the flow reaches `make.powerapps.com/auth`, killing
sign-in before any storage state is saved. The symptom is misleading:

```
Target page, context or browser has been closed
```

It looks like a Playwright bug or a bad password. It is neither — credentials and
environment IDs are fine, and the flow gets all the way past "Stay signed in?".

Set `MS_AUTH_BROWSER_CHANNEL=chromium` in `.env`. See
[ADR 0003](adr/0003-configurable-auth-browser-channel.md) for the full diagnosis.

**Debugging tip that found this:** run the browser with `DEBUG=pw:browser`. That is what
revealed the enterprise IE-mode sitelist and pointed at policy rather than at the code.

---

## `TEST_TIMEOUT=120000` is too low for the MDA suite

`.env.example` suggests `TEST_TIMEOUT=120000`. The `form-context` tests need longer —
`should update and save attribute values` dies at exactly 2.0m with that setting, and the
failure reads as a flake rather than a misconfiguration.

Use the toolkit's own default of **360000** (6 min, `TimeOut.TestTimeout`), which is what
`common.ts` falls back to when `TEST_TIMEOUT` is unset. With it, the MDA suite is 15/15.

Related: the `form-context` tests hunt for an *editable* Northwind order because closed
records render read-only forms where `attributes.forEach()` returns 0 by design — see
CLAUDE.md § 2a. That search is what makes them slow.

---

## Northwind does not ship a custom page

The stock Northwind Traders solution installs **one** model-driven app and **no** custom
pages. The MDA sitemap in this environment contains only "Orders" — confirmed by reading
the live sitemap, and independently by inspecting the solution.

Consequences:

- `tests/northwind/custom-page/custom-page-crud.test.ts` needs an `AccountsCustomPage`
  sidebar item that does not exist. Upstream ships the `custom-page` project **commented
  out** in `playwright.config.ts`, which is consistent with this.
- Enabling those tests requires adding a custom page via the MDA app designer first. That
  is environment provisioning work, not a code change.

---

## Suite runtimes (live tenant, 1 worker)

| Project            | Tests | Wall clock |
| ------------------ | ----- | ---------- |
| `canvas-app`       | 5     | ~1.5 min   |
| `model-driven-app` | 15    | ~13 min    |

Worth knowing before starting a change that needs an MDA verification loop — budget for
it, or scope the run with a test-name filter rather than re-running the project.

---

## Auth state is minted per domain

Canvas/maker-portal and MDA/CRM are different domains and need **two** storage states:

```bash
npm run auth        # maker portal  -> state-<email>.json
npm run auth:mda    # CRM domain    -> state-mda-<email>.json
```

`auth:mda` reuses the base state, so run it after `auth`, not instead of it. Both expire
after 24 h by file age (`MS_AUTH_STORAGE_STATE_EXPIRATION`).
