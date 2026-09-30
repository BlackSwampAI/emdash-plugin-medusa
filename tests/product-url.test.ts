import { describe, expect, it } from "vitest";
import { createPlugin, medusaPlugin } from "../src/index";
import { MedusaError } from "../src/medusa/errors";
import { normalizeProductUrlTemplate, productUrlForHandle } from "../src/product-url";

const origin = "https://commerce.example.test";

describe("product URL configuration", () => {
	it("disables links when omitted or null", () => {
		expect(normalizeProductUrlTemplate(undefined)).toBeNull();
		expect(normalizeProductUrlTemplate(null)).toBeNull();
		expect(productUrlForHandle(null, "item")).toBeNull();
	});

	it.each([
		["/products/:handle", "/products/red%20shoe"],
		[
			"https://shop.example.test/products/:handle",
			"https://shop.example.test/products/red%20shoe",
		],
	])("builds an encoded href from %s", (template, expected) => {
		expect(normalizeProductUrlTemplate(template)).toBe(template);
		expect(productUrlForHandle(template, "red shoe")).toBe(expected);
	});

	it.each([undefined, "", ".", "..", "\ud800"])(
		"returns no href for unsafe handle %j",
		(handle) => expect(productUrlForHandle("/products/:handle", handle)).toBeNull(),
	);
	it("encodes path, query, HTML and Unicode characters in the handle as one value", () => {
		expect(productUrlForHandle("/catalog/:handle", 'shoe/雪?x=1&next=#"<tag>')).toBe(
			"/catalog/shoe%2F%E9%9B%AA%3Fx%3D1%26next%3D%23%22%3Ctag%3E",
		);
	});

	it.each([
		"//evil.test/products/:handle",
		"javascript:alert(1)/:handle",
		"http://shop.example.test/products/:handle",
		"https:/shop.example.test/products/:handle",
		"https:shop.example.test/products/:handle",
		"https://user:pass@shop.example.test/products/:handle",
		"https://:handle.example.test/emdash-product-handle",
		"https://shop.example.test/products/:handle?redirect=:handle",
		"/products/:handle/:handle",
		"/products/{handle}/:handle",
		"/products/:slug/:handle",
		"/products/:handler",
		"/products/:handle_suffix",
		"/products/../:handle",
		"/products/%2e%2e/:handle",
		"https://shop.example.test/products/%2E%2E/:handle",
		"/products/%GG/:handle",
		"https://shop.example.test/products/%GG/:handle",
		"/products/:handle\\evil",
		"/products/:handle\n",
	])("rejects unsafe template %j with sanitized CONFIGURATION error", (template) => {
		try {
			normalizeProductUrlTemplate(template);
			throw new Error("Expected template validation to fail");
		} catch (error) {
			expect(error).toBeInstanceOf(MedusaError);
			expect((error as MedusaError).code).toBe("CONFIGURATION");
			expect((error as Error).message).not.toContain(template);
		}
	});

	it("preserves the normalized template in plugin descriptor options", () => {
		expect(
			medusaPlugin({ allowedOrigins: [origin], productUrlTemplate: "/products/:handle" })
				.options,
		).toMatchObject({
			allowedOrigins: [origin],
			productUrlTemplate: "/products/:handle",
		});
		expect(medusaPlugin({ allowedOrigins: [origin] }).options?.productUrlTemplate).toBeNull();
	});

	it("validates product URL configuration during descriptor and runtime creation", () => {
		const invalid = { allowedOrigins: [origin], productUrlTemplate: "javascript:go/:handle" };
		expect(() => medusaPlugin(invalid)).toThrow(MedusaError);
		expect(() => createPlugin(invalid)).toThrow(MedusaError);
	});

	it("creates a runtime plugin with valid product URL configuration", () => {
		expect(() =>
			createPlugin({ allowedOrigins: [origin], productUrlTemplate: null }),
		).not.toThrow();
	});
});
