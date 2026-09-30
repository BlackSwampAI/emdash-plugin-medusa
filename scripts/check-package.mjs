import { readFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
for (const entry of Object.values(pkg.exports)) {
	for (const path of typeof entry === "string" ? [entry] : Object.values(entry)) {
		await access(new URL(`../${path}`, import.meta.url));
	}
}
const pack = JSON.parse(
	execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" }),
)[0];
if (pack.files.some(({ path }) => /^(dev\/|tests\/|\.local\/|\.env|node_modules\/)/.test(path))) {
	throw new Error("The package includes private development artifacts.");
}
console.log(
	`Package exports exist; ${pack.files.length} files, ${pack.unpackedSize} unpacked bytes.`,
);
