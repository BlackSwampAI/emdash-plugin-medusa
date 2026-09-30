import { fileURLToPath } from "node:url";
import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";
import { sqlite } from "emdash/db";
import { medusaPlugin } from "@blackswampai/emdash-plugin-medusa";

const descriptor = medusaPlugin({ allowedOrigins: ["https://commerce.example.com"] });

export default defineConfig({
	output: "server",
	adapter: node({ mode: "standalone" }),
	devToolbar: { enabled: false },
	integrations: [
		react(),
		emdash({
			database: sqlite({
				url: `file:${fileURLToPath(new URL("./content.db", import.meta.url))}`,
			}),
			plugins: [descriptor],
		}),
	],
});
