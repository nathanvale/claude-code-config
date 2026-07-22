#!/usr/bin/env bun

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const SUPPORTED_STATES = ['default', 'hover', 'focus', 'pressed', 'disabled']
const VALUE_FLAGS = new Set([
	'--handoff',
	'--reference-story',
	'--path-story',
	'--specimens',
	'--output',
])
const DEFAULT_PROPERTIES = [
	'font-family',
	'font-weight',
	'font-size',
	'line-height',
	'letter-spacing',
	'word-spacing',
	'padding-top',
	'padding-right',
	'padding-bottom',
	'padding-left',
	'min-height',
	'min-width',
	'height',
	'border-radius',
	'color',
	'background-color',
	'border-top-width',
	'border-top-style',
	'border-top-color',
	'box-shadow',
	'text-transform',
	'gap',
]

class CommandError extends Error {
	constructor(message, exitCode) {
		super(message)
		this.exitCode = exitCode
	}
}

class CdpClient {
	#nextId = 1
	#pending = new Map()

	constructor(socket) {
		this.socket = socket
		socket.addEventListener('message', (event) => this.#handleMessage(event))
		socket.addEventListener('close', () =>
			this.#rejectAll(new Error('CDP socket closed before response.')),
		)
		socket.addEventListener('error', () =>
			this.#rejectAll(new Error('CDP socket errored before response.')),
		)
	}

	static async connect(webSocketUrl) {
		const socket = new WebSocket(webSocketUrl)
		await new Promise((resolveConnection, rejectConnection) => {
			socket.addEventListener('open', resolveConnection, { once: true })
			socket.addEventListener(
				'error',
				() => rejectConnection(new Error('CDP page attachment failed.')),
				{ once: true },
			)
		})
		return new CdpClient(socket)
	}

	call(method, params = {}, timeoutMs = 15000) {
		const id = this.#nextId
		this.#nextId += 1
		const response = new Promise((resolveCall, rejectCall) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id)
				rejectCall(new Error(`CDP call timed out: ${method}`))
			}, timeoutMs)
			this.#pending.set(id, {
				resolve: (result) => {
					clearTimeout(timer)
					resolveCall(result)
				},
				reject: (error) => {
					clearTimeout(timer)
					rejectCall(error)
				},
			})
		})
		this.socket.send(JSON.stringify({ id, method, params }))
		return response
	}

	close() {
		this.socket.close()
	}

	#rejectAll(error) {
		for (const pending of this.#pending.values()) {
			pending.reject(error)
		}
		this.#pending.clear()
	}

	#handleMessage(event) {
		const data = typeof event.data === 'string' ? event.data : undefined
		if (!data) return
		const response = JSON.parse(data)
		if (response.id === undefined) return
		const pending = this.#pending.get(response.id)
		if (!pending) return
		this.#pending.delete(response.id)
		if (response.error) {
			pending.reject(new Error(response.error.message ?? 'CDP command failed.'))
			return
		}
		pending.resolve(response.result ?? {})
	}
}

