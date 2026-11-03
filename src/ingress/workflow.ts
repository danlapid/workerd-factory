import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from 'cloudflare:workers';
import { init } from '@flue/runtime';
import * as v from 'valibot';
import { type IngressConfig, loadFactoryConfig } from '../config.ts';
import type { WorkerEnv } from '../env.ts';
import { isBotAuthor } from '../github/bots.ts';
import {
	createInstallationClient,
	credentialsFromWorkerEnv,
	type InstallationClient,
} from '../github/client.ts';
import {
	addIssueLabels,
	ensureLabelExists,
	fetchIssueDetails,
	normalizeIssueState,
	upsertIssueComment,
} from '../github/issues.ts';
import { IssueClassifier } from './agents/issue-classifier.ts';
import { formatReproductionRequest, ingressCommentMarker } from './comments.ts';
import {
	type IngressWorkflowOutcome,
	type IngressWorkflowParams,
	type IssueClassification,
	ingressCoordinatorKey,
	ingressWorkflowParamsSchema,
	issueClassificationSchema,
} from './contracts.ts';
import {
	allIngressLabels,
	ingressLabelAppearance,
	labelsForClassification,
} from './labels.ts';

const STEP_RETRIES = {
	retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
	timeout: '5 minutes',
} as const;

const MAX_ISSUE_BODY = 20_000;
const MAX_COMMENT_BODY = 4_000;
const MAX_CONVERSATION_ENTRIES = 20;

interface ConversationEntry {
	author: string;
	association: string;
	isBot: boolean;
	body: string;
}

/** Lean, JSON-serializable snapshot persisted as a workflow step result. */
interface RoutedIssue {
	ingress: IngressConfig;
	issue: {
		number: number;
		title: string;
		body: string;
		authorLogin: string;
		authorAssociation: string;
		conversation: ConversationEntry[];
	};
}

type RouteResult =
	| { kind: 'ignored' | 'skipped'; reason: string }
	| ({ kind: 'ready' } & RoutedIssue);

export class IngressWorkflow extends WorkflowEntrypoint<
	WorkerEnv,
	IngressWorkflowParams
