import { describe, expect, it, vi } from "vitest";
import { createMedusaClient } from "../src/medusa/client";
import { MedusaError } from "../src/medusa/errors";

const config = {
	backendUrl: "https://store.example.test/",
	publishableKey: "pk_test_123",
	regionId: "reg_eu",
	salesChannelId: "sc_web",
};
const product = {
	id: "prod_abc",
	title: "Mug",
	handle: "mug",
	thumbnail: "https://img.example.test/mug.png",
	variants: [
		{
			id: "variant_1",
			calculated_price: {
				calculated_amount: 12.5,
				currency_code: "USD",
				is_calculated_price_tax_inclusive: true,
			},
		},
		{
			id: "variant_2",
			calculated_price: {
				calculated_amount: 14,
				currency_code: "usd",
				is_calculated_price_tax_inclusive: true,
			},
		},
	],
};
const response = (payload: unknown, status = 200, headers?: HeadersInit) =>
	new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
		status,
		headers,
	});
const clientFor = (fetcher: typeof fetch) => createMedusaClient(config, fetcher);

async function code(promise: Promise<unknown>) {
	try {
		await promise;
		throw new Error("expected rejection");
	} catch (e) {
		if (e instanceof Error && e.message === "expected rejection") throw e;
		return (e as MedusaError).code;
	}
}

describe("Medusa Store API client", () => {
	it("sends only Store API credentials, requests region prices, and preserves major-unit price", async () => {
		const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
			response({ products: [product], count: 1, offset: 0, limit: 20 }),
		);
		const result = await clientFor(fetcher).listProducts();
		expect(result.items[0]).toMatchObject({
			id: "prod_abc",
			title: "Mug",
			price: { amount: 12.5, currencyCode: "usd", isTaxInclusive: true },
		});
		const [url, init] = fetcher.mock.calls[0]!;
		const parsed = new URL(String(url));
		expect(parsed.pathname).toBe("/store/products");
		expect(parsed.searchParams.get("region_id")).toBe("reg_eu");
		expect(parsed.searchParams.get("sales_channel_id")).toBe("sc_web");
		expect(parsed.searchParams.get("fields")).toContain("+variants.calculated_price");
		expect(new Headers(init?.headers).get("x-publishable-api-key")).toBe("pk_test_123");
		expect(JSON.stringify(init)).not.toContain("admin");
		expect(result.items[0]?.price?.amount).toBe(12.5);
	});

	it("returns null for deleted products and rejects a mismatched response identity", async () => {
		expect(await clientFor(async () => response({}, 404)).getProduct("prod_abc")).toBeNull();
		expect(
			await code(
				clientFor(async () =>
					response({ product: { ...product, id: "prod_other" } }),
				).getProduct("prod_abc"),
			),
		).toBe("INVALID_RESPONSE");
	});

	it.each([
		[401, "AUTHENTICATION"],
		[403, "AUTHENTICATION"],
		[422, "REQUEST"],
		[503, "UNAVAILABLE"],
	] as const)(
		"maps HTTP %i to %s without exposing upstream content",
		async (status, expected) => {
			const secretBody = "pk_secret response contains details";
			const result = await code(
				clientFor(async () => response(secretBody, status)).listRegions(),
			);
			expect(result).toBe(expected);
		},
	);

	it("rejects malformed JSON and malformed product payloads", async () => {
		expect(await code(clientFor(async () => response("{")).listRegions())).toBe(
			"INVALID_RESPONSE",
		);
		expect(
			await code(
				clientFor(async () =>
					response({ products: [{ id: "bad", title: "x", variants: [] }], count: 1 }),
				).listProducts(),
			),
		).toBe("INVALID_RESPONSE");
	});

	it("rejects redirects and oversized bodies", async () => {
		expect(await code(clientFor(async () => response("", 302)).listRegions())).toBe("REQUEST");
		expect(
			await code(
				clientFor(async () =>
					response("{}", 200, { "content-length": "1048577" }),
				).listRegions(),
			),
		).toBe("INVALID_RESPONSE");
	});

	it("converts network failures and aborts stalled requests at its deadline", async () => {
		expect(
			await code(
				clientFor(async () => {
					throw new TypeError("socket details");
				}).listRegions(),
			),
		).toBe("NETWORK");
		const pendingFetch: typeof fetch = (_url, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener(
					"abort",
					() => reject(new DOMException("aborted", "AbortError")),
					{ once: true },
				);
			});
		expect(await code(clientFor(pendingFetch).listRegions())).toBe("TIMEOUT");
	}, 8000);

	it("times out while reading a body even when the fetch implementation ignores abort", async () => {
		const stalledBody = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
		const ignoresAbort: typeof fetch = async () =>
			new Response(stalledBody, { headers: { "content-type": "application/json" } });
		expect(await code(clientFor(ignoresAbort).listRegions())).toBe("TIMEOUT");
	}, 8000);

	it("does not aggregate prices across currencies or silently use invalid amounts", async () => {
		const mixed = {
			...product,
			variants: [
				product.variants[0],
				{
					id: "variant_2",
					calculated_price: { calculated_amount: 9, currency_code: "EUR" },
				},
			],
		};
		const fetcher = async () => response({ product: mixed });
		expect((await clientFor(fetcher).getProduct("prod_abc"))?.price).toBeNull();
	});

	it("rejects a server response that exceeds the requested item count", async () => {
		const items = Array.from({ length: 2 }, (_, n) => ({ ...product, id: `prod_${n}` }));
		expect(
			await code(
				clientFor(async () =>
					response({ products: items, count: 2, limit: 2, offset: 0 }),
				).listProducts({ limit: 1 }),
			),
		).toBe("INVALID_RESPONSE");
	});

	it("withholds a minimum price when equal-price variants disagree on tax basis", async () => {
		const mixedTax = {
			...product,
			variants: [
				{
					id: "variant_taxed",
					calculated_price: {
						calculated_amount: 10,
						currency_code: "USD",
						is_calculated_price_tax_inclusive: true,
					},
				},
				{
					id: "variant_untaxed",
					calculated_price: {
						calculated_amount: 10,
						currency_code: "usd",
						is_calculated_price_tax_inclusive: false,
					},
				},
			],
		};
		expect(
			(await clientFor(async () => response({ product: mixedTax })).getProduct("prod_abc"))
				?.price,
		).toBeNull();
	});

	it("does not report a lower price when a higher variant has a different tax basis", async () => {
		const mixedTax = {
			...product,
			variants: [
				{
					id: "variant_low_inclusive",
					calculated_price: {
						calculated_amount: 9,
						currency_code: "USD",
						is_calculated_price_tax_inclusive: true,
					},
				},
				{
					id: "variant_high_exclusive",
					calculated_price: {
						calculated_amount: 14,
						currency_code: "usd",
						is_calculated_price_tax_inclusive: false,
					},
				},
			],
		};
		expect(
			(await clientFor(async () => response({ product: mixedTax })).getProduct("prod_abc"))
				?.price,
		).toBeNull();
	});

	it("ignores an empty currency instead of returning an unlabelled amount", async () => {
		const invalidCurrency = {
			...product,
			variants: [
				{
					id: "variant_empty_currency",
					calculated_price: { calculated_amount: 2, currency_code: " " },
				},
			],
		};
		expect(
			(
				await clientFor(async () => response({ product: invalidCurrency })).getProduct(
					"prod_abc",
				)
			)?.price,
		).toBeNull();
	});
});
