import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import {
	type IssueClassification,
	ingressCoordinatorKey,
	ingressWorkflowParamsSchema,
	issueClassificationSchema,
} from '../src/ingress/contracts.ts';
import {
	allIngressLabels,
	DEFAULT_INGRESS_LABELS,
	ingressLabelAppearance,
	labelsForClassification,
} from '../src/ingress/labels.ts';

const baseParams = {
	deliveryId: 'delivery-1',
	installationId: 1,
	repositoryId: 42,
	owner: 'cloudflare',
	repo: 'workerd',
	issueNumber: 7,
	defaultBranch: 'main',
	issueAction: 'opened',
};

describe('ingress contracts', () => {
	it('parses workflow params and keys the coordinator per issue', () => {
		const params = v.parse(ingressWorkflowParamsSchema, baseParams);
		expect(ingressCoordinatorKey(params)).toBe('42:7');
	});

	it('rejects issue actions ingress does not handle', () => {
		expect(() =>
			v.parse(ingressWorkflowParamsSchema, {
				...baseParams,
				issueAction: 'closed',
			}),
		).toThrow();
	});

	it('accepts a classification on all three axes', () => {
		const classification = v.parse(issueClassificationSchema, {
			legitimacy: 'genuine',
			kind: 'bug-report',
			reproduction: 'has-reproduction',
			reasoning: 'Includes a code sample and the failing command.',
		});
		expect(classification.kind).toBe('bug-report');
	});
});

function classification(
	overrides: Partial<IssueClassification>,
): IssueClassification {
	return {
		legitimacy: 'genuine',
		kind: 'bug-report',
		reproduction: 'not-applicable',
		reasoning: 'test',
		...overrides,
	};
}

describe('ingress labels', () => {
	it('maps a fake report to the fake label only', () => {
		expect(
			labelsForClassification(
				classification({
					legitimacy: 'fake',
					reproduction: 'has-reproduction',
				}),
				DEFAULT_INGRESS_LABELS,
			),
		).toEqual([DEFAULT_INGRESS_LABELS.fake]);
	});

	it('maps a bug report with a reproduction to bug + has repro', () => {
		expect(
			labelsForClassification(
				classification({ reproduction: 'has-reproduction' }),
				DEFAULT_INGRESS_LABELS,
			),
		).toEqual([
			DEFAULT_INGRESS_LABELS.bug,
			DEFAULT_INGRESS_LABELS.hasReproduction,
		]);
	});

	it('maps a bug report without a reproduction to bug + needs repro', () => {
		expect(
			labelsForClassification(
				classification({ reproduction: 'needs-reproduction' }),
				DEFAULT_INGRESS_LABELS,
			),
		).toEqual([
			DEFAULT_INGRESS_LABELS.bug,
			DEFAULT_INGRESS_LABELS.needsReproduction,
		]);
	});

	it('never applies reproduction labels to questions or feature requests', () => {
		expect(
			labelsForClassification(
				classification({
					kind: 'question',
					reproduction: 'needs-reproduction',
				}),
				DEFAULT_INGRESS_LABELS,
			),
		).toEqual([DEFAULT_INGRESS_LABELS.question]);
		expect(
			labelsForClassification(
				classification({
					kind: 'feature-request',
					reproduction: 'has-reproduction',
				}),
				DEFAULT_INGRESS_LABELS,
			),
		).toEqual([DEFAULT_INGRESS_LABELS.featureRequest]);
	});

	it('resolves an appearance for every configured label', () => {
		for (const label of allIngressLabels(DEFAULT_INGRESS_LABELS)) {
			expect(
				ingressLabelAppearance(label, DEFAULT_INGRESS_LABELS),
			).toBeDefined();
		}
		expect(
			ingressLabelAppearance('unrelated', DEFAULT_INGRESS_LABELS),
		).toBeUndefined();
	});
});
