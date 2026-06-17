import { rmSync } from "node:fs";

export interface CleanupRegistry {
	readonly paths: string[];
	readonly servers: Array<{ stop: (closeActiveConnections?: boolean) => void }>;
}

export function createCleanupRegistry(): CleanupRegistry {
	return { paths: [], servers: [] };
}

export function drainCleanup(registry: CleanupRegistry): void {
	for (const s of registry.servers.splice(0)) {
		s.stop(true);
	}
	for (const p of registry.paths.splice(0)) {
		rmSync(p, { recursive: true, force: true });
	}
}
