import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
export const siteUrl = "http://127.0.0.1:14321";

export async function configureSite(page) {
	const fixture = JSON.parse(await readFile(resolve(root, ".local/medusa.json"), "utf8"));
	const tunnel = JSON.parse(await readFile(resolve(root, ".local/tunnel.json"), "utf8"));
	await page.goto(
		`${siteUrl}/_emdash/api/setup/dev-bypass?content=0&redirect=/_emdash/api/auth/me`,
	);
	await page.waitForURL((url) => url.pathname === "/_emdash/api/auth/me", { timeout: 30000 });
	async function api(path, method = "GET", body) {
		const response = await page.request.fetch(`${siteUrl}${path}`, {
			method,
			headers: { "X-EmDash-Request": "1" },
			...(body === undefined ? {} : { data: body }),
		});
		const result = await response.json();
		if (!response.ok() || !result.success)
			throw new Error(
				`EmDash ${method} ${path} failed (${response.status()}): ${result.error?.code ?? "UNKNOWN"}`,
			);
		return result.data;
	}
	await api("/_emdash/api/auth/me", "POST", { action: "dismissWelcome" });
	await api("/_emdash/api/admin/plugins/emdash-medusa/settings", "PUT", {
		values: {
			backendUrl: tunnel.backendUrl,
			publishableKey: fixture.publishableKey,
			regionId: fixture.regionId,
			salesChannelId: fixture.salesChannelId,
		},
	});
	const block = (productId, key, display = "card", showPrice = true) => ({
		_type: "medusa-product",
		_key: key,
		productId,
		display,
		showPrice,
	});
	const content = [
		block(fixture.productIds[0], "hoodie", "featured"),
		block(fixture.productIds[1], "tee"),
		block(fixture.unpricedProductId, "sample"),
		block("prod_deleted_demo", "deleted"),
	];
	const pages = await api("/_emdash/api/content/pages?q=Medusa%20integration%20lab");
	let item = pages.items?.find((entry) => entry.slug === "medusa-demo");
	if (!item) {
		const created = await api("/_emdash/api/content/pages", "POST", {
			slug: "medusa-demo",
			data: { title: "Medusa integration lab", content },
		});
		item = created.item;
	} else {
		const current = await api(`/_emdash/api/content/pages/${item.id}`);
		const updated = await api(`/_emdash/api/content/pages/${item.id}`, "PUT", {
			_rev: current._rev,
			data: { title: "Medusa integration lab", content },
		});
		item = updated.item;
	}
	const current = await api(`/_emdash/api/content/pages/${item.id}`);
	await api(`/_emdash/api/content/pages/${item.id}/publish`, "POST", { _rev: current._rev });
	await writeFile(
		resolve(root, ".local/page.json"),
		JSON.stringify(
			{ id: item.id, editorUrl: `${siteUrl}/_emdash/admin/content/pages/${item.id}` },
			null,
			2,
		),
	);
	const connection = await api("/_emdash/api/plugins/emdash-medusa/connection", "POST", {});
	if (!connection.ok)
		throw new Error(
			`Medusa connection failed: ${connection.error.code}. ${connection.error.message}`,
		);
	return { fixture, item, api };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await configureSite(page);
		console.log(
			`Configured encrypted settings, published reference blocks, and verified Medusa connection. Open ${siteUrl}.`,
		);
		console.log(
			`Local admin login: ${siteUrl}/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin`,
		);
	} finally {
		await browser.close();
	}
}
