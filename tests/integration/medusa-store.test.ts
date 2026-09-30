import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { createMedusaClient } from "../../src/medusa/client";
import { MedusaError } from "../../src/medusa/errors";

type Fixture = {
	backendUrl: string;
	publishableKey: string;
	secondPublishableKey: string;
	regionId: string;
	eurRegionId: string;
	salesChannelId: string;
	secondSalesChannelId: string;
	productIds: string[];
	scopedProductId: string;
	unpricedProductId: string;
	collectionId: string;
	categoryId: string;
};
function readFixture(): Fixture {
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(
			readFileSync(new URL("../../.local/medusa.json", import.meta.url), "utf8"),
		) as Record<string, unknown>;
	} catch {
		throw new Error(
			"Medusa integration fixture is missing or unreadable. Run `pnpm dev:up` before `pnpm test:integration`.",
		);
	}
	const stringFields = [
		"backendUrl",
		"publishableKey",
		"secondPublishableKey",
		"regionId",
		"eurRegionId",
		"salesChannelId",
		"secondSalesChannelId",
		"scopedProductId",
		"unpricedProductId",
		"collectionId",
		"categoryId",
	] as const;
	if (
		!stringFields.every((key) => typeof raw[key] === "string" && raw[key]) ||
		!Array.isArray(raw.productIds) ||
		!raw.productIds.every((id) => typeof id === "string") ||
		(raw.productIds as string[]).length < 2
	) {
		throw new Error(
			"Medusa integration fixture is incomplete. Regenerate it with `pnpm dev:up`.",
		);
	}
	return Object.fromEntries(
		[...stringFields, "productIds"].map((key) => [key, raw[key]]),
	) as Fixture;
}

const fixture = readFixture();
beforeAll(async () => {
	let response: Response;
	try {
		response = await fetch(new URL("/health", fixture.backendUrl), {
			signal: AbortSignal.timeout(3000),
		});
	} catch {
		throw new Error(
			"Local Medusa is not responding. Start the fixture with `pnpm dev:up` before `pnpm test:integration`.",
		);
	}
	if (!response.ok) {
		throw new Error(
			`Local Medusa health check returned ${response.status}. Restart the fixture with pnpm dev:up before pnpm test:integration.`,
		);
	}
});
describe("real Medusa Store API fixture", () => {
	const f = fixture;
	const teeId = f.productIds[1]!;
	const live = (
		key = f.publishableKey,
		regionId: string | undefined = f.regionId,
		channel = f.salesChannelId,
	) =>
		createMedusaClient(
			{ backendUrl: f.backendUrl, publishableKey: key, regionId, salesChannelId: channel },
			fetch,
		);

	it("searches and lists the published catalog, retaining both variants", async () => {
		const client = live();
		const search = await client.listProducts({ q: "Classic", limit: 10 });
		expect(search.items.some((product) => product.id === teeId)).toBe(true);
		expect(search.items.every((product) => product.variantsCount === 2)).toBe(true);
		const all = await client.listProducts({ q: "", limit: 100 });
		expect(all.items.length).toBeGreaterThan(0);
		expect(all.items.length).toBeLessThanOrEqual(100);
		expect(all.items.some((product) => product.id === teeId)).toBe(true);
	});

	it("loads exact regional prices in major currency units and leaves prices absent without a region", async () => {
		const usd = await live().getProduct(teeId);
		expect(usd).toMatchObject({
			id: teeId,
			variantsCount: 2,
			price: { amount: 24, currencyCode: "usd" },
		});
		const eur = await live(f.publishableKey, f.eurRegionId).getProduct(teeId);
		expect(eur?.price).toMatchObject({ amount: 22, currencyCode: "eur" });
		const noRegion = await live(f.publishableKey, "").getProduct(teeId);
		expect(noRegion?.price).toBeNull();
		expect(await live().getProduct("prod_01H00000000000000000000000")).toBeNull();
		expect(await live().getProduct(f.unpricedProductId)).toMatchObject({
			id: f.unpricedProductId,
			price: null,
		});
	});

	it("enforces publishable-key channel scope and rejects invalid credentials or mismatched channel context", async () => {
		const scoped = await live().getProduct(f.scopedProductId);
		expect(scoped).toBeNull();
		expect(
			await live(f.secondPublishableKey, f.regionId, f.secondSalesChannelId).getProduct(
				f.scopedProductId,
			),
		).toMatchObject({ id: f.scopedProductId });
		try {
			await live("pk_invalid_integration_key", f.regionId, f.salesChannelId).listProducts({
				limit: 1,
			});
			throw new Error("expected invalid key to be rejected");
		} catch (error) {
			expect(error).toBeInstanceOf(MedusaError);
			expect((error as MedusaError).status).toBeGreaterThanOrEqual(400);
			expect((error as MedusaError).status).toBeLessThan(500);
			expect((error as Error).message).not.toContain("pk_invalid_integration_key");
		}
		try {
			await live(f.publishableKey, f.regionId, f.secondSalesChannelId).listProducts({
				limit: 1,
			});
			throw new Error("expected key/channel mismatch to be rejected");
		} catch (error) {
			expect(error).toBeInstanceOf(MedusaError);
			expect((error as MedusaError).status).toBeGreaterThanOrEqual(400);
			expect((error as MedusaError).status).toBeLessThan(500);
		}
	});

	it("queries Store collections and categories with the scoped publishable key", async () => {
		const headers = { "x-publishable-api-key": f.publishableKey, accept: "application/json" };
		const collectionUrl = new URL("/store/collections", f.backendUrl);
		collectionUrl.searchParams.set("id", f.collectionId);
		const collectionResponse = await fetch(collectionUrl, { headers });
		expect(collectionResponse.ok).toBe(true);
		const collectionBody = (await collectionResponse.json()) as {
			collections?: Array<{ id: string }>;
		};
		expect(collectionBody.collections?.some(({ id }) => id === f.collectionId)).toBe(true);

		const categoryUrl = new URL("/store/product-categories", f.backendUrl);
		categoryUrl.searchParams.set("id", f.categoryId);
		const categoryResponse = await fetch(categoryUrl, { headers });
		expect(categoryResponse.ok).toBe(true);
		const categoryBody = (await categoryResponse.json()) as {
			product_categories?: Array<{ id: string }>;
		};
		expect(categoryBody.product_categories?.some(({ id }) => id === f.categoryId)).toBe(true);
	});
});
