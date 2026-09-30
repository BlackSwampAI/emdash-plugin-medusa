# Validation record

Run locally on 2026-09-29/30 with Node 24.18.0, pnpm 10.32.1, Docker 29.4, EmDash 1.0.1 and Medusa 2.21.2. Main-source snapshots and primary contracts are pinned in [architecture](architecture.md).

## Results

- `pnpm check`: strict TypeScript, oxlint, oxfmt/Prettier, **46 unit/native-runtime tests**, tsdown ESM/declarations and package export/tarball checks passed.
- `pnpm test:integration`: **14 passed** (4 against real Docker Medusa, 10 read-only gateway checks). No hosted external service in this suite. Missing/unreachable Medusa fails explicitly.
- `pnpm test:e2e`: **7 browser scenarios passed** against actual EmDash + local Medusa through the production restricted HTTP path and temporary HTTPS gateway. Four screenshots captured.
- `pnpm exec astro build --root dev/site`: consuming-site server/client build and automatic renderer registration passed. Upstream admin bundle emits a >500kB chunk warning; no warning suppression was added.
- Repeated `pnpm dev:up`: seed remains repeatable and retains publishable tokens by saved API key ID. First-run data came from official Admin HTTP APIs and Medusa CLI, with no database edits.
- `npm pack --dry-run --json`, invoked by `pnpm package:check`: exports exist, package excludes fixtures, tests, local keys, environment files and node_modules. Admin/Astro sources ship deliberately for site compilation.

Unit coverage includes URL normalization/origin policy, missing settings, no encryption key, authorization/CSRF, authenticated product reads, empty lists, malformed products/envelopes/JSON, non-finite prices, currency/tax inconsistency, network exceptions, 4xx/5xx, redirect rejection, oversized responses, fetch/body timeouts, key-containing upstream failures, reference serialization, and renderer loader valid/deleted/unpriced/error behavior. Native host tests use the real `emdash/internal/plugin-test-runtime`, SQLite and official settings/dispatch handlers. The separate workerd `PluginTestHost` targets sandbox plugins; no fake native host was invented. Only its generated virtual config/scheduler modules are replaced for the isolated host test.

Real Store tests cover list/search/retrieve, two-variant counts, exact USD/EUR amounts, unpriced/deleted results, no-region price suppression, bad key, key/channel scoping, mismatched channel, collection and category listings. Browser checks exercise connection status/no key in DOM, native search, region changes, block select/autosave/reference-only fields, valid SSR, unpriced SSR, deleted SSR/no key in HTML.

## Commands used

The reproducible successful validation sequence is:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
pnpm dev:up
# Terminal A, wait for URL:
pnpm dev:tunnel
# Terminal B:
pnpm dev:site
# Terminal C:
pnpm dev:configure
pnpm test:integration
pnpm test:e2e
pnpm format
pnpm check
pnpm exec astro build --root dev/site
pnpm exec astro check --root dev/site
pnpm dev:up
```

Docker setup internally runs `medusa db:migrate` and `medusa user`, then seeds through Admin endpoints. Tool/package preparation also used `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` in `dev/medusa` to pin the container fixture dependency graph. `pnpm package:check` invokes `npm pack --dry-run --json`.

Initial development failures were corrected rather than counted as passing checks: invalid draft-update PATCH changed to the host's PUT contract; missing Astro live-content config added; a price returned without region is suppressed; stalled response timeout now covers the body; malformed renderer markup repaired; seed API-key list token reuse fixed. Agent auto-backgrounding and configuration hot reload required foreground startup/full restart as recorded in [local development](local-development.md). No production fetch fallback or SSRF patch was introduced.

## Review and artifacts

Gemini 3.8 Flash Low via the AGY skill delegated EmDash/Medusa research, client/admin code, fixture code and documentation. Some headless terminal/external-file reads were refused; focused prompts using permitted reads continued the work. The lead reviewed contracts/diffs and corrected inaccurate smallest-unit price and picker-pagination research claims against upstream code and real tests.

Independent GPT-6-Luna Medium agents added/ran tests and reviewed source/security/local setup. Review caught the second-run publishable-key loss and duplicate-title selection edge; both were corrected. No runtime production dependency was added. There are four peer dependencies; exact development dependencies are locked in `package.json`/`pnpm-lock.yaml`, with fixture-only Medusa packages in `dev/medusa`.

- [Admin connection/catalog](screenshots/admin-connection.png)
- [Dynamic product picker](screenshots/product-picker.png)
- [Saved reference block](screenshots/saved-product-block.png)
- [Anonymous Astro rendering](screenshots/astro-storefront.png)
- [Browser scenario manifest](screenshots/results.json)

CI runs package/unit/build checks and a separate real Docker Medusa suite; browser/tunnel checks remain a manual local gate. Nothing was published to npm or merged.
