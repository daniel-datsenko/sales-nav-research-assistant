#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const WORKSPACE = path.join(ROOT, 'autobrowse');
const TASKS = [
  'sales-nav-company-resolution',
  'sales-nav-connect-surface-diagnostic',
];
const UNSAFE_FLAGS = new Set([
  '--live-save',
  '--live-connect',
  '--allow-background-connects',
]);

function parseArgs(argv) {
  const out = {
    run: false,
    task: null,
    iterations: 3,
    env: 'local',
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (UNSAFE_FLAGS.has(arg)) {
      throw new Error(`autobrowse:mvp is dry-safe only and refuses ${arg}`);
    }
    if (arg === '--run') {
      out.run = true;
    } else if (arg === '--task') {
      out.task = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--task=')) {
      out.task = arg.slice('--task='.length);
    } else if (arg === '--iterations') {
      out.iterations = Number(argv[index + 1] || 3);
      index += 1;
    } else if (arg.startsWith('--iterations=')) {
      out.iterations = Number(arg.slice('--iterations='.length));
    } else if (arg === '--env') {
      out.env = argv[index + 1] || 'local';
      index += 1;
    } else if (arg.startsWith('--env=')) {
      out.env = arg.slice('--env='.length);
    }
  }
  return out;
}

function taskPath(taskName, fileName) {
  return path.join(WORKSPACE, 'tasks', taskName, fileName);
}

function checkWorkspace() {
  return TASKS.map((task) => ({
    task,
    taskMd: fs.existsSync(taskPath(task, 'task.md')),
    strategyMd: fs.existsSync(taskPath(task, 'strategy.md')),
  }));
}

function findEvaluateScript() {
  const skillDir = process.env.AUTOBROWSE_SKILL_DIR || process.env.CLAUDE_SKILL_DIR;
  if (!skillDir) {
    return null;
  }
  const evaluatePath = path.join(skillDir, 'scripts', 'evaluate.mjs');
  return fs.existsSync(evaluatePath) ? evaluatePath : null;
}

function printStatus(status, evaluateScript) {
  console.log('AutoBrowse MVP Lab');
  console.log(`Workspace: ${WORKSPACE}`);
  console.log(`Evaluate script: ${evaluateScript || '(not configured)'}`);
  for (const row of status) {
    console.log(`${row.task}: task.md=${row.taskMd ? 'ok' : 'missing'} strategy.md=${row.strategyMd ? 'ok' : 'missing'}`);
  }
  console.log('');
  console.log('Dry-safe default: no browser evaluation is run unless --run is passed.');
  console.log('To run: AUTOBROWSE_SKILL_DIR=/path/to/autobrowse npm run autobrowse:mvp -- --run --task sales-nav-company-resolution --iterations=3 --env=local');
}

function runEvaluate({ task, iterations, env }, evaluateScript) {
  if (!task || !TASKS.includes(task)) {
    throw new Error(`--task must be one of: ${TASKS.join(', ')}`);
  }
  if (!evaluateScript) {
    throw new Error('Set AUTOBROWSE_SKILL_DIR or CLAUDE_SKILL_DIR to the installed AutoBrowse skill directory.');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required by the upstream AutoBrowse evaluate script.');
  }

  for (let iteration = 1; iteration <= Math.max(1, Number(iterations || 1)); iteration += 1) {
    console.log(`Running AutoBrowse ${task} iteration ${iteration}/${iterations} (${env})`);
    const args = [
      evaluateScript,
      '--task',
      task,
      '--workspace',
      WORKSPACE,
    ];
    if (env === 'remote') {
      args.push('--env', 'remote');
    }
    const result = spawnSync(process.execPath, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    if (result.status !== 0) {
      process.exit(result.status || 1);
    }
  }
}

function main() {
  const args = parseArgs(process.argv);
  const status = checkWorkspace();
  const missing = status.filter((row) => !row.taskMd || !row.strategyMd);
  if (missing.length > 0) {
    throw new Error(`AutoBrowse workspace is incomplete: ${missing.map((row) => row.task).join(', ')}`);
  }
  const evaluateScript = findEvaluateScript();
  if (!args.run) {
    printStatus(status, evaluateScript);
    return;
  }
  runEvaluate(args, evaluateScript);
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
