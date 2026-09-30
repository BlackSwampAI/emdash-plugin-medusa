import { afterEach, describe, expect, it, vi } from "vitest";

let gateway: import("node:http").Server | undefined;
afterEach(async () => {
	vi.unstubAllGlobals();
	if (!gateway) return;
	const current = gateway;
	gateway = undefined;
	current.closeAllConnections();
	await new Promise<void>((resolve) => current.close(() => resolve()));
});

async function start() {
	const { startGateway } = (await import(
		new URL("../../dev/gateway.mjs", import.meta.url).href
	)) as { startGateway: (options: { port: number }) => Promise<import("node:http").Server> };
	gateway = await startGateway({ port: 0 });
	const address = gateway.address();
	if (!address || typeof address === "string") throw new Error("Gateway did not bind a TCP port");
	return `http://127.0.0.1:${address.port}`;
}

const key = "pk_gateway_test_key";
function stubBackend(upstream: typeof fetch) {
	const nodeFetch = globalThis.fetch.bind(globalThis);
	vi.stubGlobal("fetch", ((input: RequestInfo | URL, init?: RequestInit) => {
		const url = input instanceof Request ? input.url : String(input);
		return url.startsWith("http://127.0.0.1:19000/")
			? upstream(input, init)
			: nodeFetch(input, init);
	}) satisfies typeof fetch);
}

describe("read-only development Store gateway", () => {
	it("requires the publishable key and accepts only GET requests", async () => {
		const upstream = vi.fn(
			async () =>
				new Response('{"products":[]}', {
					headers: { "content-type": "application/json" },
				}),
		);
		stubBackend(upstream);
		const base = await start();
		const missing = await fetch(`${base}/store/products`);
		expect(missing.status).toBe(401);
		const write = await fetch(`${base}/store/products`, {
			method: "POST",
			headers: { "x-publishable-api-key": key },
		});
		expect(write.status).toBe(404);
		expect(upstream).not.toHaveBeenCalled();
	});

	it.each([
		"/admin/products",
		"/auth/user/emailpass",
		"/store/products/../../admin/products",
		"/store/products/prod_safe/variants",
		"/store/collections",
		"/store/products?Authorization=x",
		"/store/products?fields=id&url=http://127.0.0.1",
	])("blocks unapproved path or query %s", async (path) => {
		const upstream = vi.fn(async () => new Response("{}"));
		stubBackend(upstream);
		const base = await start();
		const response = await fetch(`${base}${path}`, {
			headers: { "x-publishable-api-key": key, authorization: "Bearer must-not-forward" },
		});
		expect([response.status]).toEqual([404]);
		expect(upstream).not.toHaveBeenCalled();
	});

	it("forwards only the public Store key and safe JSON headers to the fixed backend", async () => {
		const upstream = vi.fn(
			async (_url: RequestInfo | URL, _init?: RequestInit) =>
				new Response('{"products":[]}', {
					headers: { "content-type": "application/json" },
				}),
		);
		stubBackend(upstream);
		const base = await start();
		const response = await fetch(`${base}/store/products?q=Classic&limit=10`, {
			headers: {
				"x-publishable-api-key": key,
				authorization: "Bearer private-admin-token",
				cookie: "session=private",
			},
		});
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('{"products":[]}');
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(upstream).toHaveBeenCalledOnce();
		const [url, init] = upstream.mock.calls[0]!;
		expect(new URL(String(url)).origin).toBe("http://127.0.0.1:19000");
		expect(new URL(String(url)).pathname).toBe("/store/products");
		const headers = new Headers(init?.headers);
		expect(headers.get("x-publishable-api-key")).toBe(key);
		expect(headers.get("accept")).toBe("application/json");
		expect(headers.has("authorization")).toBe(false);
		expect(headers.has("cookie")).toBe(false);
	});

	it("rejects upstream redirects without following them or exposing auth headers", async () => {
		const upstream = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
			expect(init?.redirect).toBe("error");
			throw new TypeError("redirect rejected");
		});
		stubBackend(upstream);
		const base = await start();
		const response = await fetch(`${base}/store/products`, {
			headers: { "x-publishable-api-key": key },
		});
		expect(response.status).toBe(502);
		expect(await response.text()).toBe("");
		expect(upstream).toHaveBeenCalledOnce();
	});
});
