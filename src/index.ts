import { definePlugin, type PluginDescriptor, type ResolvedPlugin } from "emdash";

import { productBlock } from "./block";
import { createRoutes } from "./routes/index";
import { normalizeProductUrlTemplate } from "./product-url";
import { approvedOrigins, settingsSchema, type MedusaPluginOptions } from "./settings";

export type { MedusaPluginOptions } from "./settings";
export type { MedusaProductBlock } from "./block";

const id = "emdash-medusa";
const version = "0.1.0";
const pages = [{ path: "/", label: "Medusa", icon: "cube" }];

export function medusaPlugin(options: MedusaPluginOptions): PluginDescriptor<MedusaPluginOptions> {
	const origins = approvedOrigins(options);
	const productUrlTemplate = normalizeProductUrlTemplate(options.productUrlTemplate);
	return {
		id,
		version,
		format: "native",
		entrypoint: "@blackswampai/emdash-plugin-medusa",
		adminEntry: "@blackswampai/emdash-plugin-medusa/admin",
		componentsEntry: "@blackswampai/emdash-plugin-medusa/astro",
		options: { allowedOrigins: origins, productUrlTemplate },
		capabilities: ["network:request"],
		allowedHosts: origins.map((origin) => new URL(origin).hostname),
		adminPages: pages,
		settingsSchema,
		portableTextBlocks: [productBlock],
	};
}

export function createPlugin(options: MedusaPluginOptions): ResolvedPlugin {
	const origins = approvedOrigins(options);
	const productUrlTemplate = normalizeProductUrlTemplate(options.productUrlTemplate);
	return definePlugin({
		id,
		version,
		capabilities: ["network:request"],
		allowedHosts: origins.map((origin) => new URL(origin).hostname),
		routes: createRoutes(origins, productUrlTemplate),
		admin: { pages, settingsSchema, portableTextBlocks: [productBlock] },
	});
}

export default createPlugin;
