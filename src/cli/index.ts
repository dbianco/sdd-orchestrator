#!/usr/bin/env node
import { userInfo } from 'node:os';
import { Command } from 'commander';
import { appCommand } from './commands/app.js';
import { deprecateCommand, deprecateFrameworkCommand } from './commands/deprecate.js';
import { ingestCommand } from './commands/ingest.js';
import { proposalsCommand } from './commands/proposals.js';
import { reindexCommand } from './commands/reindex.js';
import { fail } from './context.js';

const defaultActor = (() => { try { return userInfo().username; } catch { return 'unknown'; } })();
const actorOption = (c: Command): Command => c.option('--actor <name>', 'display identity recorded as created_by', defaultActor);

const program = new Command('sdd-admin').description('SDD Orchestrator admin CLI');
program.addCommand(appCommand(actorOption));
program.addCommand(ingestCommand(actorOption));
program.addCommand(deprecateCommand(actorOption));
program.addCommand(deprecateFrameworkCommand(actorOption));
program.addCommand(proposalsCommand(actorOption));
program.addCommand(reindexCommand(actorOption));

program.parseAsync(process.argv).catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
