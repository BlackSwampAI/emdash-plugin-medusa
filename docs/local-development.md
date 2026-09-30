# Local Development

This guide documents the local development environment, testing workflows, and networking architecture for [`@blackswampai/emdash-plugin-medusa`](https://github.com/BlackSwampAI/emdash-plugin-medusa).

## Prerequisites & Installation

Ensure you are running Node.js `>=22.16` and have Docker installed with Docker Compose support.

```bash
# Install dependencies matching the lockfile
pnpm install --frozen-lockfile

# Install Playwright Chromium browser binary for end-to-end tests
pnpm exec playwright install chromium
```

## Architecture: Why the Dev Tunnel is Required

EmDash enforces strict SSRF protections in `createHttpAccess` for all plugin network traffic (both native and sandboxed plugins). It unconditionally rejects loopback and private network ranges (such as `127.0.0.1`, `localhost`, and RFC 1918 addresses), even if they are specified in `allowedHosts`. There is no supported opt-in to bypass private-host rejection.

Because of this built-in security boundary:

- A local Medusa instance running on `http://127.0.0.1:19000` cannot be reached directly by `ctx.http.fetch`.
- To avoid patching EmDash core, degrading SSRF security, or substituting global `fetch`, local development routes requests through an HTTPS tunnel (`pnpm dev:tunnel`).
- The tunnel relies on a temporary Cloudflare quick tunnel (`trycloudflare.com`) pointing to a strict, read-only store gateway running locally on port `19001` (`http://127.0.0.1:19001`).
- The gateway proxies only GET `/store/products`, `/store/products/:id` and `/store/regions`. It does not route or expose any Medusa Admin endpoints.
- This creates an external development dependency for end-to-end site SSR and admin UI live verification, while preserving EmDash's production network guardrails.
- Wholly offline real Medusa integration testing is provided separately via `pnpm test:integration`, which exercises direct HTTP communication against the local Medusa instance without requiring EmDash's SSRF-restricted plugin context or the public tunnel.

## Step-by-Step Local Development Flow

### 1. Build the Plugin

Compile the TypeScript distribution bundles:

```bash
pnpm build
```

### 2. Start the Local Medusa Fixture

Start the PostgreSQL and Medusa v2 Docker containers and provision the local seed data:

```bash
pnpm dev:up
```

`pnpm dev:up` executes `node scripts/dev.mjs up`:

- Builds and runs containers defined in `compose.yaml` (PostgreSQL 17 alpine and Medusa v2 running migrations and server).
- Waits for `http://127.0.0.1:19000/health`.
- Provisions disposable local credentials (`.local/seed-admin.json`, file mode `0600`).
- Seeds 6 products with 2 variants each, 1 collection (`Lab featured`), 1 category (`Lab apparel`), 2 regions (`Lab United States` [USD] and `Lab Germany` [EUR]), and 2 sales channels (`Lab storefront` and `Lab B2B`) with associated publishable API keys.
- Writes connection IDs and publishable keys to `.local/medusa.json` (mode `0600`) and generates an encryption key in `.local/encryption.json` (mode `0600`).

### 3. Start the Read-Only Store Gateway Tunnel (Terminal 1)

In a dedicated terminal, launch the gateway and Cloudflare tunnel:

```bash
pnpm dev:tunnel
```

This starts the read-only Store gateway on port `19001` and connects `cloudflared` (using either a local binary via `CLOUDFLARED_BIN` or the Docker image `cloudflare/cloudflared:2026.9.3` using host networking). When the quick tunnel connects, it writes the HTTPS URL (`https://<slug>.trycloudflare.com`) to `.local/tunnel.json`.

### 4. Start the Dev Astro Site (Terminal 2)

In a second terminal, start the development Astro test site:

```bash
pnpm dev:site
```

This runs Astro dev binding to `http://127.0.0.1:14321`. It loads the plugin descriptor from `dist/index.mjs` with the approved origin read from `.local/tunnel.json`, sets `EMDASH_ENCRYPTION_KEY` from `.local/encryption.json`, and mounts the native EmDash plugin with source entries for admin and Astro components.

### 5. Configure the Site and Verify Connection

Once both the tunnel and dev site are running, execute the configuration script:

```bash
pnpm dev:configure
```

This script automates headless browser setup via Playwright:

- Logs in through the local dev-bypass endpoint (`/_emdash/api/setup/dev-bypass`).
- Saves encrypted plugin settings via the EmDash API (`backendUrl` pointing to the tunnel, `publishableKey`, default `regionId`, and `salesChannelId`). No Admin secrets are ever stored in settings.
- Creates and publishes the `medusa-demo` content entry, rendered at `/` containing 4 Portable Text reference blocks (`featured` hoodie, `card` tee, unpriced sample, and a deleted reference).
- Verifies live connectivity via `/_emdash/api/plugins/emdash-medusa/connection`.
- Emits local admin login link: `http://127.0.0.1:14321/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin`.

## Testing

### Integration Tests (Offline, Real Local Medusa)

Run integration tests against the live local Medusa instance (`http://127.0.0.1:19000`):

```bash
pnpm test:integration
```

These tests communicate directly with the local Medusa Store API using the keys seeded in `.local/medusa.json`. They verify client handling of products, pricing, regions, response bounds, and error conditions completely offline without needing the dev tunnel.

### End-to-End Tests (Browser Checks via Playwright)

Run full end-to-end browser tests verifying the EmDash admin UI and rendered storefront:

```bash
pnpm test:e2e
```

_Note: Requires `pnpm dev:up`, `pnpm dev:tunnel`, and `pnpm dev:site` to be active, as it navigates the live EmDash admin and rendered Astro pages._

### Quality and Build Checks

```bash
pnpm typecheck       # Typecheck TypeScript sources
pnpm lint            # Run oxlint checks
pnpm format:check    # Check formatting with oxfmt and Prettier
pnpm test            # Run unit tests
pnpm package:check   # Validate package export paths and manifest
pnpm check           # Run all checks, tests, and build
```

## Teardown and Reset

### Preserve Seeded Data

To stop the Docker containers while preserving database volume data and generated keys:

```bash
pnpm dev:down
```

### Destructive Reset

To completely tear down the Docker environment, wipe the database volume, and remove local secret fixtures:

```bash
node scripts/dev.mjs reset
```

This destroys this Compose project's `medusa-db` Docker volume and removes `.local/medusa.json` and `.local/seed-admin.json`.

## Development limitations

The Docker tunnel launcher uses Linux host networking. On macOS/Windows, set `CLOUDFLARED_BIN` to an installed cloudflared binary (or enable supported Docker host networking). Wait for the tunnel URL before starting the site. Restart the site and rerun `pnpm dev:configure` whenever the tunnel origin changes.

Astro 7 can automatically background itself when launched by an agent; `dev:site` uses its documented `--ignore-lock` flag to run in the foreground. Do not start two copies. During testing, an EmDash/Vite configuration hot reload left a closed module runner and broke content saves. A full stop/start of `pnpm dev:site` cleared it; this package does not patch that upstream behavior.

The demo has no CMS commerce cache provider. Its single-product SSR lookups run once per block, so a slow Medusa backend adds render latency. The sample CTA `/products/:handle` is a placeholder; a real site must supply its product route or override the renderer. Default-region changes apply globally, not per visitor. Inventory is intentionally unmanaged in the fixture; checkout and stock validation are not exercised.

`dev:up` can be rerun without duplicating products or losing keys. The reset command preserves the EmDash `.local/content.db` and `.local/encryption.json`; rerun `dev:configure` to replace product IDs after reseeding. To reset content too, stop the site first and remove those files deliberately.
