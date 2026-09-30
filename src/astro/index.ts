/**
 * Astro exports for the Medusa plugin.
 *
 * Registers Portable Text block renderers for Medusa products.
 */

import MedusaProduct from "./MedusaProduct.astro";

export { MedusaProduct };

export const blockComponents = {
	"medusa-product": MedusaProduct,
};