async function main() {
	try {
		const args = parseArguments(process.argv.slice(2))
		if (!args) {
			process.stdout.write(helpText())
			return
		}

		const handoff = await readHandoff(args.handoffPath)
		const specimens = validateSpecimens(
			JSON.parse(await readFile(resolve(args.specimensPath), 'utf8')),
		)
		const targets = await listTargets(handoff.endpointHttp)
		const referenceTarget = findStoryTarget(targets, args.referenceStory)
		const pathTarget = findStoryTarget(targets, args.pathStory)

		if (!referenceTarget || !pathTarget) {
			const missing = [
				!referenceTarget ? args.referenceStory : undefined,
				!pathTarget ? args.pathStory : undefined,
			].filter(Boolean)
			throw new CommandError(
				`Story target missing in Warm Chrome: ${missing.join(', ')}. Open the iframe target through browser-use, then retry with a fresh handoff.`,
				1,
			)
		}

		const reference = await captureReference(referenceTarget, specimens)
		const path = await capturePath(pathTarget, specimens)
		const deltas = diffMeasurements(
			specimens.states,
			specimens.properties,
			specimens.variants,
			reference.measurements,
			path.measurements,
		)
		const mismatches = deltas.filter((delta) => !delta.match).length
		const outputPath = resolve(args.outputPath)
		const evidencePath = `${outputPath.replace(/\.md$/i, '')}.json`

		await mkdir(dirname(outputPath), { recursive: true })
		await Bun.write(
			outputPath,
			renderMarkdown(args, handoff.runId, deltas, path.matchedRules),
		)
		await Bun.write(
			evidencePath,
			`${JSON.stringify(
				{
					contract: 'path-component-parity.measurement',
					schema_version: '1',
					run_id: handoff.runId,
					reference: {
						story_id: args.referenceStory,
						measurements: reference.measurements,
					},
					path: {
						story_id: args.pathStory,
						measurements: path.measurements,
						matched_pseudo_rules: path.matchedRules,
					},
					deltas,
					summary: {
						total: deltas.length,
						matches: deltas.length - mismatches,
						mismatches,
					},
				},
				null,
				2,
			)}\n`,
		)

		const result = {
			status: mismatches === 0 ? 'ok' : 'mismatch',
			run_id: handoff.runId,
			data: {
				total: deltas.length,
				matches: deltas.length - mismatches,
				mismatches,
				report: outputPath,
				evidence: evidencePath,
			},
			continuation: {
				next_action_id:
					mismatches === 0
						? 'run_component_verification'
						: 'fix_owned_path_delta',
			},
		}

		process.stdout.write(
			args.json
				? `${JSON.stringify(result, null, 2)}\n`
				: `${result.status}: ${result.data.matches}/${result.data.total} values match; report ${outputPath}\n`,
		)
		if (mismatches > 0) process.exitCode = 3
	} catch (error) {
		const commandError =
			error instanceof CommandError
				? error
				: new CommandError(error instanceof Error ? error.message : String(error), 1)
		process.stderr.write(`path-component-parity: ${commandError.message}\n`)
		process.exitCode = commandError.exitCode
	}
}

function parseArguments(argv) {
	if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return undefined
	const values = new Map()
	let json = false

	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index]
		if (flag === '--json') {
			json = true
			continue
		}
		if (!flag.startsWith('--')) throw new CommandError(`Unexpected argument: ${flag}`, 2)
		if (!VALUE_FLAGS.has(flag)) throw new CommandError(`Unknown option: ${flag}`, 2)
		const value = argv[index + 1]
		if (!value || value.startsWith('--')) {
			throw new CommandError(`Missing value for ${flag}.`, 2)
		}
		values.set(flag, value)
		index += 1
	}

	const required = (flag) => {
		const value = values.get(flag)
		if (!value) throw new CommandError(`Missing required ${flag}.`, 2)
		return value
	}

	return {
		handoffPath: required('--handoff'),
		referenceStory: required('--reference-story'),
		pathStory: required('--path-story'),
		specimensPath: required('--specimens'),
		outputPath: required('--output'),
		json,
	}
}

async function readHandoff(path) {
	const raw = JSON.parse(await readFile(resolve(path), 'utf8'))
	const data = objectOf(raw.data)
	const endpoint = objectOf(data.endpoint)
	const attachment = objectOf(data.attachment)
	const runId = stringOf(raw.run_id)
	const endpointHttp = stringOf(endpoint.http)

	if (
		raw.status !== 'ok' ||
		data.contract_id !== 'browser-connect.verified-handoff' ||
		attachment.adapter_id !== 'chrome-devtools-mcp' ||
		!runId ||
		!endpointHttp
	) {
		throw new CommandError(
			'The handoff is not a verified chrome-devtools browser-connect envelope. Mint a fresh handoff and retry.',
			2,
		)
	}

	return { runId, endpointHttp }
}

async function listTargets(endpointHttp) {
	const response = await fetch(new URL('/json/list', endpointHttp))
	if (!response.ok) throw new CommandError('Warm Chrome target discovery failed.', 1)
	return response.json()
}

function findStoryTarget(targets, storyId) {
	return targets.find((target) => {
		if (target.type !== 'page' || !target.webSocketDebuggerUrl) return false
		try {
			return new URL(target.url).searchParams.get('id') === storyId
		} catch {
			return false
		}
	})
}

/**
 * Validate and normalize the selector-spec contract.
 *
 * @param {unknown} input - Parsed selector-spec JSON.
 * @returns {{states: string[], properties: string[], viewport: {width: number, height: number, deviceScaleFactor: number}, variants: Array<Record<string, unknown>>}} Normalized measurement input.
 * @throws {CommandError} When required states, selectors, or viewport values are invalid.
 *
 * @example
 * validateSpecimens({ states: ['default'], variants: [{ name: 'Primary', pathSelector: '#path', referenceSelectors: { default: '#reference' } }] })
 */
