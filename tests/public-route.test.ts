import type { RouteContext } from "emdash";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoutes } from "../src/routes";
import { createPlugin, medusaPlugin } from "../src/index";

const backendUrl = "https://medusa.example.test";
const publishableKey = "pk_route_test_secret";
const productId = "prod_green-shoe_1";
const origins = [backendUrl];
const template = "/products/:handle";

function rawProduct(overrides: Record<string, unknown> = {}) {
	return {
		id: productId,
		title: "Green shoe",
		handle: "green shoe",
		thumbnail: "https://images.example.test/shoe.png",
		variants: [{ id: "variant_1" }],
		...overrides,
	};
}

function makeContext(
	options: {
		productId?: unknown;
		settings?: Record<string, unknown>;
		fetch?: typeof fetch;
		withoutHttp?: boolean;
	} = {},
) {
	const debug = vi.fn();
	const warn = vi.fn();
	const fetch = options.fetch ?? vi.fn(async () => Response.json({ product: rawProduct() }));
	const settings: Record<string, unknown> = {
		backendUrl,
		publishableKey,
		...options.settings,
	};
	const context = {
		input: { productId: options.productId ?? productId },
		settings: { get: vi.fn(async (key: string) => settings[key]) },
		...(options.withoutHttp ? {} : { http: { fetch } }),
		log: { debug, warn },
	} as unknown as RouteContext;
	return { context, debug, warn, fetch };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("public product route diagnostics", () => {
	it.each(["/catalog/:handle", "https://shop.example.test/items/:handle"])(
		"propagates %s through the descriptor and runtime into the public product",
		async (productUrlTemplate) => {
			const descriptor = medusaPlugin({ allowedOrigins: origins, productUrlTemplate });
			const plugin = createPlugin(descriptor.options!);
			const { context } = makeContext();
			const result = await plugin.routes!.product!.handler(context);
			expect(result).toMatchObject({
				product: { href: productUrlTemplate.replace(":handle", "green%20shoe") },
			});
		},
	);
	it("omits links by default without changing valid product rendering data", async () => {
		const { context } = makeContext();
		expect(await createRoutes(origins).product!.handler(context)).toMatchObject({
			ok: true,
			product: { id: productId, title: "Green shoe", href: null },
		});
	});
	it.each([null, ""])("omits configured links for a missing handle %j", async (handle) => {
		const { context } = makeContext({
			fetch: vi.fn(async () => Response.json({ product: rawProduct({ handle }) })),
		});
		expect(await createRoutes(origins, template).product!.handler(context)).toMatchObject({
			product: { href: null },
		});
	});
	it("returns a normalized product and computed href on success", async () => {
		const { context, fetch } = makeContext();
		const result = (await createRoutes(origins, template).product!.handler(context)) as any;

		expect(result).toEqual({
			ok: true,
			product: {
				id: productId,
				title: "Green shoe",
				handle: "green shoe",
				thumbnail: "https://images.example.test/shoe.png",
				variantsCount: 1,
				price: null,
				href: "/products/green%20shoe",
			},
		});
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("returns a calm null for an upstream 404 and logs it at debug level", async () => {
		const { context, debug, warn } = makeContext({
			fetch: vi.fn(async () => new Response(null, { status: 404 })),
		});
		const result = (await createRoutes(origins, template).product!.handler(context)) as any;

		expect(result).toEqual({ ok: true, product: null });
		expect(debug).toHaveBeenCalledWith("Medusa product unavailable.", {
			code: "NOT_FOUND",
			productId,
		});
		expect(warn).not.toHaveBeenCalled();
	});

	it.each([
		[
			"network exception",
			async () => {
				throw new Error(`network leaked ${publishableKey} https://secret.example.test`);
			},
			"NETWORK",
		],
		[
			"malformed JSON",
			async () => new Response("{secret response", { status: 200 }),
			"INVALID_RESPONSE",
		],
		[
			"authentication response",
			async () => new Response("unauthorized body with secret", { status: 401 }),
			"AUTHENTICATION",
		],
		[
			"server error response",
			async () => new Response("private upstream diagnostics", { status: 503 }),
			"UNAVAILABLE",
		],
	])("keeps %s diagnostics out of the public response", async (_label, responder, code) => {
		const { context, warn, debug } = makeContext({ fetch: vi.fn(responder as typeof fetch) });
		const result = (await createRoutes(origins, template).product!.handler(context)) as any;

		expect(result).toEqual({ ok: true, product: null });
		expect(JSON.stringify(result)).not.toContain(publishableKey);
		expect(JSON.stringify(result)).not.toMatch(/error|message|secret|diagnostic|https:\/\//i);
		expect(warn).toHaveBeenCalledWith("Medusa product lookup failed.", {
			code,
			productId,
		});
		expect(JSON.stringify(warn.mock.calls)).not.toContain(publishableKey);
		expect(JSON.stringify(warn.mock.calls)).not.toContain("secret.example.test");
		expect(debug).not.toHaveBeenCalled();
	});

	it("does not fetch, log, or echo an invalid product ID", async () => {
		const arbitrary = `${publishableKey}/https://internal.example.test`;
		const { context, fetch, debug, warn } = makeContext({ productId: arbitrary });
		const result = (await createRoutes(origins, template).product!.handler(context)) as any;

		expect(result).toEqual({ ok: true, product: null });
		expect(JSON.stringify(result)).not.toContain(arbitrary);
		expect(fetch).not.toHaveBeenCalled();
		expect(debug).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
	});

	it("reports missing settings and missing network access without details", async () => {
		const missingSettings = makeContext({
			settings: { backendUrl: undefined, publishableKey: undefined },
		});
		const noSettingsResult = (await createRoutes(origins, template).product!.handler(
			missingSettings.context,
		)) as any;
		expect(noSettingsResult).toEqual({ ok: true, product: null });
		expect(missingSettings.warn).toHaveBeenCalledWith("Medusa product lookup failed.", {
			code: "CONFIGURATION",
			productId,
		});

		const noHttp = makeContext({ withoutHttp: true });
		const noHttpResult = (await createRoutes(origins, template).product!.handler(
			noHttp.context,
		)) as any;
		expect(noHttpResult).toEqual({ ok: true, product: null });
		expect(noHttp.warn).toHaveBeenCalledWith("Medusa product lookup failed.", {
			code: "CONFIGURATION",
			productId,
		});
	});

	it("classifies a stalled upstream request as a timeout", async () => {
		vi.useFakeTimers();
		const { context, warn } = makeContext({
			fetch: vi.fn(() => new Promise<Response>(() => {})),
		});
		const pending = createRoutes(origins, template).product!.handler(context);
		await vi.advanceTimersByTimeAsync(5_000);
		const result = (await pending) as any;

		expect(result).toEqual({ ok: true, product: null });
		expect(warn).toHaveBeenCalledWith("Medusa product lookup failed.", {
			code: "TIMEOUT",
			productId,
		});
	});
});
