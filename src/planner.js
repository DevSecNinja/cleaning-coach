const PRIORITY_WEIGHT = { urgent: 0, normal: 1, low: 2 };
const TAG_WEIGHT = { 'set-and-forget': 0, 'time-sensitive': 1, 'needs-daylight': 2, anytime: 3 };
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseCleaningYaml(source) {
  const lines = source.split(/\r?\n/);
  const plan = { apartment: {}, rooms: [] };
  let room = null;
  let task = null;
  let section = '';

  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^\s*/)[0].length;
    const line = raw.trim();

    if (line === 'apartment:') {
      section = 'apartment';
      continue;
    }
    if (line === 'rooms:') {
      section = 'rooms';
      continue;
    }
    if (section === 'apartment' && indent === 2) {
      const [key, ...value] = line.split(':');
      plan.apartment[key] = coerceYamlValue(value.join(':').trim());
      continue;
    }
    if (section === 'rooms' && indent === 2 && line.startsWith('- ')) {
      room = { tasks: [] };
      plan.rooms.push(room);
      assignYamlPair(room, line.slice(2));
      continue;
    }
    if (room && indent === 4 && line === 'tasks:') continue;
    if (room && indent === 4) {
      assignYamlPair(room, line);
      continue;
    }
    if (room && indent === 6 && line.startsWith('- ')) {
      task = {};
      room.tasks.push(task);
      assignYamlPair(task, line.slice(2));
      continue;
    }
    if (task && indent === 8) assignYamlPair(task, line);
  }

  return plan;
}

function assignYamlPair(target, pair) {
  const [key, ...rest] = pair.split(':');
  target[key] = coerceYamlValue(rest.join(':').trim());
}

function coerceYamlValue(value) {
  if (/^\d+$/.test(value)) return Number(value);
  return value.replace(/^['"]|['"]$/g, '');
}

export function normalizePlan(plan, state = {}) {
  const customTasks = state.customTasks || {};
  const order = state.order || {};
  return {
    ...plan,
    rooms: plan.rooms.map((room) => {
      const tasks = [...room.tasks, ...(customTasks[room.id] || [])].map((task) => ({
        ...task,
        roomId: room.id,
        uid: `${room.id}:${task.id}`,
      }));
      const orderedTasks = applyRoomOrder(tasks, order[room.id]);
      return { ...room, tasks: orderedTasks };
    }),
  };
}

function applyRoomOrder(tasks, order = []) {
  if (!order.length) return tasks;
  const byId = new Map(tasks.map((task) => [task.uid, task]));
  const ordered = order.map((id) => byId.get(id)).filter(Boolean);
  const remaining = tasks.filter((task) => !order.includes(task.uid));
  return [...ordered, ...remaining];
}

export function getAllTasks(plan) {
  return plan.rooms.flatMap((room) => room.tasks.map((task) => ({ ...task, roomName: room.name })));
}

export function getRecommendedTasks(plan, state = {}, sun = {}, now = new Date()) {
  const completed = state.completed || {};
  const skipped = state.skipped || {};
  const tasks = getAllTasks(plan).filter((task) => !isTaskDone(task, completed[task.uid], now) && !skipped[task.uid]);
  const daylightUrgency = minutesUntil(sun.sunset, now) <= 120;
  const lunchWindow = now.getHours() >= 11 && now.getHours() <= 14;

  return tasks.sort((a, b) => {
    const aLunchBoost = lunchWindow && Number(a.estimateMinutes || 0) <= 12 ? 0 : 1;
    const bLunchBoost = lunchWindow && Number(b.estimateMinutes || 0) <= 12 ? 0 : 1;
    const aTag = a.tag === 'needs-daylight' && daylightUrgency ? 1 : TAG_WEIGHT[a.tag] ?? 4;
    const bTag = b.tag === 'needs-daylight' && daylightUrgency ? 1 : TAG_WEIGHT[b.tag] ?? 4;
    return aLunchBoost - bLunchBoost
      || aTag - bTag
      || (PRIORITY_WEIGHT[a.priority] ?? 3) - (PRIORITY_WEIGHT[b.priority] ?? 3)
      || a.estimateMinutes - b.estimateMinutes;
  });
}

export function summarizeProgress(plan, state = {}, now = new Date()) {
  const completed = state.completed || {};
  const skipped = state.skipped || {};
  const rooms = plan.rooms.map((room) => {
    const actionable = room.tasks.filter((task) => !skipped[task.uid]);
    const done = actionable.filter((task) => isTaskDone(task, completed[task.uid], now)).length;
    const total = actionable.length;
    return { id: room.id, name: room.name, done, total, percent: total ? Math.round((done / total) * 100) : 100 };
  });
  const totals = rooms.reduce((sum, room) => ({ done: sum.done + room.done, total: sum.total + room.total }), { done: 0, total: 0 });
  const remainingMinutes = getAllTasks(plan)
    .filter((task) => !isTaskDone(task, completed[task.uid], now) && !skipped[task.uid])
    .reduce((sum, task) => sum + Number(task.estimateMinutes || 0), 0);
  return { rooms, done: totals.done, total: totals.total, percent: totals.total ? Math.round((totals.done / totals.total) * 100) : 100, remainingMinutes };
}

function isTaskDone(task, completion, now) {
  return Boolean(completion) && !isTaskCompletionExpired(task, completion, now);
}

export function isTaskCompletionExpired(task, completion, now = new Date()) {
  const expiresAt = taskCompletionExpiresAt(task, completion);
  return Boolean(expiresAt) && expiresAt <= now;
}

export function taskCompletionExpiresAt(task, completion) {
  const repeatDays = Number(task.repeatDays || 0);
  if (!repeatDays || !completion?.completedAt) return null;
  const completedAt = new Date(completion.completedAt);
  if (Number.isNaN(completedAt.getTime())) return null;
  return new Date(completedAt.getTime() + repeatDays * DAY_MS);
}

export function isSunsetWithin(sunset, hours, now = new Date()) {
  const minutes = minutesUntil(sunset, now);
  return minutes >= 0 && minutes <= hours * 60;
}

export function minutesUntil(value, now = new Date()) {
  if (!value) return Infinity;
  return Math.round((new Date(value).getTime() - now.getTime()) / 60000);
}

export function makeCustomTask(roomId, name, estimateMinutes = 15) {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `task-${Date.now()}`;
  return { id: `custom-${id}-${Date.now()}`, roomId, name, priority: 'normal', tag: 'anytime', estimateMinutes: Number(estimateMinutes) || 15, custom: true };
}