export function validateSpecimens(input) {
	const raw = objectOf(input)
	const states = Array.isArray(raw.states) ? raw.states.map(String) : [...SUPPORTED_STATES]
	const properties = Array.isArray(raw.properties)
		? raw.properties.map(String)
		: [...DEFAULT_PROPERTIES]
	const viewportInput = objectOf(raw.viewport)
	const viewport = {
		width: positiveInteger(viewportInput.width, 1400, 'viewport.width'),
		height: positiveInteger(viewportInput.height, 900, 'viewport.height'),
		deviceScaleFactor: positiveNumber(
			viewportInput.deviceScaleFactor,
			1,
			'viewport.deviceScaleFactor',
		),
	}

	for (const state of states) {
		if (!SUPPORTED_STATES.includes(state)) {
			throw new CommandError(
				`Unsupported state ${state}; use ${SUPPORTED_STATES.join(',')}.`,
				2,
			)
		}
	}
	if (states.length === 0) throw new CommandError('At least one state is required.', 2)
	if (properties.length === 0) throw new CommandError('At least one property is required.', 2)
	if (!Array.isArray(raw.variants) || raw.variants.length === 0) {
		throw new CommandError('The selector spec requires at least one variant.', 2)
	}

	const variants = raw.variants.map((candidate, index) => {
		const variant = objectOf(candidate)
		const name = stringOf(variant.name)
		const pathSelector = stringOf(variant.pathSelector)
		const pathSelectors = objectOf(variant.pathSelectors)
		const referenceSelectors = objectOf(variant.referenceSelectors)
		if (!name) throw new CommandError(`Variant ${index + 1} requires name.`, 2)
		if (!pathSelector) {
			throw new CommandError(`Variant ${name} requires pathSelector.`, 2)
		}
		for (const state of states) {
			if (!stringOf(referenceSelectors[state])) {
				throw new CommandError(
					`Variant ${name} requires referenceSelectors.${state}.`,
					2,
				)
			}
			if (state === 'disabled' && !stringOf(pathSelectors.disabled)) {
				throw new CommandError(
					`Variant ${name} requires pathSelectors.disabled when disabled is measured.`,
					2,
				)
			}
		}
		return { name, pathSelector, pathSelectors, referenceSelectors }
	})

	return { states, properties, viewport, variants }
}

async function captureReference(target, specimens) {
	return captureTarget(target, specimens, async (client, rootNodeId, variant, state) => {
		const selector = variant.referenceSelectors[state]
		const nodeId = await queryNode(client, rootNodeId, selector)
		return {
			values: await readComputedStyle(client, nodeId, specimens.properties),
			matchedRules: [],
		}
	})
}

