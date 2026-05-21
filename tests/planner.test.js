import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  addCustomTask,
  completeTask,
  createInitialState,
  getAllTasks,
  getProgress,
  getRecommendedTasks,
  getRemainingMinutes,
  parseCleaningPlanYaml,
  shouldWarnForDaylight
} from '../src/planner.js';

const yaml = await readFile(new URL('../data/cleaning-plan.yaml', import.meta.url), 'utf8');
const plan = parseCleaningPlanYaml(yaml);

test('loads apartment metadata, rooms, and task attributes from YAML', () => {
  assert.equal(plan.apartment.size, 'medium apartment');
  assert.equal(plan.rooms.length, 7);
  assert.equal(getAllTasks(plan).length, 28);
  const drawers = getAllTasks(plan).find(task => task.key === 'kitchen:drawers');
  assert.equal(drawers.priority, 'low');
  assert.equal(drawers.tag, 'anytime');
  assert.equal(drawers.estimateMinutes, 20);
});

test('recommends set-and-forget and time-sensitive tasks before normal anytime work', () => {
  const recommended = getRecommendedTasks(plan, createInitialState(), new Date('2026-05-21T10:00:00Z'), new Date('2026-05-21T20:00:00Z'));
  assert.equal(recommended[0].tag, 'set-and-forget');
  assert.ok(recommended.findIndex(task => task.tag === 'time-sensitive') < recommended.findIndex(task => task.tag === 'anytime'));
});

test('flags daylight tasks when sunset is within two hours', () => {
  const task = getAllTasks(plan).find(item => item.tag === 'needs-daylight');
  assert.equal(shouldWarnForDaylight(task, new Date('2026-05-21T18:15:00Z'), new Date('2026-05-21T20:00:00Z')), true);
  assert.equal(shouldWarnForDaylight(task, new Date('2026-05-21T15:00:00Z'), new Date('2026-05-21T20:00:00Z')), false);
});

test('tracks completion progress and remaining estimates', () => {
  const state = createInitialState(new Date('2026-05-21T10:00:00Z'));
  const task = getAllTasks(plan)[0];
  const next = completeTask(state, task, new Date('2026-05-21T10:12:00Z'));
  assert.equal(getProgress(getAllTasks(plan), next).done, 1);
  assert.equal(next.completed[task.key].durationMinutes, 12);
  assert.equal(getRemainingMinutes([task], next), 0);
});

test('adds custom tasks with planner defaults', () => {
  const next = addCustomTask(createInitialState(), 'kitchen', { name: 'Window sill' });
  const custom = next.customTasks.kitchen[0];
  assert.match(custom.id, /^custom-window-sill-/);
  assert.equal(custom.priority, 'normal');
  assert.equal(custom.tag, 'anytime');
  assert.equal(custom.estimateMinutes, 10);
});
