import { mkdtemp, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixture = join(repo, "dev/consumer");
const started = performance.now();
const temp = await mkdtemp(join(tmpdir(), "emdash-medusa-consumer-"));
const packDir = join(temp, "pack");
const consumer = join(temp, "consumer");
const run = (command, args, cwd, env = process.env) =>
	execFileSync(command, args, { cwd, stdio: "inherit", env });

try {
	await mkdir(packDir);
	await mkdir(consumer);
	const npmEnv = { ...process.env, npm_config_cache: join(temp, "npm-cache") };
	const packed = JSON.parse(
		execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", packDir], {
			cwd: repo,
			encoding: "utf8",
			env: npmEnv,
		}),
	)[0];
	if (
		packed.name !== "@blackswampai/emdash-plugin-medusa" ||
		packed.version !== "0.1.0" ||
		!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(packed.integrity)
	)
		throw new Error("npm pack returned unexpected plugin package metadata.");
	const tarball = join(packDir, basename(packed.filename));
	for (const file of [
		"package.json",
		"pnpm-lock.yaml",
		"astro.config.mjs",
		"tsconfig.json",
		"src",
	])
		await cp(join(fixture, file), join(consumer, file), { recursive: true });
	await cp(tarball, join(consumer, "emdash-plugin-medusa.tgz"));

	const archiveListing = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });
	const entries = archiveListing.split("\n").filter(Boolean);
	const forbidden = entries.filter((path) =>
		/(^|\/)(node_modules|\.env(?:\.|$)|\.local|dev|tests)(\/|$)/.test(path),
	);
	if (forbidden.length)
		throw new Error(`Unexpected private files in package: ${forbidden.join(", ")}`);
	for (const required of [
		"package/dist/index.mjs",
		"package/dist/index.d.mts",
		"package/dist/medusa/client.mjs",
		"package/src/admin/index.tsx",
		"package/src/astro/index.ts",
		"package/src/astro/MedusaProduct.astro",
	]) {
		if (!entries.includes(required))
			throw new Error(`Tarball is missing required consumer file: ${required}`);
	}

	const consumerLock = join(consumer, "pnpm-lock.yaml");
	const lockText = await readFile(consumerLock, "utf8");
	const marker = "TARBALL_INTEGRITY";
	if (lockText.split(marker).length !== 2)
		throw new Error("The fixture lockfile must contain exactly one tarball integrity marker.");
	await writeFile(consumerLock, lockText.replace(marker, packed.integrity));
	run("pnpm", ["install", "--frozen-lockfile"], consumer, {
		...process.env,
		npm_config_cache_dir: join(temp, "empty-pnpm-cache"),
	});
	run(
		"node",
		[
			"--input-type=module",
			"-e",
			`
		import assert from 'node:assert/strict';
		import { medusaPlugin } from '@blackswampai/emdash-plugin-medusa';
		import { createMedusaClient } from '@blackswampai/emdash-plugin-medusa/client';
		const descriptor = medusaPlugin({ allowedOrigins: ['https://commerce.example.com'], productUrlTemplate: '/products/:handle' });
		assert.equal(descriptor.id, 'emdash-medusa');
		assert.equal(descriptor.options.productUrlTemplate, '/products/:handle');
		assert.equal(typeof createMedusaClient, 'function');
	`,
		],
		consumer,
	);
	run("pnpm", ["exec", "astro", "check"], consumer);
	run("pnpm", ["exec", "astro", "build"], consumer);
	console.log(
		`Installed tarball consumer check passed (${entries.length} archive entries, ${((performance.now() - started) / 1000).toFixed(1)}s).`,
	);
} finally {
	await rm(temp, { recursive: true, force: true });
}