async function capturePath(target, specimens) {
	return captureTarget(target, specimens, async (client, rootNodeId, variant, state) => {
		const staticSelector = stringOf(variant.pathSelectors[state])
		const selector = staticSelector ?? variant.pathSelector
		const nodeId = await queryNode(client, rootNodeId, selector)
		const pseudoClasses = staticSelector ? [] : forcedPseudoClasses(state)
		await client.call('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: pseudoClasses })
		await flushLayout(client, selector)
		const values = await readComputedStyle(client, nodeId, specimens.properties)
		const matchedRules =
			pseudoClasses.length > 0
				? await readMatchedPseudoRules(client, nodeId, state, specimens.properties)
				: []
		await client.call('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] })
		return { values, matchedRules }
	})
}

async function captureTarget(target, specimens, captureState) {
	const client = await CdpClient.connect(target.webSocketDebuggerUrl)
	try {
		await client.call('Page.bringToFront')
		await client.call('DOM.enable')
		await client.call('CSS.enable')
		await client.call('Runtime.enable')
		await client.call('Emulation.setDeviceMetricsOverride', {
			...specimens.viewport,
			mobile: false,
		})
		const documentResult = await client.call('DOM.getDocument', { depth: -1 })
		const rootNodeId = numberOf(objectOf(documentResult.root).nodeId)
		if (!rootNodeId) throw new CommandError('CDP document root is unavailable.', 1)

		const measurements = {}
		const matchedRules = {}
		for (const variant of specimens.variants) {
			measurements[variant.name] = {}
			matchedRules[variant.name] = {}
			for (const state of specimens.states) {
				const captured = await captureState(client, rootNodeId, variant, state)
				measurements[variant.name][state] = captured.values
				if (captured.matchedRules.length > 0) {
					matchedRules[variant.name][state] = captured.matchedRules
				}
			}
		}
		return { measurements, matchedRules }
	} finally {
		await client.call('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
		client.close()
	}
}

async function queryNode(client, rootNodeId, selector) {
	const result = await client.call('DOM.querySelector', {
		nodeId: rootNodeId,
		selector,
	})
	const nodeId = numberOf(result.nodeId)
	if (!nodeId) throw new CommandError(`Selector matched no element: ${selector}`, 2)
	return nodeId
}

async function readComputedStyle(client, nodeId, properties) {
	const result = await client.call('CSS.getComputedStyleForNode', { nodeId })
	const computed = Array.isArray(result.computedStyle) ? result.computedStyle : []
	const values = Object.fromEntries(
		computed.map((entry) => [String(entry.name), String(entry.value)]),
	)
	return Object.fromEntries(properties.map((property) => [property, values[property] ?? '']))
}

async function readMatchedPseudoRules(client, nodeId, state, properties) {
	const result = await client.call('CSS.getMatchedStylesForNode', { nodeId })
	const rules = Array.isArray(result.matchedCSSRules) ? result.matchedCSSRules : []
	const pseudoSelectors = pseudoSelectorFragments(state)

	return rules.flatMap((match) => {
		const rule = objectOf(match.rule)
		const selectorList = objectOf(rule.selectorList)
		const selectors = Array.isArray(selectorList.selectors)
			? selectorList.selectors.map((selector) => stringOf(objectOf(selector).text)).filter(Boolean)
			: []
		if (!selectors.some((selector) => pseudoSelectors.some((part) => selector.includes(part)))) {
			return []
		}
		const style = objectOf(rule.style)
		const cssProperties = Array.isArray(style.cssProperties) ? style.cssProperties : []
		const declarations = cssProperties
			.map(objectOf)
			.filter((property) => properties.includes(stringOf(property.name)))
			.map((property) => ({
				name: stringOf(property.name),
				value: stringOf(property.value),
				important: Boolean(property.important),
			}))
			.filter((property) => property.name && property.value)
		if (declarations.length === 0) return []
		return [
			{
				selectors,
				cssText: stringOf(style.cssText) ?? '',
				declarations,
			},
		]
	})
}

function forcedPseudoClasses(state) {
	if (state === 'hover') return ['hover']
	if (state === 'focus') return ['focus', 'focus-visible']
	if (state === 'pressed') return ['active']
	return []
}

function pseudoSelectorFragments(state) {
	if (state === 'hover') return [':hover']
	if (state === 'focus') return [':focus-visible', ':focus']
	if (state === 'pressed') return [':active']
	return []
}

async function flushLayout(client, selector) {
	await client.call('Runtime.evaluate', {
		expression: `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`,
	})
}

/**
 * Normalize browser values that are pixel-equivalent but serialize differently.
 *
 * @param {string} property - CSS property under comparison.
 * @param {string} value - Browser-computed property value.
 * @returns {string} Stable comparison value.
 *
 * @example
 * normalizeComputedValue('border-top-width', '0px')
 */
export function normalizeComputedValue(property, value) {
	const normalized = value.trim().replace(/\s+/g, ' ')
	if (property.endsWith('-width') && normalized === '0px') return '0'
	if (property === 'box-shadow') {
		const visibleLayers = splitCssList(normalized).filter(
			(layer) => !isTransparentZeroShadow(layer),
		)
		return visibleLayers.length === 0 ? 'none' : visibleLayers.join(', ')
	}
	return normalized
}

/**
 * Compare every requested variant, state, and property in stable order.
 *
 * @param {string[]} states - State order from the selector spec.
 * @param {string[]} properties - Property order from the selector spec.
 * @param {Array<{name: string}>} variants - Variant order from the selector spec.
 * @param {Record<string, Record<string, Record<string, string>>>} reference - Canonical measurements.
 * @param {Record<string, Record<string, Record<string, string>>>} path - Path measurements.
 * @returns {Array<Record<string, string | boolean>>} Flat delta rows for Markdown and JSON evidence.
 *
 * @example
 * diffMeasurements(['default'], ['color'], [{ name: 'Primary' }], { Primary: { default: { color: 'red' } } }, { Primary: { default: { color: 'red' } } })
 */
export function diffMeasurements(states, properties, variants, reference, path) {
	return variants.flatMap((variant) =>
		states.flatMap((state) =>
			properties.map((property) => {
				const referenceValue = reference[variant.name]?.[state]?.[property] ?? ''
				const pathValue = path[variant.name]?.[state]?.[property] ?? ''
				return {
					variant: variant.name,
					state,
					property,
					reference: referenceValue,
					path: pathValue,
					match:
						normalizeComputedValue(property, referenceValue) ===
						normalizeComputedValue(property, pathValue),
				}
			}),
		),
	)
}

function renderMarkdown(args, runId, deltas, matchedRules) {
	const mismatchCount = deltas.filter((delta) => !delta.match).length
	const lines = [
		`# Path component delta: ${args.referenceStory} to ${args.pathStory}`,
		'',
		`- Run: \`${runId}\``,
		`- Result: ${deltas.length - mismatchCount}/${deltas.length} match`,
		'',
		'| Variant | State | Property | Reference | Path | Result |',
		'| --- | --- | --- | --- | --- | --- |',
		...deltas.map(
			(delta) =>
				`| ${escapeCell(delta.variant)} | ${escapeCell(delta.state)} | ${escapeCell(delta.property)} | ${escapeCell(delta.reference)} | ${escapeCell(delta.path)} | ${delta.match ? 'match' : 'mismatch'} |`,
		),
		'',
		'## Matched Pseudo Rules',
		'',
		'Matched Path rule text is retained in the sibling JSON evidence. Inspect it when forced pseudo-state computed output stays at the default value or reads `none`.',
		'',
	]
	const matchedRuleCount = Object.values(matchedRules).reduce(
		(total, states) =>
			total +
			Object.values(states).reduce((stateTotal, rules) => stateTotal + rules.length, 0),
		0,
	)
	lines.push(`Captured ${matchedRuleCount} matched pseudo rules.`)
	lines.push('')
	return `${lines.join('\n')}\n`
}

function splitCssList(value) {
	const layers = []
	let depth = 0
	let start = 0
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index]
		if (character === '(') depth += 1
		if (character === ')') depth -= 1
		if (character === ',' && depth === 0) {
			layers.push(value.slice(start, index).trim())
			start = index + 1
		}
	}
	if (value.length > 0) layers.push(value.slice(start).trim())
	return layers.filter(Boolean)
}

function isTransparentZeroShadow(layer) {
	return (
		/rgba\(0, 0, 0, 0\)/.test(layer) &&
		/0px 0px 0px 0px(?:\s+rgb\([^)]*\))?$/.test(layer)
	)
}

