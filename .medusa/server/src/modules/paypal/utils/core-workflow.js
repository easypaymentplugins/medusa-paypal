"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCoreWorkflow = runCoreWorkflow;
const workflows_sdk_1 = require("@medusajs/framework/workflows-sdk");
/**
 * Run a Medusa *core* workflow by its registered id, without importing it from
 * `@medusajs/core-flows`.
 *
 * Why this exists:
 * Importing anything from `@medusajs/core-flows` (e.g.
 * `import { completeCartWorkflow } from "@medusajs/core-flows"`) pulls in the
 * entire core-flows barrel. Every workflow module in that barrel calls
 * `createWorkflow(...)` at import time, which registers the workflow in the
 * global `WorkflowManager`. When this plugin is resolved as a *separate* copy
 * of `@medusajs/core-flows` from the host application — which is exactly what
 * happens when the plugin is consumed as a locally-linked package living
 * outside the app's `node_modules` (e.g. a sibling folder with its own
 * `node_modules`) — those registrations run a second time and collide with the
 * host's already-registered workflows. Medusa then aborts boot with:
 *
 *   An error occurred while registering API Routes.
 *   Error: Workflow with id "create-fulfillment-workflow" and step definition
 *   already exists.
 *
 * (The id is whichever core workflow happens to register first.)
 *
 * The host registers every core workflow into the global `MedusaWorkflow`
 * registry at startup. Looking the workflow up there and running it reuses that
 * single registered instance and never triggers a second registration, so the
 * plugin works regardless of how it is installed or linked.
 */
async function runCoreWorkflow(container, workflowId, input) {
    const workflow = workflows_sdk_1.MedusaWorkflow.getWorkflow(workflowId);
    if (!workflow) {
        throw new Error(`Core workflow "${workflowId}" is not registered. ` +
            `Ensure the Medusa application has loaded its core workflows.`);
    }
    return workflow(container).run({ input });
}
//# sourceMappingURL=core-workflow.js.map