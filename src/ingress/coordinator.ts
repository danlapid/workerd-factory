import * as v from 'valibot';
import { QueueCoordinator } from '../coordination/queue-coordinator.ts';
import {
	type IngressWorkflowParams,
	ingressWorkflowParamsSchema,
} from './contracts.ts';

interface IngressCoordinatorEnv {
	INGRESS_WORKFLOW: Workflow<IngressWorkflowParams>;
}

/**
 * Serializes ingress classification runs per issue; keyed
 * `repositoryId:issueNumber`. Deduplicates webhook redeliveries.
 */
export class IngressCoordinator extends QueueCoordinator<
	IngressWorkflowParams,
	IngressCoordinatorEnv
> {
	protected parseParams(input: unknown): IngressWorkflowParams {
		return v.parse(ingressWorkflowParamsSchema, input);
	}

	protected workflowBinding(): Workflow<IngressWorkflowParams> {
		return this.env.INGRESS_WORKFLOW;
	}
}
