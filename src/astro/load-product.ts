import type { PublicPluginApiRouteHandler } from "emdash/plugin-utils";
import { isSafeProductHref } from "../product-url";

export interface NormalizedPrice {
	amount: number;
	currencyCode: string;
	isTaxInclusive?: boolean;
}

export interface NormalizedProduct {
	id: string;
	title: string;
	href: string | null;
	handle?: string;
	thumbnail?: string | null;
	variantsCount?: number;
	price?: NormalizedPrice | null;
}

export interface LoadProductOptions {
	productId: string;
	baseUrl: URL;
	handlePublicPluginApiRoute?: PublicPluginApiRouteHandler;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatePrice(value: unknown): NormalizedPrice | null {
	if (!isRecord(value)) {
		return null;
	}
	if (typeof value.amount !== "number" || !Number.isFinite(value.amount) || value.amount < 0) {
		return null;
	}
	if (typeof value.currencyCode !== "string" || !/^[A-Za-z]{3}$/.test(value.currencyCode)) {
		return null;
	}
	const price: NormalizedPrice = {
		amount: value.amount,
		currencyCode: value.currencyCode,
	};
	if (typeof value.isTaxInclusive === "boolean") {
		price.isTaxInclusive = value.isTaxInclusive;
	}
	return price;
}

function validateProduct(value: unknown): NormalizedProduct | null {
	if (!isRecord(value)) {
		return null;
	}
	if (typeof value.id !== "string" || !value.id) {
		return null;
	}
	if (typeof value.title !== "string") {
		return null;
	}

	const product: NormalizedProduct = {
		id: value.id,
		title: value.title,
		href: isSafeProductHref(value.href) ? value.href : null,
	};

	if (typeof value.handle === "string") {
		product.handle = value.handle;
	}

	if (typeof value.thumbnail === "string" || value.thumbnail === null) {
		product.thumbnail = value.thumbnail;
	}

	if (typeof value.variantsCount === "number" && !Number.isNaN(value.variantsCount)) {
		product.variantsCount = value.variantsCount;
	}

	if (value.price === null) {
		product.price = null;
	} else if (value.price !== undefined) {
		product.price = validatePrice(value.price);
	}

	return product;
}

function parseProductPayload(payload: unknown): NormalizedProduct | null {
	if (!isRecord(payload) || payload.success !== true) {
		return null;
	}
	if (!isRecord(payload.data)) {
		return null;
	}
	const data = payload.data;
	if (data.ok !== true) {
		return null;
	}
	if (data.product === null) {
		return null;
	}
	return validateProduct(data.product);
}

/**
 * Loads a product via in-process dispatch using EmDash's public plugin route handler.
 * If handlePublicPluginApiRoute is missing or fails, safely returns null without falling back to network.
 */
export async function loadProduct(
	productId: string,
	baseUrl: URL,
	handlePublicPluginApiRoute?: PublicPluginApiRouteHandler,
): Promise<NormalizedProduct | null> {
	if (!handlePublicPluginApiRoute || !/^prod_[A-Za-z0-9_-]{1,120}$/.test(productId)) {
		return null;
	}

	try {
		const requestUrl = new URL("/_emdash/api/plugins/emdash-medusa/product", baseUrl);
		requestUrl.searchParams.set("productId", productId);

		const request = new Request(requestUrl.toString(), {
			method: "GET",
		});

		const response = await handlePublicPluginApiRoute(
			"emdash-medusa",
			"GET",
			"/product",
			request,
		);

		const product = parseProductPayload(response);
		return product?.id === productId ? product : null;
	} catch {
		return null;
	}
}
