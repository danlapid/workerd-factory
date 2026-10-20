import * as v from 'valibot';
import { thinkingLevelSchema } from '../thinking.ts';

const nonEmptyString = v.pipe(v.string(), v.trim(), v.minLength(1));

/**
 * One ingress classification run per GitHub delivery. Ingress only reads the
 * issue and applies labels, so the params carry nothing beyond where the
 * issue lives and which action brought it here.
 */
export const ingressWorkflowParamsSchema = v.object({
	deliveryId: nonEmptyString,
	installationId: v.pipe(v.number(), v.integer(), v.minValue(1)),
	repositoryId: v.pipe(v.number(), v.integer(), v.minValue(1)),
	owner: nonEmptyString,
	repo: nonEmptyString,
	issueNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
	defaultBranch: nonEmptyString,
	issueAction: v.picklist(['opened', 'reopened']),
});

export type IngressWorkflowParams = v.InferOutput<
	typeof ingressWorkflowParamsSchema
>;

export function ingressCoordinatorKey(
	input: Pick<IngressWorkflowParams, 'repositoryId' | 'issueNumber'>,
): string {
	return `${input.repositoryId}:${input.issueNumber}`;
}

export type IngressWorkflowOutcome =
	| { outcome: 'ignored'; reason: string }
	| { outcome: 'skipped'; reason: string }
	| {
			outcome: 'classified';
			classification: IssueClassification;
			labels: string[];
			commented: boolean;
	  }
	| { outcome: 'failed'; reason: string };

// ---------- Classifier agent contracts ----------

const conversationEntrySchema = v.object({
	author: nonEmptyString,
	association: v.string(),
	isBot: v.boolean(),
	body: v.string(),
});

export const issueClassifierInputSchema = v.object({
	owner: nonEmptyString,
	repo: nonEmptyString,
	issueNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
	issueTitle: v.string(),
	issueBody: v.string(),
	issueAuthor: nonEmptyString,
	issueAuthorAssociation: v.string(),
	conversation: v.array(conversationEntrySchema),
	model: nonEmptyString,
	thinkingLevel: v.optional(thinkingLevelSchema),
});

export type IssueClassifierInput = v.InferOutput<
	typeof issueClassifierInputSchema
>;

/**
 * The classification the ingress agent submits. Three independent axes:
 * whether the report is genuine, what kind of report it is, and — for bug
 * reports — whether it already carries enough to attempt a reproduction.
 * `reproduction` is `not-applicable` for anything that isn't a bug report.
 */
export const issueClassificationSchema = v.object({
	legitimacy: v.picklist(['genuine', 'fake']),
	kind: v.picklist(['bug-report', 'question', 'feature-request']),
	reproduction: v.picklist([
		'has-reproduction',
		'needs-reproduction',
		'not-applicable',
	]),
	reasoning: v.pipe(v.string(), v.maxLength(2_000)),
});

export type IssueClassification = v.InferOutput<
	typeof issueClassificationSchema
>;
