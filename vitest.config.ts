import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
	resolve: {
		alias: {
			"virtual:emdash/config": fileURLToPath(
				new URL("./tests/virtual-config.ts", import.meta.url),
			),
			"virtual:emdash/scheduler": fileURLToPath(
				new URL("./tests/virtual-scheduler.ts", import.meta.url),
			),
		},
	},
	test: {
		include: ["tests/**/*.test.ts"],
		exclude: ["tests/integration/**"],
		restoreMocks: true,
		testTimeout: 15000,
		server: { deps: { inline: ["emdash"] } },
	},
});
