import { MedusaError } from "./errors.js";
import type {
	FetchImpl,
	ListProductsParams,
	ListProductsResult,
	MedusaClient,
	MedusaClientConfig,
	Price,
	Product,
	Region,
} from "./types.js";

export * from "./errors.js";
export * from "./types.js";

const PRODUCT_ID_REGEX = /^prod_[A-Za-z0-9_-]+$/;
const REQUEST_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 1024 * 1024; // 1 MiB
const MAX_LIST_LIMIT = 100;
const MAX_QUERY_LENGTH = 200;

function validateBackendUrl(rawUrl: string): string {
	if (typeof rawUrl !== "string" || !rawUrl.trim()) {
		throw new MedusaError("REQUEST", "Invalid backend URL");
	}

	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new MedusaError("REQUEST", "Invalid backend URL");
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new MedusaError("REQUEST", "Backend URL must use http or https protocol");
	}

	if (parsed.username || parsed.password) {
		throw new MedusaError("REQUEST", "Backend URL must not contain credentials");
	}

	if (parsed.search || parsed.hash) {
		throw new MedusaError("REQUEST", "Backend URL must not contain query parameters or hash");
	}

	return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

function sanitizeThumbnail(raw: unknown): string | null {
	if (typeof raw !== "string") {
		return null;
	}
	const trimmed = raw.trim();
	if (!trimmed) {
		return null;
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return null;
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return null;
	}

	if (parsed.username || parsed.password) {
		return null;
	}

	return parsed.href;
}

interface RawCalculatedPrice {
	calculated_amount?: unknown;
	currency_code?: unknown;
	is_calculated_price_tax_inclusive?: unknown;
}

interface RawVariant {
	id?: unknown;
	calculated_price?: unknown;
}

export function normalizeProduct(raw: unknown): Product {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new MedusaError("INVALID_RESPONSE", "Invalid product data: expected an object");
	}

	const obj = raw as Record<string, unknown>;

	if (typeof obj.id !== "string" || !PRODUCT_ID_REGEX.test(obj.id)) {
		throw new MedusaError(
			"INVALID_RESPONSE",
			"Invalid product data: invalid or missing product id",
		);
	}

	if (typeof obj.title !== "string") {
		throw new MedusaError(
			"INVALID_RESPONSE",
			"Invalid product data: missing or non-string title",
		);
	}

	const id = obj.id;
	const title = obj.title;

	let handle: string | null = null;
	if (typeof obj.handle === "string") {
		handle = obj.handle;
	} else if (obj.handle === null || obj.handle === undefined) {
		handle = null;
	} else {
		throw new MedusaError("INVALID_RESPONSE", "Invalid product data: invalid handle");
	}

	const thumbnail = sanitizeThumbnail(obj.thumbnail);

	if (!Array.isArray(obj.variants)) {
		throw new MedusaError(
			"INVALID_RESPONSE",
			"Invalid product data: variants must be an array",
		);
	}

	const variantsList = obj.variants as unknown[];
	for (const v of variantsList) {
		if (typeof v !== "object" || v === null || Array.isArray(v)) {
			throw new MedusaError("INVALID_RESPONSE", "Invalid variant entry: expected an object");
		}
		const variantObj = v as RawVariant;
		if (typeof variantObj.id !== "string" || !variantObj.id.trim()) {
			throw new MedusaError(
				"INVALID_RESPONSE",
				"Invalid variant entry: missing or invalid variant id",
			);
		}
	}

	const variantsCount = variantsList.length;

	let computedPrice: Price | null = null;
	const candidatePrices: Array<{
		amount: number;
		currencyCode: string;
		isTaxInclusive: boolean;
	}> = [];

	for (const v of variantsList) {
		const variantObj = v as RawVariant;
		if (
			typeof variantObj.calculated_price === "object" &&
			variantObj.calculated_price !== null &&
			!Array.isArray(variantObj.calculated_price)
		) {
			const cp = variantObj.calculated_price as RawCalculatedPrice;
			const amt = cp.calculated_amount;
			const curr = cp.currency_code;
			const taxInc = cp.is_calculated_price_tax_inclusive;

			if (
				typeof amt === "number" &&
				Number.isFinite(amt) &&
				amt >= 0 &&
				typeof curr === "string" &&
				/^[A-Za-z]{3}$/.test(curr)
			) {
				candidatePrices.push({
					amount: amt,
					currencyCode: curr.toLowerCase(),
					isTaxInclusive: Boolean(taxInc),
				});
			}
		}
	}

	if (candidatePrices.length > 0) {
		const firstCurrency = candidatePrices[0]!.currencyCode;
		const sameCurrency = candidatePrices.every((p) => p.currencyCode === firstCurrency);

		if (sameCurrency) {
			let minEntry = candidatePrices[0]!;
			for (let i = 1; i < candidatePrices.length; i++) {
				const curr = candidatePrices[i]!;
				if (curr.amount < minEntry.amount) {
					minEntry = curr;
				}
			}

			const consistentMinTax = candidatePrices.every(
				(p) => p.isTaxInclusive === minEntry.isTaxInclusive,
			);

			if (consistentMinTax) {
				computedPrice = {
					amount: minEntry.amount,
					currencyCode: minEntry.currencyCode,
					isTaxInclusive: minEntry.isTaxInclusive,
				};
			}
		}
	}

	return {
		id,
		title,
		handle,
		thumbnail,
		variantsCount,
		price: computedPrice,
	};
}

