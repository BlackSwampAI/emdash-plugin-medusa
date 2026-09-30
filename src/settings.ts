import type { PluginContext, SettingField } from "emdash";

import { MedusaError } from "./medusa/errors";
import type { MedusaClientConfig } from "./medusa/types";

export interface MedusaPluginOptions {
	/** Exact HTTPS backend origins approved by the site developer, without wildcards. */
	allowedOrigins: string[];
	/** Storefront product URL template. Omit or set null to disable product links. */
	productUrlTemplate?: string | null;
}

export const settingsSchema: Record<string, SettingField> = {
	backendUrl: {
		type: "url",
		label: "Medusa backend URL",
		description: "Must use an HTTPS origin approved in astro.config.mjs.",
	},
	publishableKey: {
		type: "secret",
		label: "Medusa publishable API key",
		description:
			"Use a pk_ key linked to your storefront sales channel. No Admin key is needed.",
	},
	regionId: {
		type: "string",
		label: "Default region ID",
		description: "Choose a region on the Medusa plugin page to resolve prices.",
	},
	salesChannelId: {
		type: "string",
		label: "Default sales channel ID",
		description: "Optional; must belong to this publishable key. Find the ID in Medusa Admin.",
	},
};

export function normalizeBackendUrl(value: unknown): string {
	if (typeof value !== "string" || !value.trim() || value.length > 2048) {
		throw new MedusaError("CONFIGURATION", "Configure a Medusa backend URL.");
	}
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new MedusaError("CONFIGURATION", "The Medusa backend URL is invalid.");
	}
	if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
		throw new MedusaError(
			"CONFIGURATION",
			"Use an HTTPS backend URL without credentials, query or fragment.",
		);
	}
	return url.href.replace(/\/+$/, "");
}

export function approvedOrigins(options: MedusaPluginOptions): string[] {
	if (!Array.isArray(options?.allowedOrigins) || options.allowedOrigins.length === 0) {
		throw new MedusaError(
			"CONFIGURATION",
			"Approve a Medusa HTTPS origin in medusaPlugin({ allowedOrigins }).",
		);
	}
	return [
		...new Set(
			options.allowedOrigins.map((value) => {
				const normalized = normalizeBackendUrl(value);
				const url = new URL(normalized);
				if (url.pathname !== "/" || url.hostname.includes("*")) {
					throw new MedusaError(
						"CONFIGURATION",
						"Allowed origins must be exact HTTPS origins without paths or wildcards.",
					);
				}
				return url.origin;
			}),
		),
	];
}

function optionalId(value: unknown, prefix: "reg" | "sc"): string | undefined {
	if (value === null || value === undefined || value === "") return undefined;
	if (typeof value !== "string" || !new RegExp(`^${prefix}_[A-Za-z0-9_-]{1,120}$`).test(value)) {
		throw new MedusaError(
			"CONFIGURATION",
			"The configured region or sales channel ID is invalid.",
		);
	}
	return value;
}

export function validateSettings(
	values: Record<string, unknown>,
	origins: string[],
): MedusaClientConfig {
	const backendUrl = normalizeBackendUrl(values.backendUrl);
	if (!origins.includes(new URL(backendUrl).origin)) {
		throw new MedusaError(
			"CONFIGURATION",
			"The backend origin is not approved by this site's plugin configuration.",
		);
	}
	if (
		typeof values.publishableKey !== "string" ||
		!/^pk_[A-Za-z0-9_-]{1,500}$/.test(values.publishableKey)
	) {
		throw new MedusaError(
			"CONFIGURATION",
			"Configure a Medusa publishable key (pk_), not an Admin credential.",
		);
	}
	return {
		backendUrl,
		publishableKey: values.publishableKey,
		regionId: optionalId(values.regionId, "reg"),
		salesChannelId: optionalId(values.salesChannelId, "sc"),
	};
}

export async function readSettings(
	ctx: PluginContext,
	origins: string[],
): Promise<MedusaClientConfig> {
	const keys = ["backendUrl", "publishableKey", "regionId", "salesChannelId"];
	const values = await Promise.all(keys.map((key) => ctx.settings.get<unknown>(key)));
	return validateSettings(Object.fromEntries(keys.map((key, i) => [key, values[i]])), origins);
}
