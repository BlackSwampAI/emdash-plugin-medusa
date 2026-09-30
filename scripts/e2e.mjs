import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { configureSite, siteUrl } from "./dev-configure.mjs";

const linksDisabled = process.env.MEDUSA_DEMO_DISABLE_PRODUCT_LINKS === "1";
const artifacts = resolve(
	import.meta.dirname,
	linksDisabled ? "../.local/no-cta-screenshots" : "../docs/screenshots",
);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
let checks = 0;
try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
	const { fixture, item, api } = await configureSite(page);
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(`${siteUrl}/_emdash/admin/plugins/emdash-medusa`);
	await page.getByRole("heading", { name: "Medusa commerce" }).waitFor();
	await page.getByRole("button", { name: "Test connection" }).click();
	await page.getByText("Accepted", { exact: true }).waitFor();
	await page.getByText("Lab United States (USD)", { exact: true }).first().waitFor();
	assert(!(await page.locator("body").innerText()).includes(fixture.publishableKey));
	checks++;
	await page.screenshot({ path: resolve(artifacts, "admin-connection.png"), fullPage: true });
	await page.getByRole("textbox", { name: "Search products" }).fill("Classic");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await page.getByText("Showing 1 of 1.", { exact: false }).waitFor();
	assert.equal(await page.locator("tbody tr").count(), 1);
	assert.match(await page.locator("tbody").innerText(), /Medusa Classic Tee.*\$24\.00/s);
	checks++;
	await page.getByRole("combobox", { name: "Default region" }).click();
	await page.getByRole("option", { name: "Lab Germany (EUR)" }).click();
	await page.getByRole("button", { name: "Save region" }).click();
	await page.getByText("Default region saved.", { exact: true }).waitFor();
	assert.match(await page.locator("tbody").innerText(), /€22\.00/);
	checks++;
	await api("/_emdash/api/plugins/emdash-medusa/configuration", "POST", {
		regionId: fixture.regionId,
	});

	await page.goto(`${siteUrl}/_emdash/admin/content/pages/${item.id}`);
	await page.getByRole("button", { name: "Edit", exact: true }).first().click();
	await page.getByRole("combobox", { name: "Product (first 100)" }).click();
	await page.getByRole("option", { name: "Medusa Canvas Tote", exact: true }).waitFor();
	await page.screenshot({ path: resolve(artifacts, "product-picker.png"), fullPage: true });
	await page.getByRole("option", { name: "Medusa Canvas Tote", exact: true }).click();
	await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
	const deadline = Date.now() + 15000;
	let saved;
	do {
		saved = await api(`/_emdash/api/content/pages/${item.id}`);
		if (saved.item.data.content[0].productId === fixture.productIds[3]) break;
		await new Promise((resolveWait) => setTimeout(resolveWait, 250));
	} while (Date.now() < deadline);
	const selected = saved.item.data.content[0];
	assert.equal(selected.productId, fixture.productIds[3]);
	assert.deepEqual(
		Object.keys(selected).sort(),
		["_key", "_type", "display", "productId", "showPrice"].sort(),
	);
	checks++;
	await page.screenshot({ path: resolve(artifacts, "saved-product-block.png"), fullPage: true });
	// Restore the repeatable demo after proving editor selection and autosave.
	await configureSite(page);
	const publicContext = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
	const storefront = await publicContext.newPage();
	await storefront.goto(siteUrl);
	await storefront.locator(`[data-medusa-product-id="${fixture.productIds[0]}"]`).waitFor();
	assert.equal(await storefront.locator("[data-medusa-product-id]").count(), 3);
	assert.match(
		await storefront.locator(`[data-medusa-product-id="${fixture.productIds[0]}"]`).innerText(),
		/\$48\.00/,
	);
	checks++;
	assert.match(
		await storefront
			.locator(`[data-medusa-product-id="${fixture.unpricedProductId}"]`)
			.innerText(),
		/Price unavailable/,
	);
	checks++;
	const productLinks = storefront.locator("[data-medusa-product-id] a");
	if (linksDisabled) {
		assert.equal(await productLinks.count(), 0);
	} else {
		assert.equal(await productLinks.count(), 3);
		assert.equal(
			await storefront
				.locator(`[data-medusa-product-id="${fixture.productIds[0]}"] a`)
				.getAttribute("href"),
			"/products/lab-hoodie",
		);
	}
	checks++;
	assert.equal(await storefront.locator("[data-medusa-product-empty]").count(), 1);
	assert(!(await storefront.content()).includes(fixture.publishableKey));
	assert.deepEqual(errors, []);
	checks++;
	await storefront.screenshot({
		path: resolve(artifacts, "astro-storefront.png"),
		fullPage: true,
	});
	await writeFile(
		resolve(artifacts, "results.json"),
		JSON.stringify(
			{
				checks,
				scenarios: [
					"connection diagnostics and no key in DOM",
					"native admin Store search",
					"USD to EUR region pricing",
					"editor selection and reference-only serialization",
					"valid live SSR product",
					"unpriced product",
					linksDisabled ? "disabled product CTA" : "site-configured product CTA",
					"deleted product and browser boundary",
				],
				emdash: "1.0.1",
				medusa: "2.21.2",
			},
			null,
			"\t",
		) + "\n",
	);
	console.log(
		`${checks} browser scenarios passed; four screenshots in ${linksDisabled ? ".local/no-cta-screenshots" : "docs/screenshots"}.`,
	);
} finally {
	await browser.close();
}
