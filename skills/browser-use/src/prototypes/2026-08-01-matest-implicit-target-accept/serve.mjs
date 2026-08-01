const fixture = Bun.file(new URL("./fixture.html", import.meta.url));
const port = Number.parseInt(process.argv[2] ?? "41873", 10);

Bun.serve({
	hostname: "localhost",
	port,
	fetch() {
		return new Response(fixture, {
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	},
});

console.log(`fixture ready on http://localhost:${port}`);