async function readLimitedBody(response: Response, limitBytes: number): Promise<string> {
	const contentLengthHeader = response.headers.get("content-length");
	if (contentLengthHeader !== null) {
		const parsedLength = parseInt(contentLengthHeader, 10);
		if (!Number.isNaN(parsedLength) && parsedLength > limitBytes) {
			throw new MedusaError("INVALID_RESPONSE", "Response body exceeded size limit");
		}
	}

	if (!response.body) {
		const text = await response.text();
		if (new TextEncoder().encode(text).length > limitBytes) {
			throw new MedusaError("INVALID_RESPONSE", "Response body exceeded size limit");
		}
		return text;
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				totalBytes += value.byteLength;
				if (totalBytes > limitBytes) {
					try {
						await reader.cancel();
					} catch {
						// Ignore cancel errors
					}
					throw new MedusaError("INVALID_RESPONSE", "Response body exceeded size limit");
				}
				chunks.push(value);
			}
		}
	} catch (err: unknown) {
		if (err instanceof MedusaError) {
			throw err;
		}
		throw new MedusaError("INVALID_RESPONSE", "Error reading response body");
	}

	const combined = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return new TextDecoder().decode(combined);
}

async function safeFetch(
	fetchImpl: FetchImpl,
	url: string,
	publishableKey: string,
): Promise<{ status: number; bodyText: string }> {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout>;
	let response: Response | undefined;
	const deadline = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			controller.abort();
			void response?.body?.cancel().catch(() => {});
			reject(new MedusaError("TIMEOUT", "Medusa request timed out."));
		}, REQUEST_TIMEOUT_MS);
	});
	const operation = async () => {
		try {
			response = await fetchImpl(url, {
				method: "GET",
				headers: { "x-publishable-api-key": publishableKey, Accept: "application/json" },
				signal: controller.signal,
				redirect: "error",
			});
			if (response.status >= 300 && response.status < 400) {
				await response.body?.cancel();
				throw new MedusaError(
					"REQUEST",
					"Medusa redirects are not allowed.",
					response.status,
				);
			}
			// Error response text is unnecessary for diagnostics and may contain credentials.
			if (!response.ok) {
				await response.body?.cancel();
				return { status: response.status, bodyText: "" };
			}
			const bodyText = await readLimitedBody(response, MAX_RESPONSE_BYTES);
			return { status: response.status, bodyText };
		} catch (error) {
			if (controller.signal.aborted)
				throw new MedusaError("TIMEOUT", "Medusa request timed out.");
			if (error instanceof MedusaError) throw error;
			throw new MedusaError(
				"NETWORK",
				"Medusa network request failed. Check public reachability and EmDash network policy.",
			);
		}
	};
	try {
		return await Promise.race([operation(), deadline]);
	} finally {
		clearTimeout(timer!);
	}
}

