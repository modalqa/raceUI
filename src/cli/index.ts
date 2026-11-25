#!/usr/bin/env node
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { EXIT } from '../assertions/classify.js';
import { resolveRunConfig, runScenario } from '../engine/runner.js';
import { header, paint, summary } from '../reporters/terminal.js';
import { checkRepeatPolicy, ConfigError, loadScenario } from '../schema/load.js';
import { LIMITS } from '../schema/scenario.js';
import { PolicyError } from '../security/origin.js';
import { VERSION } from '../version.js';
import { renderLogo, supportsColor } from './logo.js';
import { INIT_TEMPLATE } from './template.js';

const color = supportsColor();
const p = paint(color);
const out = (s = '') => process.stdout.write(s + '\n');
const err = (s = '') => process.stderr.write(s + '\n');

function intArg(name: string, min: number, max: number) {
  return (v: string) => {
    if (!/^\d+$/.test(v)) throw new InvalidArgumentError(`${name} must be an integer`);
    const n = Number(v);
    if (n < min || n > max) throw new InvalidArgumentError(`${name} must be between ${min} and ${max}`);
    return n;
  };
}

function collect(v: string, prev: string[]): string[] {
  return [...prev, v];
}

function reportConfigError(e: unknown): number {
  if (e instanceof ConfigError) {
    err(p.red('Configuration error:'));
    for (const i of e.issues) err(`  - ${i}`);
    return EXIT.CONFIG;
  }
  if (e instanceof PolicyError) {
    err(p.red(`Target policy error: ${e.message}`));
    return EXIT.CONFIG;
  }
  throw e;
}

const program = new Command();
program
  .name('raceui')
  .description('Two users. One resource. Zero room for bugs.\nAgent-friendly concurrency testing through real browser interactions.')
  .version(VERSION, '-v, --version')
  .showHelpAfterError('(run with --help for usage)')
  .configureOutput({ writeErr: (s) => process.stderr.write(s) })
  .addHelpText('before', () => `${renderLogo(VERSION, color)}\n`)
  .addHelpText(
    'after',
    `
Exit codes:
  0    all requested attempts PASS
  1    one or more confirmed invariant violations (FAIL)
  2    invalid scenario/configuration or unsafe target policy
  3    no confirmed violation, but attempts INCONCLUSIVE or not completed
  130  interrupted by the user

Examples:
  raceui init
  raceui validate ./booking.yaml
  raceui run ./booking.yaml --repeat 20 --seed 42
  raceui run ./booking.yaml --allow-origin https://staging.example.com`,
  );

program
  .command('init')
  .argument('[path]', 'scenario file (or directory) to create', 'raceui.yaml')
  .description('write an example scenario with instructions (never overwrites without --force)')
  .option('-f, --force', 'overwrite an existing file')
  .action((target: string, o: { force?: boolean }) => {
    let file = path.resolve(target);
    if ((existsSync(file) && statSync(file).isDirectory()) || target.endsWith('/') || target.endsWith('\\')) file = path.join(file, 'raceui.yaml');
    if (existsSync(file) && !o.force) {
      err(p.red(`Refusing to overwrite ${path.relative(process.cwd(), file)} (use --force to overwrite).`));
      process.exitCode = EXIT.CONFIG;
      return;
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, INIT_TEMPLATE, 'utf8');
    out(renderLogo(VERSION, color));
    out();
    out(`${p.green('Created')} ${path.relative(process.cwd(), file) || file}`);
    out(`
Next steps:
  1. Edit baseUrl, actors, selectors and assertions for your application.
  2. Keep auth state and artifacts out of git, e.g. add to .gitignore:
       auth/
       artifacts/
  3. Validate:  raceui validate ${path.relative(process.cwd(), file)}
  4. Run:       raceui run ${path.relative(process.cwd(), file)}

Want a target to try first? Start the bundled playground:  npx raceui-playground --mode vulnerable`);
  });

program
  .command('validate')
  .argument('<file>', 'scenario YAML file')
  .description('validate schema, references, environment variables and local files without opening the target')
  .option('--repeat <n>', 'validate with this repeat override', intArg('--repeat', 1, LIMITS.maxRepeat))
  .option('--allow-origin <origin>', 'authorize a non-loopback target origin (repeatable)', collect, [])
  .option('--json', 'print a machine-readable result')
  .action((file: string, o: { repeat?: number; allowOrigin: string[]; json?: boolean }) => {
    try {
      const loaded = loadScenario(file);
      const repeat = o.repeat ?? loaded.scenario.run.repeat;
      const issues = checkRepeatPolicy(loaded.scenario, repeat);
      if (issues.length) throw new ConfigError(issues);
      const cfg = resolveRunConfig(loaded, { repeat, allowOrigins: o.allowOrigin, seed: loaded.scenario.run.seed ?? 0 });
      if (o.json) {
        out(JSON.stringify({ valid: true, scenario: loaded.scenario.name, actors: loaded.scenario.actors.map((a) => a.id), repeat, targetOrigin: cfg.policy.targetOrigin }, null, 2));
      } else {
        out(`${p.green('Valid')} ${loaded.scenario.name}`);
        out(`  Actors: ${loaded.scenario.actors.map((a) => a.id).join(', ')}`);
        out(`  Checks: ${loaded.scenario.assertions.checks.length} | Repeat: ${repeat} | Timing: ${loaded.scenario.timing.mode}`);
        out(`  Target: ${cfg.policy.targetOrigin}`);
      }
      process.exitCode = EXIT.PASS;
    } catch (e) {
      if (o.json && (e instanceof ConfigError || e instanceof PolicyError)) {
        out(JSON.stringify({ valid: false, issues: e instanceof ConfigError ? e.issues : [e.message] }, null, 2));
        process.exitCode = EXIT.CONFIG;
        return;
      }
      process.exitCode = reportConfigError(e);
    }
  });

