---
mode: agent
description: Run the Power Platform Playwright sample suite end-to-end. Walks the user through prerequisites, .env, auth, and a chosen Playwright project, then parses results and explains failures using CLAUDE.md anti-patterns.
---

# Validate the Power Platform Playwright test suite

You are an assistant for the [jimiryquai/power-platform-playwright-xrm-toolkit](https://github.com/jimiryquai/power-platform-playwright-xrm-toolkit) repo. Your job in this prompt is to run the Playwright tests end-to-end and report the results.

You must read [CLAUDE.md](../../CLAUDE.md) before deciding how to act — it documents the suite layout, the env file, the `playwright-ms-auth` storage state, the project list, and the merged (DOM/shell-layer + Xrm-layer) anti-patterns that explain most failures.

## Constants

This is an **npm workspaces** monorepo (`package.json` declares `"workspaces": ["packages/*"]`) —
there is no Rush, and no `rush.json`.

- Repo root: the workspace root (the folder containing `package.json` with the `packages/*` workspace)
- Suite root: `packages/e2e-tests/`
- Toolkit root: `packages/power-platform-playwright-toolkit/`
- Env file: `packages/e2e-tests/.env` (gitignored — copy from `.env.example`)
- Auth state directory: `packages/e2e-tests/.playwright-ms-auth/`

## Step 0 — Prerequisites (report ✅ / ❌ for each)

1. `package.json` at the workspace root declares the `packages/*` workspace
2. `packages/e2e-tests/playwright.config.ts` exists
3. Node.js ≥ 20 (`node --version`)
4. npm installed (Node.js 20+)
5. Microsoft Edge installed (the tests use `channel: 'msedge'`)
6. `packages/power-platform-playwright-toolkit/dist/` exists (run `npm install && npm run build` if missing)
7. `packages/e2e-tests/node_modules/@playwright/test` exists

If anything fails, fix it (or instruct the user) before continuing.

> **Reminder (CLAUDE.md §11):** the e2e-tests package imports the **compiled** toolkit. Any change to toolkit source needs `npm run build:toolkit` before the change takes effect.

## Step 1 — Collect settings (single message)

If `.env` already exists with all required keys, ask whether to keep / overwrite / edit. Otherwise ask **all** of the following at once:

1. `POWER_APPS_BASE_URL` (default: `https://make.powerapps.com`)
2. `POWER_APPS_ENVIRONMENT_ID`
3. `MODEL_DRIVEN_APP_URL` (full URL including `?appid=`)
4. `CANVAS_APP_ID`
5. `CANVAS_APP_TENANT_ID`
6. `MS_AUTH_EMAIL`
7. Auth method (Password or Certificate)
8. (If Password) `MS_USER_PASSWORD`
9. (If Cert) `MS_AUTH_LOCAL_FILE_PATH` and optional `MS_AUTH_CERTIFICATE_PASSWORD`
10. `AZURE_TENANT_ID`
11. `GEN_UX_APP_URL` (optional — leave blank to skip `gen-ux-runtime`)
12. Which Playwright project: `all` / `canvas-app` / `model-driven-app` / `studio-authoring` / `gen-ux-runtime` / `default`
    (`custom-page` is commented out in `playwright.config.ts` — the stock Northwind solution ships no custom page; don't offer it, Playwright would report "no tests found")

    **`default`/`all` caveat**: `default`'s `testDir` includes `tests/northwind/mda/*.test.ts`,
    but its `storageState` is hardcoded to the Canvas auth file, never the MDA one — MDA tests
    run under `default` hit the wrong domain and fail on authentication. Prefer `model-driven-app`
    explicitly for MDA coverage. `all` runs every configured project including `default`, so
    canvas/MDA/gen-ux tests already covered by their own named projects run again under
    `default` (with the MDA subset failing there) — warn the user before they read the
    duplicated/failed counts as regressions.
13. Headed mode? (default: no)

## Step 2 — Write .env

Update `packages/e2e-tests/.env` preserving any keys not collected. Apply CI/headful defaults:

```
MS_AUTH_HEADLESS=false
MS_AUTH_WAIT_FOR_MSAL_TOKENS=true
MS_AUTH_MSAL_TOKEN_TIMEOUT=30000
MS_AUTH_STORAGE_STATE_EXPIRATION=24
AUTH_ENDPOINT=https://login.microsoftonline.com
```

Confirm the keys back to the user with secret values masked as `***`.

## Step 3 — Manage auth storage state

Two storage state files (different domains):

- Canvas / Studio / Gen UX runtime → `.playwright-ms-auth/state-<email>.json` (created by `npm run auth:headful`)
- MDA → `.playwright-ms-auth/state-mda-<email>.json` (created by `npm run auth:mda:headful`)

If a state file is missing or older than 24 hours, run the appropriate auth command from `packages/e2e-tests/`. If `--skip-auth` is in the user's request, reuse what exists.

## Step 4 — Run the chosen project(s)

```sh
cd packages/e2e-tests
npx playwright test --project=<project> [--headed]
```

Narrate progress as terminal lines appear (Authenticating, Test runner started, Running {project} tests, ✓ pass, ✘ fail, etc.).

## Step 5 — Parse results

Use `playwright-report/index.html` (full report) and any failed-test folders under `test-results/` for trace zips. Render a result banner:

```
╔════════════════════════════════════════════════════════════════════╗
║  Power Platform Playwright Samples — Suite Complete                ║
║  Result: {✅ PASSED / ❌ FAILED}                                    ║
║  Tests:  {N} passed · {N} failed · {N} skipped                     ║
║  Project: {name}                                                   ║
║  Report:  packages/e2e-tests/playwright-report/index.html          ║
╚════════════════════════════════════════════════════════════════════╝
```

For each failure list the test name and the trace command:

```
npx playwright show-trace packages/e2e-tests/test-results/<folder>/trace.zip
```

## Step 6 — Explain failures (use CLAUDE.md anti-patterns)

| Error contains                                           | Likely cause                                    | Fix                                                    |
| -------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| `Authentication tokens have expired`                     | Storage state > 24h                             | Delete `.playwright-ms-auth/state-*.json`, re-run auth |
| `Sorry, we didn't find that app`                         | Wrong CANVAS_APP_ID / POWER_APPS_ENVIRONMENT_ID | Verify in Maker Portal                                 |
| `Describe a page` missing                                | Gen UX not enabled in this env                  | Use a Gen UX–enabled `POWER_APPS_ENVIRONMENT_ID`       |
| `waitForFunction` silent timeout                         | Anti-pattern §1                                 | Options must be in third arg position                  |
| `attribute not found`                                    | Anti-pattern §2 / §2a                           | Inactive record — find an editable one in `beforeEach` |
| `[role="row"]` count off by one                          | Anti-pattern §3                                 | Use `[role="row"][row-index]`                          |
| `setEntityAttribute` saves null                          | Anti-pattern §9                                 | Use `attribute.setValue()` directly                    |
| Canvas Edit field text concatenates                      | Anti-pattern §10                                | `el.evaluate(e => e.select())`                         |
| `Cannot find module 'power-platform-playwright-toolkit'` | Anti-pattern §11                                | `npm run build:toolkit`                                |
| `Attribute '<name>' not found on form`                   | Xrm-layer class throws this deliberately (ADR 0001) | Anti-pattern §9 — verify schema name, rule out §2a first |
| `DuplicateRecordsFoundError`                              | `.entity.save()` hit D365's duplicate-detection dialog | Fix colliding test data, or pass `save(true)` intentionally |

For unrecognised errors, suggest:

```
cd packages/e2e-tests
npx playwright test --debug <failing test path>
```

## Step 7 — Offer to open the report

```
Open the HTML test report? (packages/e2e-tests/playwright-report/index.html)
```

If yes, run `cd packages/e2e-tests && npx playwright show-report`.

## Notes

- **`gen-ux-runtime` auto-skips** when `GEN_UX_APP_URL` is unset — do not flag as a failure.
- **`studio-authoring` requires Gen UX environment** — the "Describe a page" AI button must exist.
- **MDA vs Canvas auth domains** — only run MDA auth if a project actually needs it (cost: ~30s + a browser window).
- **Trace viewer beats everything** — always offer the `show-trace` command for failures.
- **For new test authoring**, switch to `pp-author.prompt.md`.
- **For deeper failure analysis**, switch to `pp-diagnose.prompt.md`.
