import { MedusaError } from "./medusa/errors";

const CONFIGURATION_MESSAGE =
	"Configure productUrlTemplate as a root-relative path or HTTPS URL with one :handle placeholder.";

function hasUnsafeCharacters(value: string): boolean {
	return (
		value.includes("\\") ||
		/\s/.test(value) ||
		[...value].some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

function hasUnsafePathSegments(path: string): boolean {
	return path.split("/").some((part) => {
		try {
			const decoded = decodeURIComponent(part);
			return decoded === "." || decoded === "..";
		} catch {
			return true;
		}
	});
}

/**
 * Normalize a root-relative or absolute HTTPS storefront path with one :handle placeholder.
 * Query strings, fragments, and other placeholder syntax are not supported. Null disables links.
 */
export function normalizeProductUrlTemplate(value: unknown): string | null {
	if (value === undefined || value === null) return null;
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > 2048 ||
		hasUnsafeCharacters(value) ||
		value.includes("?") ||
		value.includes("#") ||
		/[{}$]/.test(value) ||
		(value.match(/:[A-Za-z_][A-Za-z0-9_]*/g) ?? []).some((token) => token !== ":handle") ||
		(value.match(/:handle/g) ?? []).length !== 1
	) {
		throw new MedusaError("CONFIGURATION", CONFIGURATION_MESSAGE);
	}

	const placeholder = "emdash-product-handle";
	const candidate = value.replace(":handle", placeholder);
	if (candidate.startsWith("/")) {
		if (candidate.startsWith("//")) {
			throw new MedusaError("CONFIGURATION", CONFIGURATION_MESSAGE);
		}
		if (!value.includes(":handle") || hasUnsafePathSegments(candidate)) {
			throw new MedusaError("CONFIGURATION", CONFIGURATION_MESSAGE);
		}
		return value;
	}

	try {
		const match = value.match(/^https:\/\/([^/?#]+)(\/[^?#]*)?$/i);
		if (!match || match[1]!.includes(":handle")) throw new Error();
		const rawPath = match[2] ?? "/";
		if (!rawPath.includes(":handle") || hasUnsafePathSegments(rawPath)) throw new Error();
		const url = new URL(candidate);
		if (
			url.protocol !== "https:" ||
			!url.hostname ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		) {
			throw new Error();
		}
		return value;
	} catch {
		throw new MedusaError("CONFIGURATION", CONFIGURATION_MESSAGE);
	}
}

/** Build a safe product href, returning null when the handle cannot be represented. */
export function productUrlForHandle(
	template: string | null | undefined,
	handle: unknown,
): string | null {
	if (!template || typeof handle !== "string" || !handle || handle === "." || handle === "..") {
		return null;
	}
	try {
		const href = template.replace(":handle", encodeURIComponent(handle));
		if (template.startsWith("/")) {
			if (href.startsWith("//") || href.includes("\\")) return null;
			return href;
		}
		const url = new URL(href);
		if (url.protocol !== "https:" || url.username || url.password) return null;
		return url.href;
	} catch {
		return null;
	}
}

/** Defense-in-depth check for href values arriving at the Astro component boundary. */
export function isSafeProductHref(value: unknown): value is string {
	if (
		typeof value !== "string" ||
		!value ||
		hasUnsafeCharacters(value) ||
		value.startsWith("//")
	) {
		return false;
	}
	if (value.startsWith("/")) return true;
	try {
		const url = new URL(value);
		return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;
	} catch {
		return false;
	}
}
