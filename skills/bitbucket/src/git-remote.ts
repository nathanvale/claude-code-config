/** Resolved Bitbucket Cloud repository coordinates. */
export interface BitbucketRepository {
	/** Bitbucket workspace slug. */
	workspace: string;
	/** Bitbucket repository slug. */
	repo: string;
}

const SAFE_SLUG = /^[A-Za-z0-9._-]+$/;

/** Resolve a Bitbucket repository from explicit values, environment, or Git remotes. */
export async function resolveRepository(options: {
	workspace?: string;
	repo?: string;
	environment: Record<string, string | undefined>;
	cwd: string;
}): Promise<BitbucketRepository> {
	const workspace = options.workspace ?? options.environment.BB_WORKSPACE;
	const repo = options.repo ?? options.environment.BB_REPO_SLUG;
	if (workspace || repo) {
		if (!workspace || !repo) throw new Error("Provide both --workspace and --repo, or neither.");
		return validateRepository({ workspace, repo });
	}

	const process = Bun.spawn(["git", "remote", "-v"], {
		cwd: options.cwd,
		stdout: "pipe",
		stderr: "ignore",
	});
	const [exitCode, output] = await Promise.all([
		process.exited,
		new Response(process.stdout).text(),
	]);
	if (exitCode !== 0) throw new Error("No readable Git remotes. Pass --workspace and --repo.");

	for (const line of output.split("\n")) {
		const remote = line.trim().split(/\s+/)[1];
		if (!remote) continue;
		const repository = parseBitbucketRemote(remote);
		if (repository) return validateRepository(repository);
	}
	throw new Error("No Bitbucket Cloud remote found. Pass --workspace and --repo.");
}

function parseBitbucketRemote(remote: string): BitbucketRepository | undefined {
	const ssh = remote.match(/^git@([^:]+):([^/]+)\/([^/]+)$/);
	if (ssh) {
		if (ssh[1].toLowerCase() !== "bitbucket.org") return undefined;
		return { workspace: ssh[2], repo: stripGitSuffix(ssh[3]) };
	}

	let url: URL;
	try {
		url = new URL(remote);
	} catch {
		return undefined;
	}
	if ((url.protocol !== "https:" && url.protocol !== "ssh:") || url.hostname.toLowerCase() !== "bitbucket.org") return undefined;
	const path = url.pathname.split("/").filter(Boolean);
	if (path.length !== 2) return undefined;
	return { workspace: path[0], repo: stripGitSuffix(path[1]) };
}

function stripGitSuffix(repo: string): string {
	return repo.endsWith(".git") ? repo.slice(0, -4) : repo;
}

function validateRepository(repository: BitbucketRepository): BitbucketRepository {
	if (!SAFE_SLUG.test(repository.workspace) || !SAFE_SLUG.test(repository.repo)) {
		throw new Error("Workspace and repository slugs contain unsupported characters.");
	}
	return repository;
}
