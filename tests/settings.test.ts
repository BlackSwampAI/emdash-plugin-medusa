import { describe, expect, it } from "vitest";
import { approvedOrigins, normalizeBackendUrl, validateSettings } from "../src/settings";

const origin = "https://store.example.test";
const good = { backendUrl: `${origin}/`, publishableKey: "pk_test_123" };

describe("Medusa settings", () => {
	it("normalizes a URL and pins it to an exact approved HTTPS origin", () => {
		expect(normalizeBackendUrl("  https://store.example.test///  ")).toBe(origin);
		expect(approvedOrigins({ allowedOrigins: ["https://store.example.test/"] })).toEqual([
			origin,
		]);
		expect(validateSettings(good, [origin])).toMatchObject({
			backendUrl: origin,
			publishableKey: "pk_test_123",
		});
	});

	it.each([
		"http://store.example.test",
		"https://user:pass@store.example.test",
		"https://store.example.test/?x=1",
		"https://store.example.test/#x",
		"not a url",
		"",
	])("rejects unsafe or malformed backend URL %s", (backendUrl) => {
		expect(() => validateSettings({ ...good, backendUrl }, [origin])).toThrow();
	});

	it("rejects a different approved host and malformed approved origins", () => {
		expect(() =>
			validateSettings({ ...good, backendUrl: "https://other.example.test" }, [origin]),
		).toThrow(/not approved/i);
		expect(() =>
			approvedOrigins({ allowedOrigins: ["https://store.example.test/api"] }),
		).toThrow(/origins/i);
		expect(() => approvedOrigins({ allowedOrigins: ["https://*.example.test"] })).toThrow();
		expect(() => approvedOrigins({ allowedOrigins: [] })).toThrow();
	});

	it.each(["sk_admin_secret", "", "pk_", "pk_with spaces", null])(
		"rejects invalid publishable key %s",
		(publishableKey) => {
			expect(() => validateSettings({ ...good, publishableKey }, [origin])).toThrow();
		},
	);

	it.each([
		["regionId", "reg_!"],
		["salesChannelId", "sc_foo/../bar"],
	])("rejects malformed optional %s", (key, value) => {
		expect(() => validateSettings({ ...good, [key]: value }, [origin])).toThrow();
	});
});
