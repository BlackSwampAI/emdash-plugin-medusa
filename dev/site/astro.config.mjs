import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";
import { sqlite } from "emdash/db";

import { medusaPlugin } from "../../dist/index.mjs";

const root = new URL("../../", import.meta.url);
const tunnelFile = new URL(".local/tunnel.json", root);
const tunnel = existsSync(tunnelFile)
	? JSON.parse(readFileSync(tunnelFile, "utf8"))
	: { backendUrl: "https://commerce.example.com" };
const envFile = new URL(".local/encryption.json", root);
if (existsSync(envFile))
	process.env.EMDASH_ENCRYPTION_KEY = JSON.parse(readFileSync(envFile, "utf8")).key;
const descriptor = medusaPlugin({
	allowedOrigins: [tunnel.backendUrl],
	productUrlTemplate:
		process.env.MEDUSA_DEMO_DISABLE_PRODUCT_LINKS === "1" ? null : "/products/:handle",
});

export default defineConfig({
	output: "server",
	adapter: node({ mode: "standalone" }),
	server: { host: "127.0.0.1", port: 14321, strictPort: true },
	devToolbar: { enabled: false },
	integrations: [
		react(),
		emdash({
			database: sqlite({
				url: `file:${fileURLToPath(new URL(".local/content.db", root))}`,
			}),
			plugins: [
				{
					...descriptor,
					entrypoint: fileURLToPath(new URL("dist/index.mjs", root)),
					adminEntry: fileURLToPath(new URL("src/admin/index.tsx", root)),
					componentsEntry: fileURLToPath(new URL("src/astro/index.ts", root)),
				},
			],
		}),
	],
});
