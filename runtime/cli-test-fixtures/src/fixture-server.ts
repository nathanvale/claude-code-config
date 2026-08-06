import type { CleanupRegistry } from "./cleanup.ts";

export interface FixtureServerHandle {
	readonly url: string;
	readonly port: number;
	readonly server: ReturnType<typeof Bun.serve>;
}

export function startFixtureServer(
	registry: CleanupRegistry,
	handler: (req: Request) => Response | Promise<Response>,
): FixtureServerHandle {
	const server = Bun.serve({
		port: 0,
		fetch: handler,
	});
	registry.servers.push(server);
	const port = server.port as number;
	return {
		url: `http://localhost:${port}`,
		port,
		server,
	};
}