function escapeCell(value) {
	return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function objectOf(value) {
	return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function stringOf(value) {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberOf(value) {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function positiveInteger(value, fallback, label) {
	if (value === undefined) return fallback
	if (!Number.isInteger(value) || value <= 0) {
		throw new CommandError(`${label} must be a positive integer.`, 2)
	}
	return value
}

function positiveNumber(value, fallback, label) {
	if (value === undefined) return fallback
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		throw new CommandError(`${label} must be a positive number.`, 2)
	}
	return value
}

function helpText() {
	return `Usage: bun skills/path-component-parity/scripts/measure-computed.mjs [options]

Compare canonical portal-ui and Path Storybook components through verified Warm Chrome.

Required:
  --handoff <path>          browser-connect verified handoff JSON
  --reference-story <id>    canonical portal-ui Storybook story id
  --path-story <id>         Path Storybook story id
  --specimens <path.json>   variant and state selector spec
  --output <path.md>        Markdown delta report; JSON evidence is written beside it

Options:
  --json                    emit a machine-readable summary
  -h, --help                show help

Selector spec:
  {
    "states": ["default", "hover", "focus", "pressed", "disabled"],
    "properties": ["color", "background-color", "box-shadow"],
    "viewport": { "width": 1400, "height": 900, "deviceScaleFactor": 1 },
    "variants": [{
      "name": "Primary",
      "pathSelector": "#path-primary",
      "pathSelectors": { "disabled": "#path-primary-disabled" },
      "referenceSelectors": {
        "default": "#reference-primary-default",
        "hover": "#reference-primary-hover",
        "focus": "#reference-primary-focus",
        "pressed": "#reference-primary-pressed",
        "disabled": "#reference-primary-disabled"
      }
    }]
  }

Add pathSelectors.<state> to measure a static Path state cell. Without it, hover,
focus, and pressed are forced on pathSelector through CDP.

Exit: 0 all match; 3 measured mismatch; 2 invalid input; 1 runtime failure.
`
}

if (import.meta.main) await main()
