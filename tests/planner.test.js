import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getRecommendedTasks, isTaskCompletionExpired, isSunsetWithin, normalizePlan, parseCleaningYaml, summarizeProgress, taskCompletionExpiresAt } from '../src/planner.js';

test('loads rooms, apartment size, and tasks from repository YAML', async () => {
  const yaml = await readFile(new URL('../data/cleaning-plan.yml', import.meta.url), 'utf8');
  const plan = parseCleaningYaml(yaml);

  assert.equal(plan.apartment.size, 'medium');
  assert.equal(plan.rooms.length, 7);
  assert.equal(plan.rooms[0].name, 'Kitchen');
  assert.equal(plan.rooms[0].tasks[0].name, 'Extractor fan');
  assert.ok(plan.rooms[0].tasks.some((task) => task.name === 'Oven'));
  assert.deepEqual(
    plan.rooms.find((room) => room.id === 'general').tasks.map((task) => task.name),
    ['Dusting (stof verwijderen)', 'Vacuuming', 'Mopping'],
  );
  assert.equal(plan.rooms[0].tasks.at(-1).priority, 'low');
});

test('summarizes progress and remaining time while ignoring not applicable tasks', async () => {
  const yaml = await readFile(new URL('../data/cleaning-plan.yml', import.meta.url), 'utf8');
  const plan = normalizePlan(parseCleaningYaml(yaml));
  const first = plan.rooms[0].tasks[0].uid;
  const second = plan.rooms[0].tasks[1].uid;
  const progress = summarizeProgress(plan, {
    completed: { [first]: { completedAt: '2026-05-21T18:00:00.000Z', actualMinutes: 5 } },
    skipped: { [second]: '2026-05-21T18:01:00.000Z' },
  });

  assert.equal(progress.done, 1);
  assert.equal(progress.total, 29);
  assert.ok(progress.remainingMinutes > 0);
});

test('expired recurring tasks become actionable again', async () => {
  const yaml = await readFile(new URL('../data/cleaning-plan.yml', import.meta.url), 'utf8');
  const plan = normalizePlan(parseCleaningYaml(yaml));
  const task = plan.rooms.find((room) => room.id === 'general').tasks.find((item) => item.id === 'corner-dusting');
  const state = { completed: { [task.uid]: { completedAt: '2026-05-01T10:00:00.000Z', actualMinutes: 20 } } };
  const now = new Date('2026-05-09T10:00:00.000Z');

  assert.equal(task.repeatDays, 7);
  assert.equal(taskCompletionExpiresAt(task, state.completed[task.uid]).toISOString(), '2026-05-08T10:00:00.000Z');
  assert.equal(isTaskCompletionExpired(task, state.completed[task.uid], now), true);
  assert.equal(summarizeProgress(plan, state, now).done, 0);
  assert.ok(getRecommendedTasks(plan, state, {}, now).some((item) => item.uid === task.uid));
});

test('recommended order puts set-and-forget and urgent daylight work early near sunset', async () => {
  const yaml = await readFile(new URL('../data/cleaning-plan.yml', import.meta.url), 'utf8');
  const plan = normalizePlan(parseCleaningYaml(yaml));
  const now = new Date('2026-05-21T16:00:00.000Z');
  const recommended = getRecommendedTasks(plan, {}, { sunset: '2026-05-21T17:00:00.000Z' }, now);

  assert.equal(recommended[0].tag, 'set-and-forget');
  assert.ok(recommended.findIndex((task) => task.tag === 'needs-daylight') < recommended.findIndex((task) => task.tag === 'anytime'));
});

test('recommended order surfaces quick chores around lunch time', async () => {
  const yaml = await readFile(new URL('../data/cleaning-plan.yml', import.meta.url), 'utf8');
  const plan = normalizePlan(parseCleaningYaml(yaml));
  const now = new Date('2026-05-23T12:15:00.000Z');
  const recommended = getRecommendedTasks(plan, {}, { sunset: '2026-05-23T19:00:00.000Z' }, now);

  assert.ok(Number(recommended[0].estimateMinutes) <= 12);
});

test('detects sunset within a configurable warning window', () => {
  const now = new Date('2026-05-21T16:00:00.000Z');

  assert.equal(isSunsetWithin('2026-05-21T17:30:00.000Z', 2, now), true);
  assert.equal(isSunsetWithin('2026-05-21T19:30:00.000Z', 2, now), false);
});
