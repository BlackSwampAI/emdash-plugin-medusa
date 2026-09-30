import { Button, Input, Select } from "@cloudflare/kumo";
import { apiFetch, parseApiResponse } from "emdash/plugin-utils";
import { useCallback, useEffect, useState } from "react";

import type { Product, Region } from "../medusa/types";

type Result<T> = ({ ok: true } & T) | { ok: false; error: { code: string; message: string } };
interface Connection {
	backendReachable: boolean;
	keyAccepted: boolean;
	productApiReachable: boolean;
	region: Region | null;
	regionCount: number;
	pricingReady: boolean;
	channelId: string | null;
}

async function request<T>(route: string, body: object = {}): Promise<T> {
	const response = await apiFetch(`/_emdash/api/plugins/emdash-medusa/${route}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const result = await parseApiResponse<Result<T>>(response);
	if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
	return result;
}

function priceLabel(product: Product): string {
	if (!product.price) return "Price unavailable";
	try {
		return `From ${new Intl.NumberFormat(undefined, { style: "currency", currency: product.price.currencyCode }).format(product.price.amount)}`;
	} catch {
		return "Price unavailable";
	}
}

export function MedusaPage() {
	const [connection, setConnection] = useState<Connection | null>(null);
	const [products, setProducts] = useState<Product[]>([]);
	const [count, setCount] = useState(0);
	const [regions, setRegions] = useState<Region[]>([]);
	const [regionId, setRegionId] = useState("");
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");

	const search = useCallback(async (q: string) => {
		const result = await request<{ items: Product[]; count: number }>("products", {
			q,
			limit: 20,
			offset: 0,
		});
		setProducts(result.items);
		setCount(result.count);
	}, []);

	useEffect(() => {
		let cancelled = false;
		void request<{ items: Region[] }>("regions")
			.then((result) => {
				if (!cancelled) setRegions(result.items);
			})
			.catch((error: unknown) => {
				if (!cancelled)
					setMessage(
						error instanceof Error ? error.message : "Configure Medusa settings first.",
					);
			});
		void search("").catch((error: unknown) => {
			if (!cancelled)
				setMessage(error instanceof Error ? error.message : "Catalog unavailable.");
		});
		return () => {
			cancelled = true;
		};
	}, [search]);

	async function act(action: () => Promise<void>) {
		setBusy(true);
		setMessage("");
		try {
			await action();
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Request failed.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<main className="mx-auto max-w-5xl space-y-6 p-6">
			<header className="space-y-3">
				<h1 className="text-2xl font-semibold">Medusa commerce</h1>
				<p className="text-kumo-subtle">
					Live Store catalog references for EmDash content.
				</p>
				<a className="underline" href="/_emdash/admin/plugins/emdash-medusa/settings">
					Connection settings
				</a>
			</header>
			<section
				className="rounded-lg border p-5 space-y-4"
				aria-label="Connection diagnostics"
			>
				<h2 className="text-lg font-semibold">Connection</h2>
				<Button
					disabled={busy}
					onClick={() =>
						void act(async () => {
							const result = await request<Connection>("connection");
							setConnection(result);
							setRegionId(result.region?.id ?? "");
							setRegions((await request<{ items: Region[] }>("regions")).items);
						})
					}
				>
					Test connection
				</Button>
				{connection && (
					<dl className="grid grid-cols-2 gap-3">
						<dt>Backend reachable</dt>
						<dd>{connection.backendReachable ? "Yes" : "No"}</dd>
						<dt>Publishable key</dt>
						<dd>{connection.keyAccepted ? "Accepted" : "Rejected"}</dd>
						<dt>Product API</dt>
						<dd>{connection.productApiReachable ? "Reachable" : "Unavailable"}</dd>
						<dt>Default region</dt>
						<dd>
							{connection.region
								? `${connection.region.name} (${connection.region.currencyCode.toUpperCase()})`
								: "Not selected; prices unavailable"}
						</dd>
						<dt>Sales channel</dt>
						<dd>{connection.channelId ?? "Publishable key scope"}</dd>
					</dl>
				)}
				<div className="flex flex-wrap items-end gap-3">
					<Select
						label="Default region"
						value={regionId}
						items={Object.fromEntries(
							regions.map((region) => [
								region.id,
								`${region.name} (${region.currencyCode.toUpperCase()})`,
							]),
						)}
						onValueChange={(value) => setRegionId(value ?? "")}
					/>
					<Button
						variant="secondary"
						disabled={busy || !regionId}
						onClick={() =>
							void act(async () => {
								await request("configuration", { regionId });
								setConnection(await request<Connection>("connection"));
								await search(query);
								setMessage("Default region saved.");
							})
						}
					>
						Save region
					</Button>
				</div>
			</section>
			<p role="status" aria-live="polite">
				{message}
			</p>
			<section className="space-y-4" aria-label="Product catalog">
				<h2 className="text-lg font-semibold">Product catalog</h2>
				<form
					className="flex items-end gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						void act(() => search(query));
					}}
				>
					<Input
						label="Search products"
						value={query}
						maxLength={200}
						onChange={(event) => setQuery(event.target.value)}
					/>
					<Button type="submit" disabled={busy}>
						Search
					</Button>
				</form>
				<p className="text-sm text-kumo-subtle">
					Showing {products.length} of {count}. The product block picker loads the first
					100 products; search here does not select a block.
				</p>
				<div className="overflow-auto">
					<table className="w-full text-start text-sm">
						<thead>
							<tr>
								<th className="p-3">Product</th>
								<th className="p-3">Medusa ID</th>
								<th className="p-3">Variants</th>
								<th className="p-3">Catalog price</th>
							</tr>
						</thead>
						<tbody>
							{products.map((product) => (
								<tr key={product.id} className="border-t">
									<td className="p-3">
										<div className="flex items-center gap-3">
											{product.thumbnail && (
												<img
													src={product.thumbnail}
													alt=""
													width={48}
													height={48}
													loading="lazy"
												/>
											)}
											<span>{product.title}</span>
										</div>
									</td>
									<td className="p-3">
										<code>{product.id}</code>
									</td>
									<td className="p-3">{product.variantsCount}</td>
									<td className="p-3">{priceLabel(product)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				{!products.length && <p>No products found.</p>}
			</section>
		</main>
	);
}

export const pages = { "/": MedusaPage };
