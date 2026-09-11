import { z } from 'zod';
import { finding, type CheckDefinition } from '../types.js';

export const missingArtifact: CheckDefinition = {
  name: 'missing_artifact',
  defaultSeverity: 'blocker',
  params: z.object({}).passthrough(),
  run: ({ declaredArtifacts, artifacts }) =>
    declaredArtifacts
      .filter((name) => !(name in artifacts))
      .map((name) => finding('missing_artifact', 'blocker', name, `artifact "${name}" was not submitted`)),
};
