import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

import {
	diffMeasurements,
	normalizeComputedValue,
	validateSpecimens,
} from './measure-computed.mjs'

const SCRIPT = resolve(import.meta.dir, 'measure-computed.mjs')

describe('measure-computed', () => {
	test('normalizes transparent shadow bookkeeping', () => {
		const reference =
			'rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(255, 255, 255) 0px 0px 0px 2px'
		const path = 'rgb(255, 255, 255) 0px 0px 0px 2px'
		expect(normalizeComputedValue('box-shadow', reference)).toBe(path)
	})

	test('reports variant, state, and property mismatches', () => {
		const deltas = diffMeasurements(
			['hover'],
			['background-color'],
			[{ name: 'Primary' }],
			{ Primary: { hover: { 'background-color': 'rgb(1, 2, 3)' } } },
			{ Primary: { hover: { 'background-color': 'rgb(4, 5, 6)' } } },
		)
		expect(deltas).toEqual([
			{
				variant: 'Primary',
				state: 'hover',
				property: 'background-color',
				reference: 'rgb(1, 2, 3)',
				path: 'rgb(4, 5, 6)',
				match: false,
			},
		])
	})

	test('rejects unsupported states before browser access', () => {
		expect(() =>
			validateSpecimens({
				states: ['default', 'unknown'],
				variants: [
					{
						name: 'Primary',
						pathSelector: '#path',
						referenceSelectors: { default: '#reference', unknown: '#unknown' },
					},
				],
			}),
		).toThrow('Unsupported state unknown')
	})

	test('renders discoverable help without browser access', async () => {
		const child = Bun.spawn(['bun', SCRIPT, '--help'], {
			stdout: 'pipe',
			stderr: 'pipe',
		})
		const [exitCode, stdout] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
		])
		expect(exitCode).toBe(0)
		expect(stdout).toContain('Usage: bun skills/path-component-parity/scripts/')
		expect(stdout).toContain('Exit: 0 all match; 3 measured mismatch')
	})

	test('rejects unknown options before browser access', async () => {
		const child = Bun.spawn(['bun', SCRIPT, '--unknown', 'value'], {
			stdout: 'pipe',
			stderr: 'pipe',
		})
		const [exitCode, stderr] = await Promise.all([
			child.exited,
			new Response(child.stderr).text(),
		])
		expect(exitCode).toBe(2)
		expect(stderr).toContain('Unknown option: --unknown')
	})
})
