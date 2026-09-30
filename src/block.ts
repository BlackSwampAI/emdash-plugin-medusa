import type { PortableTextBlockConfig } from "emdash";

export interface MedusaProductBlock {
	_type: "medusa-product";
	_key?: string;
	productId: string;
	display: "card" | "featured";
	showPrice: boolean;
}

export const productBlock: PortableTextBlockConfig = {
	type: "medusa-product",
	label: "Medusa product",
	icon: "cube",
	description: "Reference a live Medusa product. Picker shows the first 100 products.",
	fields: [
		{
			type: "select",
			action_id: "productId",
			label: "Product (first 100)",
			options: [],
			optionsRoute: "product-options",
		},
		{
			type: "select",
			action_id: "display",
			label: "Display",
			options: [
				{ label: "Card", value: "card" },
				{ label: "Featured", value: "featured" },
			],
		},
		{ type: "toggle", action_id: "showPrice", label: "Show price" },
	],
};

/** Validate references at the rendering boundary; never carry a copied product snapshot. */
export function parseProductBlock(value: unknown): MedusaProductBlock | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const node = value as Record<string, unknown>;
	if (
		node._type !== "medusa-product" ||
		typeof node.productId !== "string" ||
		!/^prod_[A-Za-z0-9_-]{1,120}$/.test(node.productId)
	)
		return null;
	return {
		_type: "medusa-product",
		...(typeof node._key === "string" ? { _key: node._key } : {}),
		productId: node.productId,
		display: node.display === "featured" ? "featured" : "card",
		showPrice: node.showPrice !== false,
	};
}