program
  .command('run')
  .argument('<file>', 'scenario YAML file')
  .description('execute the scenario and write a terminal summary plus JSON report')
  .option('--repeat <n>', `override repeat count (1-${LIMITS.maxRepeat})`, intArg('--repeat', 1, LIMITS.maxRepeat))
  .option('--seed <n>', 'override the deterministic schedule seed', intArg('--seed', 0, 2 ** 32 - 1))
  .option('--headed', 'show browser windows for debugging')
  .option('--output <dir>', 'parent directory for the unique run directory', 'artifacts/raceui')
  .addOption(new Option('--evidence <mode>', 'override evidence mode').choices(['on-failure', 'always', 'none']))
  .option('--stop-on-fail', 'stop after the first confirmed failed attempt')
  .option('--allow-origin <origin>', 'authorize a non-loopback target origin (repeatable)', collect, [])
  .option('--json', 'print the JSON report to stdout instead of the terminal summary')
  .option('--no-logo', 'do not print the logo banner')
  .action(async (file: string, o: { repeat?: number; seed?: number; headed?: boolean; output: string; evidence?: 'on-failure' | 'always' | 'none'; stopOnFail?: boolean; allowOrigin: string[]; json?: boolean; logo: boolean }) => {
    let loaded;
    try {
      loaded = loadScenario(file);
      resolveRunConfig(loaded, { repeat: o.repeat, seed: o.seed ?? 0, allowOrigins: o.allowOrigin });
    } catch (e) {
      process.exitCode = reportConfigError(e);
      return;
    }

    const ctrl = new AbortController();
    let sigints = 0;
    const onSigint = () => {
      sigints++;
      if (sigints > 1) process.exit(EXIT.INTERRUPTED);
      err(p.yellow('\nInterrupt received: closing browser contexts and writing a partial report (Ctrl+C again to force quit)...'));
      ctrl.abort();
    };
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigint);

    const log = o.json ? () => undefined : out;
    if (!o.json) {
      if (o.logo) log(renderLogo(VERSION, color) + '\n');
    }
    try {
      const outcome = await runScenario(loaded, {
        outputDir: o.output,
        repeat: o.repeat,
        seed: o.seed,
        headed: o.headed,
        evidence: o.evidence,
        stopOnFail: o.stopOnFail,
        allowOrigins: o.allowOrigin,
        signal: ctrl.signal,
        onProgress: o.json ? undefined : (m) => log(p.gray(m)),
      });
      if (o.json) {
        out(JSON.stringify(outcome.report, null, 2));
      } else {
        log('');
        log(header(outcome.report, loaded.scenario.actors.length));
        log(summary(outcome.report, color, process.cwd(), outcome.reportPath));
      }
      process.exitCode = outcome.report.exitCode;
    } catch (e) {
      try {
        process.exitCode = reportConfigError(e);
      } catch {
        err(p.red(`RaceUI error: ${(e as Error).message}`));
        process.exitCode = EXIT.INCONCLUSIVE;
      }
    } finally {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigint);
    }
  });

program
  .command('install-browser')
  .description('install the Chromium build used by RaceUI (delegates to the bundled Playwright installer)')
  .option('--with-deps', 'also install system dependencies (Linux CI; may require sudo)')
  .action(async (o: { withDeps?: boolean }) => {
    const require = createRequire(import.meta.url);
    const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
    const args = [cli, 'install', ...(o.withDeps ? ['--with-deps'] : []), 'chromium'];
    out(`Installing Chromium via Playwright (${args.slice(1).join(' ')}) ...`);
    const code = await new Promise<number>((resolve) => {
      const child = spawn(process.execPath, args, { stdio: 'inherit' });
      child.on('exit', (c) => resolve(c ?? 1));
      child.on('error', () => resolve(1));
    });
    process.exitCode = code === 0 ? 0 : 1;
  });

// Usage errors (unknown option, invalid argument) are configuration errors: exit 2.
program.exitOverride();
for (const c of program.commands) c.exitOverride();

if (process.argv.length <= 2) {
  program.outputHelp();
} else {
  program.parseAsync(process.argv).catch((e: unknown) => {
    if (e instanceof CommanderError) {
      process.exitCode = e.exitCode === 0 ? 0 : EXIT.CONFIG;
      return;
    }
    err(p.red(`RaceUI error: ${(e as Error).message}`));
    process.exitCode = EXIT.CONFIG;
  });
}
