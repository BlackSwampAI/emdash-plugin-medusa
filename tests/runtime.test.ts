import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createDialect as createSqliteDialect } from "emdash/db/sqlite";
import {
	EmDashRuntime,
	dispatchPluginApiRequest,
	handlePluginSettingsGet,
	handlePluginSettingsUpdate,
	type RuntimeDependencies,
} from "emdash/internal/plugin-test-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlugin } from "../src/index";

const runtimes: EmDashRuntime[] = [];
const SECRET = "pk_runtime_secret_value";
const ENC_KEY = `emdash_enc_v1_${Buffer.alloc(32, 9).toString("base64url")}`;
const ORIGIN = "https://127.0.0.1";
async function makeRuntime() {
	const dir = mkdtempSync(join(tmpdir(), "emdash-medusa-test-"));
	const dependencies = {
		config: {
			database: {
				entrypoint: `medusa-test-${basename(dir)}`,
				config: { url: `file:${join(dir, "test.sqlite")}` },
				type: "sqlite",
			},
		},
		plugins: [createPlugin({ allowedOrigins: [ORIGIN] })],
		createDialect: (config: any) => createSqliteDialect(config),
		createStorage: null,
		sandboxEnabled: false,
		sandboxedPluginEntries: [],
		createSandboxRunner: null,
	} as unknown as RuntimeDependencies;
	const runtime = await EmDashRuntime.create(dependencies);
	runtimes.push(runtime);
	(runtime as EmDashRuntime & { testDirectory: string }).testDirectory = dir;
	return runtime;
}
const user = (role: number) => ({
	id: `user-${role}`,
	email: "test@example.test",
	name: "Test",
	role,
	createdAt: new Date().toISOString(),
});
async function dispatch(
	runtime: EmDashRuntime,
	path: string,
	method = "POST",
	role?: number,
	tokenScopes: string[] | undefined = ["admin"],
) {
	const request = new Request(`https://cms.test/_emdash/api/plugins/emdash-medusa${path}`, {
		method,
		headers:
			method === "POST"
				? { "content-type": "application/json", "x-emdash-request": "1" }
				: undefined,
		...(method === "POST" ? { body: "{}" } : {}),
	});
	return dispatchPluginApiRequest({
		runtime,
		pluginId: "emdash-medusa",
		path: path.split("?")[0]!,
		request,
		...(role === undefined ? {} : { user: user(role) }),
		...(tokenScopes === undefined ? {} : { tokenScopes }),
	});
}
afterEach(async () => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	await Promise.all(
		runtimes.splice(0).map(async (rt) => {
			await rt.shutdown();
			rmSync((rt as EmDashRuntime & { testDirectory: string }).testDirectory, {
				recursive: true,
				force: true,
			});
		}),
	);
});

describe.sequential("native EmDash integration", () => {
	it("encrypts the publishable key at rest and omits it from settings GET and route responses", async () => {
		vi.stubEnv("EMDASH_ENCRYPTION_KEY", ENC_KEY);
		const runtime = await makeRuntime();
		const plugin = runtime.configuredPlugins.find((p) => p.id === "emdash-medusa")!;
		const schema = plugin.admin!.settingsSchema!;
		const update = await handlePluginSettingsUpdate(runtime.db, plugin.id, schema, {
			backendUrl: ORIGIN,
			publishableKey: SECRET,
			regionId: "reg_eu",
		});
		expect(update.success).toBe(true);
		expect(JSON.stringify(update)).not.toContain(SECRET);
		const saved = await runtime.db
			.selectFrom("options")
			.select("value")
			.where("name", "=", `plugin:${plugin.id}:settings:publishableKey`)
			.executeTakeFirstOrThrow();
		expect(saved.value).not.toContain(SECRET);
		expect(JSON.parse(saved.value)).toMatchObject({ $emdash: "plugin-setting", v: 1 });
		const read = await handlePluginSettingsGet(runtime.db, plugin.id, schema);
		expect(JSON.stringify(read)).not.toContain(SECRET);
		if (read.success) {
			expect(read.data.values).not.toHaveProperty("publishableKey");
			expect(read.data.secretsSet.publishableKey).toBe(true);
		}
		const noAuth = await dispatch(runtime, "/products");
		expect(noAuth.status).toBe(401);
		const noCsrf = await dispatchPluginApiRequest({
			runtime,
			pluginId: plugin.id,
			path: "/products",
			request: new Request("https://cms.test/", { method: "POST" }),
			user: user(50),
		});
		expect(noCsrf.status).toBe(403);
		const auth = await dispatch(runtime, "/products", "POST", 50);
		const body = await auth.text();
		expect(auth.status).toBe(200);
		expect(body).not.toContain(SECRET);
	});

	it("enforces product route as public GET only and rejects private routes without read permission", async () => {
		vi.stubEnv("EMDASH_ENCRYPTION_KEY", ENC_KEY);
		const runtime = await makeRuntime();
		const plugin = runtime.configuredPlugins.find((p) => p.id === "emdash-medusa")!;
		await handlePluginSettingsUpdate(runtime.db, plugin.id, plugin.admin!.settingsSchema!, {
			backendUrl: ORIGIN,
			publishableKey: SECRET,
		});
		const get = await dispatch(runtime, "/product?productId=invalid", "GET");
		expect(get.status).toBe(200);
		expect(await get.text()).not.toContain(SECRET);
		const post = await dispatch(runtime, "/product", "POST", 50);
		expect(post.status).toBe(405);
		const privateAnonymous = await dispatch(runtime, "/connection");
		expect(privateAnonymous.status).toBe(401);
		const privateWrongRole = await dispatch(runtime, "/configuration", "POST", 10);
		expect(privateWrongRole.status).toBe(403);
		const publicResponse = await dispatch(runtime, "/product?productId=invalid", "GET");
		expect(publicResponse.headers.get("cache-control")).toContain("no-store");
	});

	it("fails closed if secret encryption is unavailable", async () => {
		vi.stubEnv("EMDASH_ENCRYPTION_KEY", "");
		const runtime = await makeRuntime();
		const plugin = runtime.configuredPlugins.find((p) => p.id === "emdash-medusa")!;
		const result = await handlePluginSettingsUpdate(
			runtime.db,
			plugin.id,
			plugin.admin!.settingsSchema!,
			{ backendUrl: ORIGIN, publishableKey: SECRET },
		);
		expect(result.success).toBe(false);
		expect(JSON.stringify(result)).not.toContain(SECRET);
		await expect(
			runtime.db
				.selectFrom("options")
				.selectAll()
				.where("name", "=", `plugin:${plugin.id}:settings:publishableKey`)
				.executeTakeFirst(),
		).resolves.toBeUndefined();
	});
});
