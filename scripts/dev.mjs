import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const local = resolve(root, ".local");
const backendUrl = "http://127.0.0.1:19000";
function compose(args, { capture = false } = {}) {
	const result = spawnSync("docker", ["compose", ...args], {
		cwd: root,
		stdio: capture ? "pipe" : "inherit",
		encoding: "utf8",
	});
	if (result.error) throw new Error("Cannot run Docker Compose.");
	return result;
}
async function request(path, { token, method = "GET", body } = {}) {
	const response = await fetch(`${backendUrl}${path}`, {
		method,
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		...(body ? { body: JSON.stringify(body) } : {}),
		signal: AbortSignal.timeout(15000),
		redirect: "error",
	});
	if (!response.ok)
		throw new Error(
			`Local Medusa ${method} ${path.split("?")[0]} returned ${response.status}.`,
		);
	return response.json();
}
async function waitHealthy() {
	const deadline = Date.now() + 240000;
	while (Date.now() < deadline) {
		try {
			if ((await fetch(`${backendUrl}/health`, { signal: AbortSignal.timeout(3000) })).ok)
				return;
		} catch {
			/* Booting. */
		}
		await delay(2000);
	}
	throw new Error(
		"Medusa did not start within 240 seconds. Inspect docker compose logs migrate medusa.",
	);
}
async function adminToken() {
	await mkdir(local, { recursive: true });
	let credentials;
	try {
		credentials = JSON.parse(await readFile(resolve(local, "seed-admin.json"), "utf8"));
	} catch {
		credentials = {
			email: "seed@example.test",
			password: randomBytes(24).toString("base64url"),
		};
	}
	const created = compose(
		[
			"exec",
			"-T",
			"medusa",
			"npx",
			"medusa",
			"user",
			"-e",
			credentials.email,
			"-p",
			credentials.password,
		],
		{ capture: true },
	);
	if (
		created.status !== 0 &&
		!/already exists|email.*exists/i.test(`${created.stdout}${created.stderr}`)
	) {
		throw new Error("Cannot provision the disposable local Medusa seed user.");
	}
	await writeFile(resolve(local, "seed-admin.json"), JSON.stringify(credentials), {
		mode: 0o600,
	});
	return (await request("/auth/user/emailpass", { method: "POST", body: credentials })).token;
}
async function seed() {
	let previous = {};
	try {
		previous = JSON.parse(await readFile(resolve(local, "medusa.json"), "utf8"));
	} catch {
		/* First seed. */
	}
	const apiKeyIds = {};
	const token = await adminToken();
	const get = (path) => request(path, { token });
	const post = (path, body) => request(path, { token, method: "POST", body });
	async function ensure(path, listKey, itemKey, key, value, body) {
		const items = (await get(`${path}?limit=100`))[listKey];
		return items.find((item) => item[key] === value) ?? (await post(path, body))[itemKey];
	}
	const us = await ensure("/admin/regions", "regions", "region", "name", "Lab United States", {
		name: "Lab United States",
		currency_code: "usd",
		countries: ["us"],
	});
	const eu = await ensure("/admin/regions", "regions", "region", "name", "Lab Germany", {
		name: "Lab Germany",
		currency_code: "eur",
		countries: ["de"],
	});
	const channel = await ensure(
		"/admin/sales-channels",
		"sales_channels",
		"sales_channel",
		"name",
		"Lab storefront",
		{ name: "Lab storefront" },
	);
	const second = await ensure(
		"/admin/sales-channels",
		"sales_channels",
		"sales_channel",
		"name",
		"Lab B2B",
		{ name: "Lab B2B" },
	);
	const collection = await ensure(
		"/admin/collections",
		"collections",
		"collection",
		"handle",
		"lab-featured",
		{ title: "Lab featured", handle: "lab-featured" },
	);
	const category = await ensure(
		"/admin/product-categories",
		"product_categories",
		"product_category",
		"handle",
		"lab-apparel",
		{ name: "Lab apparel", handle: "lab-apparel", is_active: true, is_internal: false },
	);
	async function key(title, salesChannelId, field) {
		const keys = (await get("/admin/api-keys?type=publishable&limit=100")).api_keys;
		let found =
			keys.find((item) => item.id === previous.apiKeyIds?.[field] && !item.revoked_at) ??
			keys.find((item) => item.title === title && !item.revoked_at);
		const savedToken =
			typeof previous[field] === "string" &&
			previous[field].startsWith("pk_") &&
			(!previous.apiKeyIds?.[field] || previous.apiKeyIds[field] === found?.id)
				? previous[field]
				: null;
		if (!found || !savedToken)
			found = (await post("/admin/api-keys", { title, type: "publishable" })).api_key;
		apiKeyIds[field] = found.id;
		await post(`/admin/api-keys/${found.id}/sales-channels`, { add: [salesChannelId] });
		return found.token ?? savedToken;
	}
	const publishableKey = await key("Lab Store key", channel.id, "publishableKey");
	const secondPublishableKey = await key("Lab B2B key", second.id, "secondPublishableKey");
	const definitions = [
		["hoodie", "Medusa Minimalist Hoodie", 48, 44],
		["tee", "Medusa Classic Tee", 24, 22],
		["pants", "Medusa Sweatpants", 40, 36],
		["tote", "Medusa Canvas Tote", 20, 18],
		["jacket", "Medusa B2B Exclusive Jacket", 120, 110],
		["sample", "Medusa Archival Sample", null, null],
	];
	const productIds = [];
	for (const [handle, title, usd, eur] of definitions) {
		const body = {
			title,
			handle: `lab-${handle}`,
			status: "published",
			collection_id: collection.id,
			categories: [{ id: category.id }],
			thumbnail: `http://127.0.0.1:14321/fixture-${handle}.svg`,
			sales_channels: (handle === "jacket" ? [second.id] : [channel.id, second.id]).map(
				(id) => ({ id }),
			),
			options: [{ title: "Size", values: ["Standard", "Large"] }],
			variants: ["Standard", "Large"].map((size, i) => ({
				title: size,
				sku: `LAB-${handle.toUpperCase()}-${i}`,
				manage_inventory: false,
				options: { Size: size },
				prices:
					usd === null
						? []
						: [
								{ currency_code: "usd", amount: usd + i * 6 },
								{ currency_code: "eur", amount: eur + i * 6 },
							],
			})),
		};
		const products = (await get(`/admin/products?handle=${encodeURIComponent(body.handle)}`))
			.products;
		const product =
			products.find((item) => item.handle === body.handle) ??
			(await post("/admin/products", body)).product;
		productIds.push(product.id);
	}
	await writeFile(
		resolve(local, "medusa.json"),
		JSON.stringify(
			{
				backendUrl,
				publishableKey,
				apiKeyIds,
				regionId: us.id,
				eurRegionId: eu.id,
				salesChannelId: channel.id,
				secondSalesChannelId: second.id,
				secondPublishableKey,
				productIds: productIds.slice(0, 5),
				scopedProductId: productIds[4],
				unpricedProductId: productIds[5],
				collectionId: collection.id,
				categoryId: category.id,
			},
			null,
			2,
		),
		{ mode: 0o600 },
	);
	try {
		await readFile(resolve(local, "encryption.json"));
	} catch {
		await writeFile(
			resolve(local, "encryption.json"),
			JSON.stringify({ key: `emdash_enc_v1_${randomBytes(32).toString("base64url")}` }),
			{ mode: 0o600 },
		);
	}
	console.log(
		"Medusa fixture ready: 6 products, two variants each, USD/EUR regions, two scoped channel keys. State is in .local/medusa.json.",
	);
}
const command = process.argv[2] ?? "up";
if (command === "up") {
	if (compose(["up", "--build", "--detach"]).status !== 0)
		throw new Error("Docker Compose startup failed.");
	await waitHealthy();
	await seed();
} else if (command === "down" || command === "reset") {
	if (compose(command === "reset" ? ["down", "--volumes"] : ["down"]).status !== 0)
		throw new Error("Docker Compose stop failed.");
	if (command === "reset") {
		await rm(resolve(local, "medusa.json"), { force: true });
		await rm(resolve(local, "seed-admin.json"), { force: true });
	}
} else {
	throw new Error("Use up, down, or reset.");
}
