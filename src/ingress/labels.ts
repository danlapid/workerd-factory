/**
 * Ingress classification label vocabulary.
 *
 * Unlike the triage state machine, ingress labels are additive: the bot adds
 * the labels the classification implies and never removes anything, so a
 * maintainer's own labeling is never fought. The defaults reuse GitHub's
 * stock labels where one fits, so most repositories need no label setup.
 */

import type { IssueClassification } from './contracts.ts';

export interface IngressLabelConfig {
	/** The report looks like spam, LLM slop, or an otherwise non-genuine issue. */
	fake: string;
	bug: string;
	question: string;
	featureRequest: string;
	hasReproduction: string;
	needsReproduction: string;
}

export const DEFAULT_INGRESS_LABELS: IngressLabelConfig = {
	fake: 'invalid',
	bug: 'bug',
	question: 'question',
	featureRequest: 'enhancement',
	hasReproduction: 'has repro',
	needsReproduction: 'needs repro',
};

export interface IngressLabelAppearance {
	color: string;
	description: string;
}

/** Colors and descriptions used when the bot creates a missing label. */
export const INGRESS_LABEL_APPEARANCE: Record<
	keyof IngressLabelConfig,
	IngressLabelAppearance
> = {
	fake: {
		color: 'e4e669',
		description: "This doesn't seem right",
	},
	bug: {
		color: 'd73a4a',
		description: "Something isn't working",
	},
	question: {
		color: 'd876e3',
		description: 'Further information is requested',
	},
	featureRequest: {
		color: 'a2eeef',
		description: 'New feature or request',
	},
	hasReproduction: {
		color: '0e8a16',
		description: 'The report includes reproduction steps',
	},
	needsReproduction: {
		color: 'fbca04',
		description: 'A reproduction is needed to make progress',
	},
};

/** All configured ingress labels. An issue carrying any of them was classified. */
export function allIngressLabels(config: IngressLabelConfig): string[] {
	return [
		config.fake,
		config.bug,
		config.question,
		config.featureRequest,
		config.hasReproduction,
		config.needsReproduction,
	];
}

/**
 * The labels a classification maps to. A fake report gets the fake label and
 * nothing else — kind and reproduction are meaningless on spam. Reproduction
 * labels apply only to bug reports.
 */
export function labelsForClassification(
	classification: IssueClassification,
	config: IngressLabelConfig,
): string[] {
	if (classification.legitimacy === 'fake') return [config.fake];
	const labels: string[] = [];
	switch (classification.kind) {
		case 'bug-report':
			labels.push(config.bug);
			break;
		case 'question':
			labels.push(config.question);
			break;
		case 'feature-request':
			labels.push(config.featureRequest);
			break;
	}
	if (classification.kind === 'bug-report') {
		if (classification.reproduction === 'has-reproduction') {
			labels.push(config.hasReproduction);
		} else if (classification.reproduction === 'needs-reproduction') {
			labels.push(config.needsReproduction);
		}
	}
	return labels;
}

/** Look up the appearance for a configured label name, if it is one of ours. */
export function ingressLabelAppearance(
	name: string,
	config: IngressLabelConfig,
): IngressLabelAppearance | undefined {
	for (const [key, configured] of Object.entries(config)) {
		if (configured === name) {
			return INGRESS_LABEL_APPEARANCE[key as keyof IngressLabelConfig];
		}
	}
	return undefined;
}
