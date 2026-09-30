export interface MedusaClientConfig {
	backendUrl: string;
	publishableKey: string;
	regionId?: string;
	salesChannelId?: string;
}

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export interface Price {
	amount: number;
	currencyCode: string;
	isTaxInclusive: boolean;
}

export interface Product {
	id: string;
	title: string;
	handle: string | null;
	thumbnail: string | null;
	variantsCount: number;
	price: Price | null;
}

export interface ListProductsParams {
	q?: string;
	limit?: number;
	offset?: number;
}

export interface ListProductsResult {
	items: Product[];
	count: number;
	offset: number;
	limit: number;
}

export interface Region {
	id: string;
	name: string;
	currencyCode: string;
}

export interface MedusaClient {
	listProducts(params?: ListProductsParams): Promise<ListProductsResult>;
	getProduct(productId: string): Promise<Product | null>;
	listRegions(): Promise<Region[]>;
}