function parseJson(bodyText: string): unknown {
	try {
		return JSON.parse(bodyText);
	} catch {
		throw new MedusaError("INVALID_RESPONSE", "Malformed JSON response");
	}
}

function handleStatusErrors(status: number): void {
	if (status >= 200 && status < 300) {
		return;
	}
	if (status === 400 || status === 401 || status === 403) {
		throw new MedusaError(
			"AUTHENTICATION",
			"Medusa rejected the key or request context (region, channel or fields).",
			status,
		);
	}
	if (status >= 400 && status < 500) {
		throw new MedusaError("REQUEST", "Request failed with client error", status);
	}
	if (status >= 500) {
		throw new MedusaError("UNAVAILABLE", "Upstream service unavailable", status);
	}
	throw new MedusaError("REQUEST", "Request failed", status);
}

export function createMedusaClient(config: MedusaClientConfig, fetchImpl: FetchImpl): MedusaClient {
	const baseUrl = validateBackendUrl(config.backendUrl);

	if (typeof config.publishableKey !== "string" || !config.publishableKey.trim()) {
		throw new MedusaError("REQUEST", "publishableKey is required");
	}
	const publishableKey = config.publishableKey.trim();

	const regionId =
		typeof config.regionId === "string" && config.regionId.trim()
			? config.regionId.trim()
			: undefined;
	const salesChannelId =
		typeof config.salesChannelId === "string" && config.salesChannelId.trim()
			? config.salesChannelId.trim()
			: undefined;

	function buildProductFields(): string {
		const baseFields = ["id", "title", "handle", "thumbnail", "variants.id"];
		if (regionId) {
			baseFields.push("+variants.calculated_price");
		}
		return baseFields.join(",");
	}

	return {
		async listProducts(params?: ListProductsParams): Promise<ListProductsResult> {
			let limit = 20;
			let offset = 0;
			let q: string | undefined;

			if (params) {
				if (params.limit !== undefined) {
					if (
						typeof params.limit !== "number" ||
						!Number.isInteger(params.limit) ||
						params.limit < 0
					) {
						throw new MedusaError("REQUEST", "Invalid limit parameter");
					}
					limit = Math.min(params.limit, MAX_LIST_LIMIT);
				}
				if (params.offset !== undefined) {
					if (
						typeof params.offset !== "number" ||
						!Number.isInteger(params.offset) ||
						params.offset < 0
					) {
						throw new MedusaError("REQUEST", "Invalid offset parameter");
					}
					offset = params.offset;
				}
				if (params.q !== undefined) {
					if (typeof params.q !== "string") {
						throw new MedusaError("REQUEST", "Invalid query parameter");
					}
					if (params.q.length > MAX_QUERY_LENGTH) {
						throw new MedusaError("REQUEST", "Query parameter exceeds maximum length");
					}
					q = params.q;
				}
			}

			const url = new URL(`${baseUrl}/store/products`);
			url.searchParams.set("fields", buildProductFields());
			url.searchParams.set("limit", String(limit));
			url.searchParams.set("offset", String(offset));

			if (q !== undefined && q.length > 0) {
				url.searchParams.set("q", q);
			}
			if (regionId) {
				url.searchParams.set("region_id", regionId);
			}
			if (salesChannelId) {
				url.searchParams.set("sales_channel_id", salesChannelId);
			}

			const res = await safeFetch(fetchImpl, url.toString(), publishableKey);
			handleStatusErrors(res.status);

			const json = parseJson(res.bodyText);
			if (typeof json !== "object" || json === null || Array.isArray(json)) {
				throw new MedusaError(
					"INVALID_RESPONSE",
					"Invalid list response: expected root object",
				);
			}

			const obj = json as Record<string, unknown>;
			if (!Array.isArray(obj.products)) {
				throw new MedusaError(
					"INVALID_RESPONSE",
					"Invalid list response: missing products array",
				);
			}
			if (
				typeof obj.count !== "number" ||
				!Number.isSafeInteger(obj.count) ||
				obj.count < 0
			) {
				throw new MedusaError(
					"INVALID_RESPONSE",
					"Invalid list response: missing or invalid count",
				);
			}
			const count = obj.count;
			const respOffset =
				typeof obj.offset === "number" && Number.isFinite(obj.offset) ? obj.offset : offset;
			const respLimit =
				typeof obj.limit === "number" && Number.isFinite(obj.limit) ? obj.limit : limit;

			if (obj.products.length > limit)
				throw new MedusaError("INVALID_RESPONSE", "Medusa returned too many products.");
			const items = obj.products.map((p) => {
				const product = normalizeProduct(p);
				return { ...product, price: regionId ? product.price : null };
			});

			return {
				items,
				count,
				offset: respOffset,
				limit: respLimit,
			};
		},

		async getProduct(productId: string): Promise<Product | null> {
			if (typeof productId !== "string" || !PRODUCT_ID_REGEX.test(productId)) {
				throw new MedusaError("REQUEST", "Invalid productId format");
			}

			const url = new URL(`${baseUrl}/store/products/${encodeURIComponent(productId)}`);
			url.searchParams.set("fields", buildProductFields());
			if (regionId) {
				url.searchParams.set("region_id", regionId);
			}
			if (salesChannelId) {
				url.searchParams.set("sales_channel_id", salesChannelId);
			}

			const res = await safeFetch(fetchImpl, url.toString(), publishableKey);

			if (res.status === 404) {
				return null;
			}

			handleStatusErrors(res.status);

			const json = parseJson(res.bodyText);
			if (typeof json !== "object" || json === null || Array.isArray(json)) {
				throw new MedusaError(
					"INVALID_RESPONSE",
					"Invalid product response: expected root object",
				);
			}

			const obj = json as Record<string, unknown>;
			if (!obj.product || typeof obj.product !== "object" || Array.isArray(obj.product)) {
				throw new MedusaError(
					"INVALID_RESPONSE",
					"Invalid product response: missing product property",
				);
			}

			const product = normalizeProduct(obj.product);
			if (product.id !== productId) {
				throw new MedusaError("INVALID_RESPONSE", "Mismatched response product ID");
			}

			return { ...product, price: regionId ? product.price : null };
		},

		async listRegions(): Promise<Region[]> {
			const url = new URL(`${baseUrl}/store/regions`);
			url.searchParams.set("limit", "100");
			url.searchParams.set("offset", "0");

			const res = await safeFetch(fetchImpl, url.toString(), publishableKey);
			handleStatusErrors(res.status);

			const json = parseJson(res.bodyText);
			if (typeof json !== "object" || json === null || Array.isArray(json)) {
				throw new MedusaError(
					"INVALID_RESPONSE",
					"Invalid regions response: expected root object",
				);
			}

			const obj = json as Record<string, unknown>;
			if (!Array.isArray(obj.regions)) {
				throw new MedusaError(
					"INVALID_RESPONSE",
					"Invalid regions response: missing regions array",
				);
			}

			const regions: Region[] = [];
			if (obj.regions.length > 100 || (typeof obj.count === "number" && obj.count > 100))
				throw new MedusaError(
					"INVALID_RESPONSE",
					"This slice supports at most 100 regions.",
				);
			const seen = obj.regions;
			for (const r of seen) {
				if (typeof r !== "object" || r === null || Array.isArray(r)) {
					throw new MedusaError(
						"INVALID_RESPONSE",
						"Invalid region entry: expected object",
					);
				}
				const regObj = r as Record<string, unknown>;
				if (
					typeof regObj.id !== "string" ||
					!/^reg_[A-Za-z0-9_-]{1,120}$/.test(regObj.id)
				) {
					throw new MedusaError("INVALID_RESPONSE", "Invalid region entry: missing id");
				}
				if (typeof regObj.name !== "string") {
					throw new MedusaError("INVALID_RESPONSE", "Invalid region entry: missing name");
				}
				if (
					typeof regObj.currency_code !== "string" ||
					!/^[A-Za-z]{3}$/.test(regObj.currency_code)
				) {
					throw new MedusaError(
						"INVALID_RESPONSE",
						"Invalid region entry: missing currency_code",
					);
				}

				regions.push({
					id: regObj.id,
					name: regObj.name,
					currencyCode: regObj.currency_code.toLowerCase(),
				});
			}

			return regions;
		},
	};
}