> {
	override async run(
		event: Readonly<WorkflowEvent<IngressWorkflowParams>>,
		step: WorkflowStep,
	): Promise<IngressWorkflowOutcome> {
		const params = v.parse(ingressWorkflowParamsSchema, event.payload);
		const coordinator = this.env.INGRESS_COORDINATOR.getByName(
			ingressCoordinatorKey(params),
		);
		const completeCoordination = async () => {
			const result = await coordinator.complete(params.deliveryId);
			return {
				completed: result.completed,
				...(result.nextWorkflowId
					? { nextWorkflowId: result.nextWorkflowId }
					: {}),
			};
		};
		await step.do(
			'register ingress coordination',
			async () => params.deliveryId,
			{
				rollback: async () => {
					await completeCoordination();
				},
				rollbackConfig: STEP_RETRIES,
			},
		);
		const finish = async (
			outcome: IngressWorkflowOutcome,
		): Promise<IngressWorkflowOutcome> => {
			await step.do(
				'complete ingress coordination',
				STEP_RETRIES,
				completeCoordination,
			);
			return outcome;
		};

		const credentials = credentialsFromWorkerEnv(this.env);
		const client = () =>
			createInstallationClient(credentials, params.installationId);

		try {
			const routed = await step.do('load issue and route', STEP_RETRIES, () =>
				loadAndRoute(client, params),
			);
			if (routed.kind !== 'ready') {
				return finish({ outcome: routed.kind, reason: routed.reason });
			}

			const classification = await this.classify(step, params, routed);

			const labels = labelsForClassification(
				classification,
				routed.ingress.labels,
			);
			if (labels.length > 0) {
				await step.do('apply classification labels', STEP_RETRIES, async () => {
					const api = await client();
					for (const label of labels) {
						await ensureLabelExists(
							api,
							params.owner,
							params.repo,
							label,
							ingressLabelAppearance(label, routed.ingress.labels),
						);
					}
					await addIssueLabels(
						api,
						params.owner,
						params.repo,
						params.issueNumber,
						labels,
					);
				});
			}

			let commented = false;
			if (
				classification.legitimacy === 'genuine' &&
				classification.kind === 'bug-report' &&
				classification.reproduction === 'needs-reproduction' &&
				routed.ingress.commentOnMissingReproduction
			) {
				await step.do('request a reproduction', STEP_RETRIES, async () => {
					const api = await client();
					await upsertIssueComment(
						api,
						params.owner,
						params.repo,
						params.issueNumber,
						ingressCommentMarker(params.issueNumber),
						formatReproductionRequest(routed.issue.authorLogin),
					);
				});
				commented = true;
			}

			return finish({
				outcome: 'classified',
				classification,
				labels,
				commented,
			});
		} catch (error) {
			// Classification is additive and optional: a failure leaves the issue
			// exactly as a repository without ingress would see it, so nothing is
			// posted — the outcome and logs carry the reason.
			return finish({
				outcome: 'failed',
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private async classify(
		step: WorkflowStep,
		params: IngressWorkflowParams,
		routed: RoutedIssue,
	): Promise<IssueClassification> {
		const agent = init(IssueClassifier, {
			id: [
				'ingress',
				params.repositoryId,
				params.issueNumber,
				params.deliveryId,
			].join(':'),
		});
		const receipt = await step.do('dispatch issue classifier', async () =>
			agent.dispatch({
				initialData: {
					owner: params.owner,
					repo: params.repo,
					issueNumber: params.issueNumber,
					issueTitle: routed.issue.title,
					issueBody: routed.issue.body,
					issueAuthor: routed.issue.authorLogin || 'ghost',
					issueAuthorAssociation: routed.issue.authorAssociation,
					conversation: routed.issue.conversation,
					model: routed.ingress.model,
					thinkingLevel: routed.ingress.thinkingLevel,
				},
				idempotencyKey: params.deliveryId,
				message: {
					kind: 'signal',
					type: 'github.issue.classification-requested',
					body: 'Classify this newly opened issue.',
					attributes: { deliveryId: params.deliveryId },
				},
			}),
		);
		return step.do(
			'read classification',
			{
				retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
				timeout: '15 minutes',
			},
			async () => {
				const reply = await agent.read(receipt);
				const writes = reply.data.classification;
				if (!writes?.length) {
					throw new Error(
						'The classifier completed without writing a classification.',
					);
				}
				return v.parse(issueClassificationSchema, writes.at(-1));
			},
		);
	}
}

async function loadAndRoute(
	client: () => Promise<InstallationClient>,
	params: IngressWorkflowParams,
): Promise<RouteResult> {
	const api = await client();
	const { config } = await loadFactoryConfig(
		api,
		params.owner,
		params.repo,
		params.defaultBranch,
	);
	if (!config.ingress) {
		return {
			kind: 'ignored',
			reason: 'Ingress classification is not configured for this repository.',
		};
	}

	const details = await fetchIssueDetails(
		api,
		params.owner,
		params.repo,
		params.issueNumber,
	);
	if (isBotAuthor(details.author.login)) {
		return {
			kind: 'skipped',
			reason: `Issue opened by a bot (${details.author.login}).`,
		};
	}
	// The delivery only says what happened; the issue may have moved on while
	// the delivery waited its turn in the per-issue queue.
	if (normalizeIssueState(details.state) === 'closed') {
		return { kind: 'skipped', reason: 'The issue is already closed.' };
	}
	const existing = allIngressLabels(config.ingress.labels).filter((label) =>
		details.labels.includes(label),
	);
	if (existing.length > 0) {
		return {
			kind: 'skipped',
			reason: `The issue is already classified (${existing.join(', ')}).`,
		};
	}

	return {
		kind: 'ready',
		ingress: config.ingress,
		issue: {
			number: details.number,
			title: details.title,
			body: details.body.slice(0, MAX_ISSUE_BODY),
			authorLogin: details.author.login,
			authorAssociation: details.authorAssociation,
			conversation: details.comments
				.slice(-MAX_CONVERSATION_ENTRIES)
				.map((comment) => ({
					author: comment.author.login,
					association: comment.authorAssociation,
					isBot: comment.authorIsBot,
					body: comment.body.slice(0, MAX_COMMENT_BODY),
				})),
		},
	};
}
