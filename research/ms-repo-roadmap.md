# Research: `microsoft/power-platform-playwright-samples` roadmap overlap

Resolves #17.

Target repo: https://github.com/microsoft/power-platform-playwright-samples
(confirmed via `gh api repos/microsoft/power-platform-playwright-samples` —
created 2026-03-13, last push 2026-08-11, not archived, Issues enabled,
Discussions **disabled**, Projects flag enabled but not queryable with the
token scopes available in this session — see Methodology/Limitations below.)

Method: primary sources only, via `gh api` / `gh issue list` / `gh pr list` /
`gh api search/commits` / `gh api .../commits?path=...` /
`gh api .../actions/workflows/.../runs` against the live repo. No README-only
speculation — every claim below is a direct query result with a link.

## 1. Self-healing / auto-fixing failing tests

**No evidence of planned or in-progress work.**

Checked and confirmed empty/negative:
- All issues (open + closed, `gh issue list --state all`): only 2 total,
  both closed in March 2026 and unrelated (#1 "missing a LICENSE file",
  #3 "missing important files").
  https://github.com/microsoft/power-platform-playwright-samples/issues/1
  https://github.com/microsoft/power-platform-playwright-samples/issues/3
- All 50 PRs (open+closed+merged, `gh pr list --state all`): no title
  referencing healing, self-healing, auto-fix, or auto-repair of tests.
  Full list: https://github.com/microsoft/power-platform-playwright-samples/pulls?q=is%3Apr
- Commit-message search (`gh api search/commits`) for `heal`, `auto-heal`:
  zero hits. `auto-fix` returns two unrelated commits (auth-state cleanup,
  a CI fix) — neither about test self-healing:
  https://github.com/microsoft/power-platform-playwright-samples/commit/79236daf
  https://github.com/microsoft/power-platform-playwright-samples/commit/b7ca9738
- README.md (fetched in full): the only "auto"/scaffold-adjacent feature is
  the `/pp-author` AI-DX slash command, which scaffolds a **new test file**
  using existing Page Objects + Playwright MCP for live selector capture —
  this is AI-assisted test *authoring*, not self-healing of failing tests.
  https://github.com/microsoft/power-platform-playwright-samples/blob/main/README.md#L393-L397
  (added in PR #31, "feat(ai-dx): add validate/diagnose/author workflows",
  https://github.com/microsoft/power-platform-playwright-samples/pull/31)

Conclusion: no roadmap signal for self-healing/auto-fixing tests anywhere in
issues, PRs, or commit history.

## 2. Canary / scheduled nightly health-check testing

**No evidence of planned/in-progress *new* work — and direct evidence they moved away from scheduled runs.**

- The repo *did* run E2E tests on a scheduled cadence at one point: PR #35
  ("chore(ci): disable scheduled E2E cron — pipeline is now manual-trigge…",
  merged 2026-05-11) removed a **daily weekday 06:00 UTC** cron trigger from
  `.azure-pipelines/e2e-tests.yml`, converting it to manual-dispatch only.
  PR body: "Tests run against a live Power Platform tenant, so the team
  wants to launch them on demand rather than on a fixed cadence."
  https://github.com/microsoft/power-platform-playwright-samples/pull/35
- No issue, PR, or commit message (searched `canary`, `nightly`, `scheduled`)
  proposes reinstating or expanding scheduled/canary health-check runs.
  Commit search for `canary`: zero hits.

Conclusion: the direction of travel is the opposite of a canary/nightly
initiative — Microsoft explicitly disabled their one scheduled test run in
favor of on-demand execution, and there is no visible plan to reintroduce
scheduled health checks.

## 3. Dataverse solution-XML parsing / scaffolding

**No evidence of planned or in-progress work.**

- Commit search for `solution.xml`, `customizations.xml`, `scaffold`: zero
  hits in all three.
- The only PR with "scaffold" in its title, #40 ("feat: initial scaffold for
  Veltro Novo E2E tests", closed/not merged 2026-05-29), is an external
  fork's contribution adding a hand-written Page Object for a specific Code
  App (Veltro Novo) — unrelated to generating tests from exported Dataverse
  solution XML. https://github.com/microsoft/power-platform-playwright-samples/pull/40
- No open issue references Dataverse solution export, customizations.xml,
  or code generation from solution files.

Conclusion: no roadmap signal for solution-XML-driven test scaffolding.

## 4. `deploy-docs.yml` / `packages/docs` Next.js site

**Resolved definitively: the directory existed, then was deliberately removed; the workflow was left stale/broken and still is.**

- `packages/docs` (a Nextra/Next.js docs site) was present from the initial
  commit (`e57b0a09`, 2026-03-17,
  https://github.com/microsoft/power-platform-playwright-samples/commit/e57b0a09)
  through several dependency-bump PRs referencing it (#7, #8, #14, #15, #21,
  #25 — all `bump next`/`bump dompurify`/`bump yaml` "in /packages/docs").
- It was **explicitly deleted** on 2026-04-17 in commit `1ec168c1`,
  "chore: remove packages/docs and typedoc infrastructure":
  https://github.com/microsoft/power-platform-playwright-samples/commit/1ec168c14c99bdca59c602f1170ea4382f08bffa
  Commit message: "Delete packages/docs (Nextra/Next.js site) — no longer
  part of the monorepo... Unregister @power-platform-playwright/docs from
  rush.json... Update README.md and CLAUDE.md to reflect two-package
  structure."
- Current repo tree (`gh api repos/.../contents/packages`, checked live)
  confirms `packages/` now contains only `e2e-tests` and
  `power-platform-playwright-toolkit` — no `docs`.
- **`.github/workflows/deploy-docs.yml` was never updated to match.** It
  still triggers on `paths: packages/docs/**`, still `cd packages/docs &&
  npm run build`, and still uploads `packages/docs/out`. It was touched
  twice after the docs removal (2026-07-14 Rush→npm-workspaces migration,
  2026-07-15 "stabilize formatting checks in CI") without anyone fixing the
  dangling `packages/docs` references:
  https://github.com/microsoft/power-platform-playwright-samples/commits/main/.github/workflows/deploy-docs.yml
- Run history (`gh api .../actions/workflows/deploy-docs.yml/runs`) shows
  **5 total runs, all 5 `conclusion: failure`** (2026-03-18, two on
  2026-03-24, 2026-04-17, 2026-07-15) — it has never once succeeded,
  including runs *before* the docs directory was removed:
  https://github.com/microsoft/power-platform-playwright-samples/actions/workflows/deploy-docs.yml

Conclusion: not "aspirational and never existed" — `packages/docs` was real,
shipped, then intentionally deleted three months later, and the deploy
workflow is simply stale/dead code that nobody has cleaned up (100% failure
rate across its entire run history).

## Methodology / limitations

- GitHub Discussions are disabled on the target repo (`has_discussions:
  false`), so there is no discussions surface to check.
- The repo's Projects flag is `true` but the ProjectsV2 GraphQL API returned
  `INSUFFICIENT_SCOPES` for the token used in this session (needs
  `read:project`, session token only has `gist, read:org, repo, workflow`).
  No classic (REST) project boards were found (`404` on
  `repos/.../projects`). Given zero relevant issues/PRs exist to populate a
  board with, this is a low-risk gap, but a project board with `read:project`
  scope has not been positively ruled out.
- All other primary sources (issues, PRs, commits, commit-scoped file
  history, workflow run history, live file tree, README) were checked in
  full — not sampled.
