import { describe, expect, it, vi } from "vitest";
import { parseProductBlock } from "../src/block";
import { loadProduct } from "../src/astro/load-product";

describe("Portable Text product references", () => {
	it("round trips only the reference and presentation choices", () => {
		const block = parseProductBlock({
			_type: "medusa-product",
			_key: "abc",
			productId: "prod_live_1",
			display: "featured",
			showPrice: false,
			title: "stale title",
			price: 1,
			thumbnail: "https://x.test/a",
		});
		expect(block).toEqual({
			_type: "medusa-product",
			_key: "abc",
			productId: "prod_live_1",
			display: "featured",
			showPrice: false,
		});
		expect(JSON.stringify(block)).not.toMatch(/title|price|thumbnail/);
	});

	it.each([
		null,
		[],
		{},
		{ _type: "other", productId: "prod_x" },
		{ _type: "medusa-product", productId: "variant_x" },
	])("rejects malformed reference %j", (input) => {
		expect(parseProductBlock(input)).toBeNull();
	});

	it("applies calm defaults to unknown optional display values", () => {
		expect(
			parseProductBlock({
				_type: "medusa-product",
				productId: "prod_x",
				display: "unexpected",
				showPrice: "false",
			}),
		).toMatchObject({ display: "card", showPrice: true });
	});
});

describe("SSR product loader", () => {
	const base = new URL("https://site.example.test/posts/a");
	const success = {
		success: true,
		data: {
			ok: true,
			product: { id: "prod_x", title: "Live", price: { amount: 12.5, currencyCode: "usd" } },
		},
	};
	it("dispatches the encoded product route in-process and accepts a live result", async () => {
		const dispatch = vi.fn(async (..._args: unknown[]) => success);
		await expect(loadProduct("prod_x", base, dispatch as never)).resolves.toMatchObject({
			id: "prod_x",
			title: "Live",
			price: { amount: 12.5 },
		});
		expect(dispatch).toHaveBeenCalledWith(
			"emdash-medusa",
			"GET",
			"/product",
			expect.any(Request),
		);
		const req = dispatch.mock.calls[0]?.[3] as Request;
		expect(new URL(req.url).pathname).toBe("/_emdash/api/plugins/emdash-medusa/product");
		expect(req.method).toBe("GET");
	});
	it.each([
		["missing", { success: true, data: { ok: true, product: null } }],
		["deleted", { success: true, data: { ok: true, product: null } }],
		[
			"unpriced",
			{
				...success,
				data: { ok: true, product: { id: "prod_x", title: "Live", price: null } },
			},
		],
		["malformed", { success: true, data: { ok: true, product: { id: "prod_x" } } }],
	])("handles %s product payload safely", async (_name, payload) => {
		const value = await loadProduct("prod_x", base, async () => payload as never);
		if (_name === "unpriced") expect(value?.price).toBeNull();
		else expect(value).toBeNull();
	});
	it("does not fall back to a network request when dispatch is absent or throws", async () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		await expect(loadProduct("prod_x", base)).resolves.toBeNull();
		await expect(
			loadProduct("prod_x", base, async () => {
				throw new Error("no route");
			}),
		).resolves.toBeNull();
		expect(fetch).not.toHaveBeenCalled();
	});
});
