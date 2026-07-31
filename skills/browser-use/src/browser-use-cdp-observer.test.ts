import { describe, expect, test } from "bun:test";
import {
	type BrowserUseCdpObserverRequest,
	type BrowserUseCdpObserverTransport,
	createBrowserUseCdpObserver,
} from "./browser-use-cdp-observer";

function transportFor(
	handle: (request: BrowserUseCdpObserverRequest) => unknown,
	requests: BrowserUseCdpObserverRequest[] = [],
): BrowserUseCdpObserverTransport {
	return {
		request: async (request) => {
			requests.push(request);
			return handle(request);
		},
	};
}

describe("browser-use CDP observer", () => {
	test("snapshots the full accessibility tree through the exact CDP target id", async () => {
		const requests: BrowserUseCdpObserverRequest[] = [];
		const observer = createBrowserUseCdpObserver(
			transportFor((request) => {
				switch (request.method) {
					case "Target.attachToTarget":
						return { sessionId: "session-login" };
					case "Accessibility.getFullAXTree":
						return {
							nodes: [
								{
									nodeId: "ax-form",
									role: { value: "form" },
									name: { value: "Sign in" },
									childIds: ["ax-username", "ax-next"],
								},
								{
									nodeId: "ax-username",
									parentId: "ax-form",
									backendDOMNodeId: 41,
									frameId: "frame-login",
									role: { value: "textbox" },
									name: { value: "Username" },
									properties: [
										{ name: "focusable", value: { value: true } },
									],
								},
								{
									nodeId: "ax-next",
									parentId: "ax-form",
									backendDOMNodeId: 42,
									role: { value: "button" },
									name: { value: "Next" },
								},
							],
						};
					case "Target.detachFromTarget":
						return {};
					default:
						throw new Error(`unexpected request: ${request.method}`);
				}
			}, requests),
		);

		const result = await observer.snapshot({ target_id: "cdp-target-login" });

		expect(result).toEqual({
			ok: true,
			snapshot: {
				target_id: "cdp-target-login",
				nodes: [
					{
						node_id: "ax-form",
						role: "form",
						accessible_name: "Sign in",
						ignored: false,
						child_ids: ["ax-username", "ax-next"],
						properties: {},
					},
					{
						node_id: "ax-username",
						backend_node_id: 41,
						frame_id: "frame-login",
						parent_id: "ax-form",
						role: "textbox",
						accessible_name: "Username",
						ignored: false,
						properties: { focusable: true },
					},
					{
						node_id: "ax-next",
						backend_node_id: 42,
						parent_id: "ax-form",
						role: "button",
						accessible_name: "Next",
						ignored: false,
						properties: {},
					},
				],
			},
		});
		expect(requests[0]).toEqual({
			method: "Target.attachToTarget",
			params: { targetId: "cdp-target-login", flatten: true },
		});
		expect(requests.at(-1)).toEqual({
			method: "Target.detachFromTarget",
			params: { sessionId: "session-login" },
		});
	});

	test("activates an operable control with trusted CDP mouse events", async () => {
		const requests: BrowserUseCdpObserverRequest[] = [];
		const observer = createBrowserUseCdpObserver(
			transportFor((request) => {
				switch (request.method) {
					case "Target.attachToTarget":
						return { sessionId: "session-activate" };
					case "Accessibility.getFullAXTree":
						return {
							nodes: [
								{
									nodeId: "ax-submit",
									backendDOMNodeId: 73,
									role: { value: "button" },
									name: { value: "Sign in" },
									properties: [
										{ name: "disabled", value: { value: false } },
									],
								},
							],
						};
					case "DOM.getContentQuads":
						return { quads: [[10, 20, 30, 20, 30, 40, 10, 40]] };
					case "Input.dispatchMouseEvent":
					case "Target.detachFromTarget":
						return {};
				}
			}, requests),
		);

		const result = await observer.activateControl({
			target_id: "cdp-target-login",
			backend_node_id: 73,
		});

		expect(result).toEqual({ ok: true });
		expect(
			requests.filter(
				(request) => request.method === "Input.dispatchMouseEvent",
			),
		).toEqual([
			{
				method: "Input.dispatchMouseEvent",
				sessionId: "session-activate",
				params: { type: "mouseMoved", x: 20, y: 30 },
			},
			{
				method: "Input.dispatchMouseEvent",
				sessionId: "session-activate",
				params: {
					type: "mousePressed",
					x: 20,
					y: 30,
					button: "left",
					buttons: 1,
					clickCount: 1,
				},
			},
			{
				method: "Input.dispatchMouseEvent",
				sessionId: "session-activate",
				params: {
					type: "mouseReleased",
					x: 20,
					y: 30,
					button: "left",
					buttons: 0,
					clickCount: 1,
				},
			},
		]);
		expect(requests.some((request) => request.method.startsWith("Runtime."))).toBe(
			false,
		);
	});

	test("probes hidden and disabled nodes without activating them", async () => {
		const disabledRequests: BrowserUseCdpObserverRequest[] = [];
		const disabled = createBrowserUseCdpObserver(
			transportFor((request) => {
				switch (request.method) {
					case "Target.attachToTarget":
						return { sessionId: "session-disabled" };
					case "Accessibility.getFullAXTree":
						return {
							nodes: [
								{
									nodeId: "ax-disabled",
									backendDOMNodeId: 88,
									role: { value: "button" },
									name: { value: "Continue" },
									properties: [
										{ name: "disabled", value: { value: true } },
									],
								},
							],
						};
					case "DOM.getContentQuads":
						return { quads: [[0, 0, 20, 0, 20, 10, 0, 10]] };
					case "Target.detachFromTarget":
						return {};
					case "Input.dispatchMouseEvent":
						throw new Error("disabled node must not receive mouse input");
				}
			}, disabledRequests),
		);

		expect(
			await disabled.probeNode({
				target_id: "cdp-target-login",
				backend_node_id: 88,
			}),
		).toEqual({
			ok: true,
			probe: { visible: true, operable: false },
		});
		expect(
			await disabled.activateControl({
				target_id: "cdp-target-login",
				backend_node_id: 88,
			}),
		).toEqual({ ok: false, cause: "node-not-operable" });
		expect(
			disabledRequests.some(
				(request) => request.method === "Input.dispatchMouseEvent",
			),
		).toBe(false);

		const hidden = createBrowserUseCdpObserver(
			transportFor((request) => {
				switch (request.method) {
					case "Target.attachToTarget":
						return { sessionId: "session-hidden" };
					case "Accessibility.getFullAXTree":
						return {
							nodes: [
								{
									nodeId: "ax-hidden",
									backendDOMNodeId: 89,
									role: { value: "button" },
									name: { value: "Continue" },
								},
							],
						};
					case "DOM.getContentQuads":
						throw new Error("node has no layout box");
					case "Target.detachFromTarget":
						return {};
					case "Input.dispatchMouseEvent":
						throw new Error("hidden node must not receive mouse input");
				}
			}),
		);

		expect(
			await hidden.probeNode({
				target_id: "cdp-target-login",
				backend_node_id: 89,
			}),
		).toEqual({
			ok: true,
			probe: { visible: false, operable: false },
		});
	});
});
