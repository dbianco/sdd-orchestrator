import { z } from 'zod';
import { finding, type CheckDefinition } from '../types.js';

export const humanApproved: CheckDefinition = {
  name: 'human_approved',
  defaultSeverity: 'blocker',
  params: z.object({}).passthrough(),
  run: ({ human_approved }) =>
    human_approved ? [] : [finding('human_approved', 'blocker', null, 'human approval is required for this transition')],
};
