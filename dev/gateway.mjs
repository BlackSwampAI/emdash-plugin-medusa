import { createServer } from "node:http";

const allowedPath = /^\/store\/(products(?:\/prod_[A-Za-z0-9_-]{1,120})?|regions)$/;
const allowedQuery = new Set(["q", "limit", "offset", "fields", "region_id", "sales_channel_id"]);

/** A development-only, read-only tunnel target. Never forwards admin/auth or arbitrary paths. */
export function startGateway({ backendUrl = "http://127.0.0.1:19000", port = 19001 } = {}) {
	const backend = new URL(backendUrl);
	if (backend.origin !== "http://127.0.0.1:19000" || backend.pathname !== "/") {
		throw new Error("The development gateway only targets the fixture at 127.0.0.1:19000.");
	}
	const server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url, "http://127.0.0.1");
			if (
				req.method !== "GET" ||
				!allowedPath.test(url.pathname) ||
				url.search.length > 2048 ||
				[...url.searchParams.keys()].some((key) => !allowedQuery.has(key))
			) {
				res.writeHead(404);
				res.end();
				return;
			}
			const key = req.headers["x-publishable-api-key"];
			if (typeof key !== "string" || !/^pk_[A-Za-z0-9_-]{1,500}$/.test(key)) {
				res.writeHead(401);
				res.end();
				return;
			}
			if (
				url.searchParams.has("limit") &&
				(!/^\d+$/.test(url.searchParams.get("limit")) ||
					Number(url.searchParams.get("limit")) > 100)
			) {
				res.writeHead(400);
				res.end();
				return;
			}
			const target = new URL(`${url.pathname}${url.search}`, backend);
			const response = await fetch(target, {
				headers: { "x-publishable-api-key": key, Accept: "application/json" },
				signal: AbortSignal.timeout(5000),
				redirect: "error",
			});
			const reader = response.body?.getReader();
			const parts = [];
			let size = 0;
			if (reader) {
				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					size += value.length;
					if (size > 1024 * 1024) {
						await reader.cancel();
						throw new Error("Response too large");
					}
					parts.push(Buffer.from(value));
				}
			}
			res.writeHead(response.status, {
				"Content-Type": "application/json",
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff",
			});
			res.end(Buffer.concat(parts));
		} catch {
			if (!res.headersSent) res.writeHead(502);
			res.end();
		}
	});
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => resolve(server));
	});
}
