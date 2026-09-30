import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts", "src/medusa/client.ts"],
	format: "esm",
	dts: true,
	clean: true,
	external: ["emdash", /^emdash\//],
});
