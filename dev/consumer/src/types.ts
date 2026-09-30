import type { MedusaPluginOptions, MedusaProductBlock } from "@blackswampai/emdash-plugin-medusa";
import type { MedusaClientConfig, Product } from "@blackswampai/emdash-plugin-medusa/client";

export const pluginOptions: MedusaPluginOptions = {
	allowedOrigins: ["https://commerce.example.com"],
	productUrlTemplate: "/products/:handle",
};

export const productBlock: MedusaProductBlock = {
	_type: "medusa-product",
	productId: "prod_fixture",
	display: "card",
	showPrice: true,
};

export const clientConfig: MedusaClientConfig = {
	backendUrl: "https://commerce.example.com",
	publishableKey: "pk_fixture",
};

export type ConsumerProduct = Product;
