/**
 * PROTOTYPE — throw away after the dashboard direction is chosen.
 *
 * Three browser dashboard variants, switchable via `?variant=`, served from one
 * read-only route beside the skill-feedback package.
 */
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../../..");
const runnerPath = join(
	repositoryRoot,
	"skills/skill-feedback/src/skill-feedback-runner.ts",
);
const prototypeRoot = import.meta.dir;
const prototypePort = Number(
	process.env.SKILL_FEEDBACK_PROTOTYPE_PORT ?? "4318",
);

let cachedDashboard:
	| {
			expiresAt: number;
			payload: unknown;
	  }
	| undefined;

async function runSkillFeedback(
	command: string,
	args: string[],
	withJsonFlag = true,
): Promise<unknown> {
	const child = Bun.spawn(
		[
			"bun",
			"run",
			runnerPath,
			command,
			...args,
			"--repo",
			repositoryRoot,
			...(withJsonFlag ? ["--json"] : []),
		],
		{
			cwd: repositoryRoot,
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(stderr || stdout || `${command} exited ${exitCode}`);
	}
	return JSON.parse(stdout);
}

async function readDashboard(): Promise<unknown> {
	if (cachedDashboard && cachedDashboard.expiresAt > Date.now()) {
		return cachedDashboard.payload;
	}

	const [usage, queue, reports, health] = await Promise.all([
		runSkillFeedback("usage", ["--limit", "100"]),
		runSkillFeedback("queue", ["--limit", "100", "--include-weak"]),
		runSkillFeedback("reports", ["--limit", "100", "--lane", "all"]),
		runSkillFeedback("health", [], false),
	]);
	const payload = {
		generatedAt: new Date().toISOString(),
		usage,
		queue,
		reports,
		health,
	};
	cachedDashboard = {
		expiresAt: Date.now() + 5_000,
		payload,
	};
	return payload;
}

function json(payload: unknown, status = 200): Response {
	return Response.json(payload, {
		status,
		headers: {
			"Cache-Control": "no-store",
		},
	});
}

function staticFile(name: "index.html" | "app.js" | "styles.css"): Response {
	return new Response(Bun.file(join(prototypeRoot, name)), {
		headers: {
			"Content-Type":
				name.endsWith(".html")
					? "text/html; charset=utf-8"
					: name.endsWith(".css")
						? "text/css; charset=utf-8"
						: "text/javascript; charset=utf-8",
			"Cache-Control": "no-store",
		},
	});
}

Bun.serve({
	port: prototypePort,
	async fetch(request) {
		const url = new URL(request.url);

		if (
			url.pathname === "/" ||
			url.pathname === "/prototype/skill-feedback-dashboard"
		) {
			return staticFile("index.html");
		}
		if (url.pathname === "/app.js") return staticFile("app.js");
		if (url.pathname === "/styles.css") return staticFile("styles.css");

		if (url.pathname === "/api/dashboard") {
			try {
				return json(await readDashboard());
			} catch (error) {
				return json(
					{
						error:
							error instanceof Error ? error.message : "Dashboard read failed.",
					},
					500,
				);
			}
		}

		if (url.pathname === "/api/report") {
			const reportRef = url.searchParams.get("ref");
			if (!reportRef?.startsWith("report:")) {
				return json({ error: "A report:<id> ref is required." }, 400);
			}
			try {
				return json(
					await runSkillFeedback("report", [reportRef, "--low-signal"]),
				);
			} catch (error) {
				return json(
					{
						error:
							error instanceof Error ? error.message : "Report read failed.",
					},
					500,
				);
			}
		}

		return new Response("Not found", { status: 404 });
	},
});

console.log(
	`Skill Feedback dashboard prototype: http://localhost:${prototypePort}/prototype/skill-feedback-dashboard?variant=A`,
);
