const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const taskNames = [
  'sales-nav-company-resolution',
  'sales-nav-connect-surface-diagnostic',
];

test('autobrowse workspace has dry-safe MVP tasks', () => {
  for (const taskName of taskNames) {
    const task = fs.readFileSync(path.join(projectRoot, 'autobrowse', 'tasks', taskName, 'task.md'), 'utf8');
    const strategy = fs.readFileSync(path.join(projectRoot, 'autobrowse', 'tasks', taskName, 'strategy.md'), 'utf8');
    assert.match(task, /Required Output/);
    assert.match(task, /No live-save|Do not save/i);
    assert.match(task, /No live-connect|Do not send/i);
    assert.match(strategy, /Safety/);
  }
});

test('autobrowse npm script validates workspace without running evaluation', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['autobrowse:mvp'], 'node automation/autobrowse-mvp.js');

  const result = spawnSync(process.execPath, ['automation/autobrowse-mvp.js'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /AutoBrowse MVP Lab/);
  assert.match(result.stdout, /sales-nav-company-resolution/);
  assert.match(result.stdout, /sales-nav-connect-surface-diagnostic/);
});

test('autobrowse wrapper refuses live mutation flags', () => {
  const result = spawnSync(process.execPath, ['automation/autobrowse-mvp.js', '--live-connect'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dry-safe only/);
});
