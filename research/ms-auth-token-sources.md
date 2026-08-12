# Research: playwright-ms-auth token-source capabilities

Resolves #16.

## Conclusion (short answer)

**No.** `playwright-ms-auth@0.0.19` has no supported path for consuming an
externally-acquired access/refresh token (e.g. from `pac auth`, Azure CLI, or
any other pre-existing MSAL session). Its entire public API is built around
the package **driving its own interactive-style MSAL login in a real Chromium/Edge
browser**, using a `password` or `certificate` that it retrieves from one of
four *credential* providers (Azure KeyVault, local file, environment variable,
GitHub Secrets). All four provider types return a **password string or a
certificate buffer** — never a token. There is no `CredentialType` value for
"token", "bearer", "refresh-token", or similar, and no config field anywhere
in the package that accepts a pre-issued token to seed the browser context.

This means the F9 "inject PAC-CLI tokens" idea is **not trivial via this
package as published** — it would need new code (either forking/patching
`playwright-ms-auth`, or bypassing it entirely and writing Playwright
`storageState`/`localStorage` injection logic directly), not a config flag
this package already exposes.

## Source verified

- Package: [`playwright-ms-auth`](https://www.npmjs.com/package/playwright-ms-auth), MIT, published by `deepakkamboj`.
- GitHub repo: https://github.com/deepakkamboj/playwright-ms-auth
- Version pinned by Microsoft's `power-platform-playwright-samples` toolkit: `0.0.19` (exact pin in `packages/power-platform-playwright-toolkit/package.json`).
- Confirmed the `v0.0.19` git tag resolves to commit
  [`6a1fcfd`](https://github.com/deepakkamboj/playwright-ms-auth/commit/6a1fcfd4bc9a1e7dee03eca5b30cf87f892822ba)
  ("Merge pull request #1 from deepakkamboj/deepak/msal-browser"), and that
  `src/types.ts` is byte-identical between that tag and current `HEAD` — so
  the line references below are exactly what version `0.0.19` ships.

## Evidence

### 1. Only two credential *types* exist, and neither is "token"

`src/types.ts` (line 6):

```ts
/** Supported credential types */
export type CredentialType = "password" | "certificate";
```

Source: https://github.com/deepakkamboj/playwright-ms-auth/blob/6a1fcfd4bc9a1e7dee03eca5b30cf87f892822ba/src/types.ts#L6

The `MS_AUTH_CREDENTIAL_TYPE` env var (used by MS's `.azure-pipelines/steps/e2e-setup.yml`)
maps directly to this union — its only legal values are `password` and
`certificate`. There is no third option.

### 2. Only four credential *providers* exist, all sourcing a secret, not a token

`src/types.ts` (lines 9–13):

```ts
/** Supported credential provider types */
export type CredentialProviderType =
  | "azure-keyvault"
  | "local-file"
  | "environment"
  | "github-secrets";
```

Source: https://github.com/deepakkamboj/playwright-ms-auth/blob/6a1fcfd4bc9a1e7dee03eca5b30cf87f892822ba/src/types.ts#L9-L13

Each provider's config shape (same file, lines 57–104) confirms what it
retrieves:

- `AzureKeyVaultConfig` → `keyVaultEndpoint` + `secretName` (a KeyVault secret — the password or cert)
- `LocalFileConfig` → `filePath` (+ optional `certificatePassword`) — this is the shape MS's `e2e-setup.yml` uses (`MS_AUTH_LOCAL_FILE_PATH` + `MS_AUTH_CREDENTIAL_TYPE=certificate`), pointing at a `.pfx`/cert file, not a token
- `EnvironmentConfig` → `variableName` — an env var holding a password/cert, read directly by this package (distinct from `pac`/`az` CLI token caches)
- `GitHubSecretsConfig` → `repository` + `secretName` (+ optional `token`, which is the *GitHub API token used to fetch the secret*, not an MSAL token)

Source: https://github.com/deepakkamboj/playwright-ms-auth/blob/6a1fcfd4bc9a1e7dee03eca5b30cf87f892822ba/src/types.ts#L57-L104

The result type returned by every provider is likewise password/cert-shaped, never a token:

```ts
/** Result of credential retrieval */
export interface CredentialResult {
  type: CredentialType;
  value: string | Buffer;
}
```

Source: https://github.com/deepakkamboj/playwright-ms-auth/blob/6a1fcfd4bc9a1e7dee03eca5b30cf87f892822ba/src/types.ts#L167-L173

### 3. `authenticate()` always starts a fresh browser session and drives the real login UI

`src/authenticate.ts`:

```ts
const context = await browser.newContext({
  storageState: undefined, // Start with fresh state
});
...
await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
// Verify we're on the Entra login page
const loginEndpoint = config.loginEndpoint || DEFAULT_LOGIN_ENDPOINT;
```

Source: https://github.com/deepakkamboj/playwright-ms-auth/blob/6a1fcfd4bc9a1e7dee03eca5b30cf87f892822ba/src/authenticate.ts#L106-L120

There is no code path that accepts a token/cookie/session and injects it
instead of navigating to the live Entra login page — `storageState` is
explicitly discarded (`undefined`) at the start of every authentication run.
The function then fills the retrieved password or certificate into the
actual Microsoft login form and waits for MSAL to write `accessToken`/`idToken`
keys into `localStorage` before saving Playwright's `storageState` to disk
(lines 356–402, `waitForMsalTokens`).

### 4. `loadStorageState()` only re-reads *this package's own* prior output — it is not an import mechanism

```ts
export async function loadStorageState(config: MsAuthConfig): Promise<string> {
  const storagePath = getStorageStatePath(config.email);
  const isValid = await isStorageStateValid(storagePath, config.storageStateExpiration);
  if (!isValid) {
    throw new Error(
      `Storage state for '${config.email}' does not exist or has expired. ` +
        `Please run authentication first.`
    );
  }
  return storagePath;
}
```

Source: https://github.com/deepakkamboj/playwright-ms-auth/blob/6a1fcfd4bc9a1e7dee03eca5b30cf87f892822ba/src/authenticate.ts#L451-L466

This is a cache-validity check against a file that only `authenticate()`
itself writes (path keyed by email, under `outputDir`). It cannot be pointed
at an arbitrary externally-produced storage state or token — if the file is
missing or expired, it throws and tells the caller to "run authentication
first," i.e. re-drive the browser login.

### 5. The public export surface confirms this is the complete API

`src/index.ts`:

```ts
export { authenticate, loadStorageState } from "./authenticate";
export { loadConfigFromEnv, validateConfig } from "./config";
export { CredentialProviderFactory } from "./providers";
```

Source: https://github.com/deepakkamboj/playwright-ms-auth/blob/6a1fcfd4bc9a1e7dee03eca5b30cf87f892822ba/src/index.ts#L16-L18

No `setToken`, `withToken`, `fromExistingSession`, or similar is exported
anywhere in the package.

### 6. README corroborates — no mention of external CLIs or token import

The published README (https://github.com/deepakkamboj/playwright-ms-auth/blob/6a1fcfd4bc9a1e7dee03eca5b30cf87f892822ba/README.md)
describes the package purely in terms of password/certificate auth against
KeyVault/local-file/env-var/GitHub-Secrets providers. Searching the full
README text for `token`, `pac auth`, `az login`/`azure cli`, and `refresh`
turns up only:
- MSAL's own `accessToken`/`idToken` keys that appear in the browser's
  `localStorage` *after* this package's own login flow completes (used only
  to detect that MSAL has finished initializing — see `MS_AUTH_WAIT_FOR_MSAL_TOKENS`/`MS_AUTH_MSAL_TOKEN_TIMEOUT`), and
- `MS_AUTH_GITHUB_TOKEN`, which is a GitHub PAT used to authenticate to the
  GitHub Secrets API, unrelated to Entra/MSAL tokens.

Nothing in the README references `pac auth`, Azure CLI, or importing an
externally-obtained token/session.

## Implication for F9 ("auth-sharing" ticket on the map)

Since `playwright-ms-auth` has no externally-supplied-token credential type,
building "inject PAC-CLI tokens" support is **new work**, not a config
change. Two realistic paths, neither of which uses this package's advertised
extension points:

1. Bypass `playwright-ms-auth` for this scenario and write a small custom
   helper that takes a `pac auth`/Azure CLI-acquired token and constructs a
   Playwright `storageState` (or seeds `localStorage`) directly — mirroring
   what `authenticate()` does internally after login, but skipping the actual
   browser-driven sign-in.
2. Fork/patch `playwright-ms-auth` to add a new `CredentialProviderType`
   (e.g. `"external-token"`) and thread it through `authenticate()` to skip
   the Entra-login navigation entirely when a token is already available —
   a nontrivial change since `authenticate()` currently assumes it must reach
   the login page and fill a password/cert form.

Either way, F9 should be scoped as build-new-code, not "flip a flag this
package already supports."
