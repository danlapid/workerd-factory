import { describe, expect, it } from 'vitest';
import { parseFactoryConfig } from '../src/config.ts';
import { DEFAULT_INGRESS_LABELS } from '../src/ingress/labels.ts';
import { VERIFICATION_MODEL } from '../src/models.ts';

describe('ingress configuration', () => {
	it('is off when the section is absent', () => {
		expect(parseFactoryConfig('version: 1').ingress).toBeUndefined();
	});

	it('parses an empty section with defaults applied', () => {
		expect(
			parseFactoryConfig(`
version: 1
ingress: {}
`).ingress,
		).toEqual({
			model: VERIFICATION_MODEL,
			thinkingLevel: undefined,
			commentOnMissingReproduction: true,
			labels: { ...DEFAULT_INGRESS_LABELS },
		});
	});

	it('is off when explicitly disabled', () => {
		expect(
			parseFactoryConfig(`
version: 1
ingress:
  enabled: false
  model: anthropic/claude-sonnet-4-5
`).ingress,
		).toBeUndefined();
	});

	it('applies overrides and merges label names over the defaults', () => {
		const config = parseFactoryConfig(`
version: 1
ingress:
  model: anthropic/claude-sonnet-4-5
  thinkingLevel: low
  commentOnMissingReproduction: false
  labels:
    fake: spam
    needsReproduction: needs more info
`);
		expect(config.ingress).toEqual({
			model: 'cloudflare-ai-gateway/claude-sonnet-4-5',
			thinkingLevel: 'low',
			commentOnMissingReproduction: false,
			labels: {
				...DEFAULT_INGRESS_LABELS,
				fake: 'spam',
				needsReproduction: 'needs more info',
			},
		});
	});

	it('rejects an empty label name', () => {
		expect(() =>
			parseFactoryConfig(`
version: 1
ingress:
  labels:
    fake: ""
`),
		).toThrow();
	});
});
