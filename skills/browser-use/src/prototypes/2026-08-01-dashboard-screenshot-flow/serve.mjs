const root = import.meta.dir;
const port = Number(process.argv[2]);

// Bind 127.0.0.1 explicitly: Bun.serve("localhost") can bind IPv6-only, which
// makes the IPv4 redirect target unreachable and turns the off-origin refusal
// into a navigation error.
const serveFixture = () =>
	new Response(Bun.file(`${root}/fixture.html`), {
		headers: { "content-type": "text/html; charset=utf-8" },
	});

// Off-origin target is a real, loadable dashboard page on a different port,
// so refusal must come from the origin check, not from a network failure.
const offOrigin = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(request) {
		const url = new URL(request.url);
		if (url.pathname !== "/fixture.html") return new Response("Not found", { status: 404 });
		return serveFixture();
	},
});

const server = Bun.serve({
	hostname: "127.0.0.1",
	port,
	fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/redirect") {
			return Response.redirect(
				`http://127.0.0.1:${offOrigin.port}/fixture.html?state=dashboard`,
				302,
			);
		}
		if (url.pathname !== "/fixture.html") return new Response("Not found", { status: 404 });
		return serveFixture();
	},
});

console.log(`fixture=http://127.0.0.1:${server.port}/fixture.html`);
