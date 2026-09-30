import type { PluginRoute, RouteContext } from "emdash";

import { createMedusaClient } from "../medusa/client";
import { MedusaError } from "../medusa/errors";
import { readSettings } from "../settings";

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new MedusaError("INPUT", "Expected an object.");
	}
	return value as Record<string, unknown>;
}

function integer(value: unknown, fallback: number, maximum: number): number {
	if (value === undefined) return fallback;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > maximum) {
		throw new MedusaError("INPUT", "Invalid pagination.");
	}
	return value;
}

export function createRoutes(origins: string[]): Record<string, PluginRoute> {
	const run =
		(
			fn: (
				ctx: RouteContext,
				client: ReturnType<typeof createMedusaClient>,
				config: Awaited<ReturnType<typeof readSettings>>,
			) => Promise<object>,
		) =>
		async (ctx: RouteContext) => {
			try {
				const config = await readSettings(ctx, origins);
				if (!ctx.http)
					throw new MedusaError("CONFIGURATION", "EmDash network access is unavailable.");
				const client = createMedusaClient(config, (url, init) =>
					ctx.http!.fetch(url, init),
				);
				return { ok: true, ...(await fn(ctx, client, config)) };
			} catch (error) {
				return {
					ok: false,
					error:
						error instanceof MedusaError
							? {
									code: error.code,
									message: error.message,
									...(error.status ? { status: error.status } : {}),
								}
							: {
									code: "UNAVAILABLE",
									message:
										"Medusa settings or network access are unavailable. Check encryption, approved origin and public network reachability.",
								},
				};
			}
		};
	const privateRead = {
		methods: ["POST"] as "POST"[],
		request: { body: "json" as const, maxBytes: 2048 },
		permission: "content:read" as const,
	};
	return {
		connection: {
			...privateRead,
			permission: "plugins:manage",
			handler: run(async (_ctx, client, config) => {
				await client.listProducts({ limit: 1 });
				const regions = await client.listRegions();
				const region = regions.find((item) => item.id === config.regionId) ?? null;
				if (config.regionId && !region)
					throw new MedusaError("CONFIGURATION", "The configured region is unavailable.");
				return {
					backendReachable: true,
					keyAccepted: true,
					productApiReachable: true,
					region,
					regionCount: regions.length,
					pricingReady: !!region,
					channelId: config.salesChannelId ?? null,
				};
			}),
		},
		products: {
			...privateRead,
			handler: run(async (ctx, client) => {
				const input = record(ctx.input);
				if (input.q !== undefined && (typeof input.q !== "string" || input.q.length > 200))
					throw new MedusaError("INPUT", "Search text must be at most 200 characters.");
				const limit = integer(input.limit, 20, 100);
				if (limit === 0) throw new MedusaError("INPUT", "Limit must be greater than zero.");
				return client.listProducts({
					q: input.q as string | undefined,
					limit,
					offset: integer(input.offset, 0, 100000),
				});
			}),
		},
		"product-options": {
			...privateRead,
			handler: run(async (_ctx, client) => {
				const result = await client.listProducts({ limit: 100 });
				return {
					items: result.items.map((product) => ({ id: product.id, name: product.title })),
					count: result.count,
					truncated: result.count > result.items.length,
				};
			}),
		},
		regions: {
			...privateRead,
			handler: run(async (_ctx, client) => ({ items: await client.listRegions() })),
		},
		configuration: {
			...privateRead,
			permission: "plugins:manage",
			handler: run(async (ctx, client) => {
				const input = record(ctx.input);
				if (
					typeof input.regionId !== "string" ||
					!/^reg_[A-Za-z0-9_-]{1,120}$/.test(input.regionId)
				)
					throw new MedusaError("INPUT", "Choose a valid region.");
				const region = (await client.listRegions()).find(
					(item) => item.id === input.regionId,
				);
				if (!region) throw new MedusaError("INPUT", "That region is unavailable.");
				await ctx.settings.set("regionId", region.id);
				return { region };
			}),
		},
		product: {
			public: true,
			methods: ["GET"],
			request: { body: "none" },
			handler: run(async (ctx, client) => {
				const input = record(ctx.input);
				if (
					typeof input.productId !== "string" ||
					!/^prod_[A-Za-z0-9_-]{1,120}$/.test(input.productId)
				)
					throw new MedusaError("INPUT", "A valid Medusa product ID is required.");
				return { product: await client.getProduct(input.productId) };
			}),
		},
	};
}
