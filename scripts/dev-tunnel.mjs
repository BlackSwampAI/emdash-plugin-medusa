import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { startGateway } from "../dev/gateway.mjs";

const root = resolve(import.meta.dirname, "..");
const gateway = await startGateway();
const executable = process.env.CLOUDFLARED_BIN;
const args = [
	"tunnel",
	"--no-autoupdate",
	"--protocol",
	"http2",
	"--url",
	"http://127.0.0.1:19001",
];
// Docker host networking makes this fallback Linux-only. A native binary works on other platforms.
const child = executable
	? spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] })
	: spawn(
			"docker",
			["run", "--rm", "--network", "host", "cloudflare/cloudflared:2026.9.3", ...args],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
let published = false;
let pending = "";
for (const stream of [child.stdout, child.stderr]) {
	stream.on("data", async (bytes) => {
		pending = (pending + bytes.toString()).slice(-8000);
		const origin = pending.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
		if (!origin || published) return;
		published = true;
		await mkdir(resolve(root, ".local"), { recursive: true });
		await writeFile(
			resolve(root, ".local/tunnel.json"),
			JSON.stringify({ backendUrl: origin }, null, 2),
		);
		console.log(
			"Read-only Store tunnel ready. Run pnpm dev:site in another terminal, then pnpm dev:configure.",
		);
	});
}
child.once("error", () => {
	console.error("Cannot start cloudflared. Set CLOUDFLARED_BIN to an installed binary.");
	gateway.close();
	process.exitCode = 1;
});
child.once("exit", (code) => {
	gateway.close();
	if (!published || code) {
		console.error("Development tunnel stopped or failed; check Docker/network connectivity.");
		process.exitCode = 1;
	}
});
for (const signal of ["SIGINT", "SIGTERM"])
	process.once(signal, () => {
		child.kill("SIGTERM");
		gateway.close();
	});
setTimeout(() => {
	if (!published) {
		console.error("Tunnel did not become ready within 60 seconds.");
		child.kill("SIGTERM");
		gateway.close();
	}
}, 60000).unref();
