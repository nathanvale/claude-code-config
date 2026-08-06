/** Read-only localhost page handler used only by the explicitly gated live suite. */
export function liveRunbookFixtureResponse(): Response {
	return new Response(
		'<!doctype html><title>Read-only fixture</title><main><p class="row">one</p><p class="row">two</p></main>',
		{ headers: { "content-type": "text/html; charset=utf-8" } },
	);
}
