# @blackswampai/emdash-plugin-medusa

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Native [EmDash CMS](https://github.com/emdash-cms/emdash) plugin for live [Medusa v2](https://github.com/medusajs/medusa) product references in Portable Text and server-rendered Astro storefronts.

For detailed background, see the [Architecture Document](docs/architecture.md) and [Local Development Guide](docs/local-development.md).

---

## Overview & Architecture

`@blackswampai/emdash-plugin-medusa` connects an EmDash content site with a Medusa v2 store without copying or synchronizing product catalogs into the CMS.

- **Clean References in Portable Text:** Editor documents store minimal references (`_type: "medusa-product"`, `productId`, `display`, `showPrice`). Product titles, handles, thumbnails, prices, and variant details remain owned by Medusa and are fetched on demand at SSR time.
- **Storefront-Only Reads:** The plugin strictly interacts with Medusa v2 Store APIs (`/store/products`, `/store/regions`). **No Medusa Admin API secrets or credentials are accepted or stored in plugin settings.** Only publishable API keys (`pk_...`) linked to scoped sales channels are used.
- **Server-Side Credential Isolation:** While Medusa publishable keys are nominally public, EmDash treats the configured key as a write-only secret stored encrypted at rest via `EMDASH_ENCRYPTION_KEY`. Storefront pages fetch product data via an in-process plugin SSR dispatcher route without exposing the publishable key or allowing direct client browser loopbacks.
- **Product Picker Bounds:** The Portable Text editor dropdown selects from the first 100 products returned by the store. EmDash's block select does not support server-side search querying or pagination. A separate admin page allows keyword search (`q`) and region selection across the catalog.
- **Medusa v2 Pricing Semantics:** Prices in Medusa v2 are represented in major currency units (e.g. `24` for $24.00 USD, not `2400`). Displayed prices reflect a coherent currency and tax basis computed as the minimum variant price within an explicitly configured region.
- **Scope & Honesty:** This plugin provides product reference embedding and display. **There is no checkout, shopping cart, or customer payment flow implemented in this slice.** Checkout and cart handling remain delegated to Medusa storefront applications.
- **SSRF & Network Boundary:** EmDash core strictly blocks loopback and private network traffic (`127.0.0.1`, RFC 1918) for native and sandboxed plugins. This design protects production deployments but prevents connecting directly to local Medusa servers without an external HTTPS tunnel (see [docs/local-development.md](docs/local-development.md)).

> **Runtime Plugin ID:** Note that the package name is `@blackswampai/emdash-plugin-medusa`, while the registered runtime plugin ID inside EmDash is `emdash-medusa`.

---

## Installation

This is an unpublished proof of concept. For local development, follow the guide below. After a future npm release, install alongside required peer dependencies:

```bash
pnpm add @blackswampai/emdash-plugin-medusa
```

### Peer Dependencies

- `emdash`: `>=1.0.1 <2`
- `astro`: `>=7 <8`
- `react`: `^19`
- `@cloudflare/kumo`: `^2`

---

## Configuration

In your site's `astro.config.mjs`, import the descriptor helper `medusaPlugin` and configure your approved Medusa backend HTTPS origins:

```javascript
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import emdash from "emdash/astro";
import { sqlite } from "emdash/db";
import { medusaPlugin } from "@blackswampai/emdash-plugin-medusa";

export default defineConfig({
	output: "server",
	adapter: node({ mode: "standalone" }),
	integrations: [
		react(),
		emdash({
			database: sqlite({ url: "file:./content.db" }),
			plugins: [
				medusaPlugin({
					allowedOrigins: ["https://shop.example.com"],
				}),
			],
		}),
	],
});
```

Use `medusaPlugin` in site configuration. The default `createPlugin` export is the runtime factory EmDash invokes internally. Configure `EMDASH_ENCRYPTION_KEY` in the host environment; see EmDash secret settings documentation.

### Source-Only Admin and Astro Exports

Per EmDash plugin patterns, admin components (`@blackswampai/emdash-plugin-medusa/admin`) and Astro component renderers (`@blackswampai/emdash-plugin-medusa/astro`) are distributed as source files (`.tsx` and `.astro`/`.ts`). They are compiled directly by the consuming Astro site during its Vite/Astro build step, avoiding dual-bundling and React runtime mismatches.

---

## Admin Setup & Plugin Settings

Once configured in `astro.config.mjs`, open **Plugins → Medusa → Connection settings** for the URL/key/channel, then use the Medusa page to select a region:

1. **Medusa Backend URL:** An HTTPS origin matching one of the origins declared in `allowedOrigins`.
2. **Medusa Publishable API Key:** A `pk_...` key tied to your storefront's sales channel.
3. **Default Region:** Selected from the active Medusa regions to enable currency calculation.
4. **Default Sales Channel ID (Optional):** Restricts product queries to a specific sales channel.

---

## Development & Testing

See [docs/local-development.md](docs/local-development.md) for the complete guide. Quick reference:

```bash
# Install dependencies & Playwright browser
pnpm install --frozen-lockfile
pnpm exec playwright install chromium

# Build plugin
pnpm build

# Launch Docker containers and seed local Medusa fixture
pnpm dev:up

# Start dev tunnel in a separate terminal (binds store gateway on 19001)
pnpm dev:tunnel

# Start dev site in another terminal (binds 14321)
pnpm dev:site

# Configure encrypted settings and publish test page
pnpm dev:configure

# Run offline integration tests against local Medusa
pnpm test:integration

# Run browser end-to-end tests (requires tunnel and site)
pnpm test:e2e

# Stop containers (preserves data)
pnpm dev:down

# Destructive reset (removes volumes and fixtures)
node scripts/dev.mjs reset
```

---

## License

[MIT](LICENSE) © Black Swamp AI
