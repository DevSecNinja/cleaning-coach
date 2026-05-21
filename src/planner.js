export const PRIORITY_WEIGHT = { urgent: 0, normal: 1, low: 2 };
export const TAG_WEIGHT = { 'set-and-forget': 0, 'time-sensitive': 1, 'needs-daylight': 2, anytime: 3 };
export const STORAGE_KEY = 'cleaning-coach-state-v1';

export function parseCleaningPlanYaml(yaml) {
  const plan = { apartment: {}, rooms: [] };
  let section = '';
  let room = null;
  let task = null;

  for (const rawLine of yaml.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    const indent = rawLine.match(/^ */)[0].length;
    const line = rawLine.trim();

    if (indent === 0 && line.endsWith(':')) {
      section = line.slice(0, -1);
      continue;
    }

    if (section === 'apartment' && indent === 2) {
      const [key, value] = splitKeyValue(line);
      plan.apartment[key] = parseScalar(value);
      continue;
    }

    if (section !== 'rooms') continue;

    if (indent === 2 && line.startsWith('- ')) {
      room = { tasks: [] };
      plan.rooms.push(room);
      task = null;
      const rest = line.slice(2);
      if (rest) {
        const [key, value] = splitKeyValue(rest);
        room[key] = parseScalar(value);
      }
      continue;
    }

    if (!room) continue;

    if (indent === 4) {
      const [key, value] = splitKeyValue(line);
      if (key === 'tasks') {
        task = null;
      } else {
        room[key] = parseScalar(value);
      }
      continue;
    }

    if (indent === 6 && line.startsWith('- ')) {
      task = {};
      room.tasks.push(task);
      const rest = line.slice(2);
      if (rest) {
        const [key, value] = splitKeyValue(rest);
        task[key] = parseScalar(value);
      }
      continue;
    }

    if (indent === 8 && task) {
      const [key, value] = splitKeyValue(line);
      task[key] = parseScalar(value);
    }
  }

  return normalizePlan(plan);
}

export function normalizePlan(plan) {
  const seen = new Set();
  const rooms = (plan.rooms || []).map((room, roomIndex) => ({
    ...room,
    order: roomIndex,
    tasks: (room.tasks || []).map((task, taskIndex) => {
      const normalized = {
        ...task,
        roomId: room.id,
        roomName: room.name,
        key: `${room.id}:${task.id}`,
        order: taskIndex,
        estimateMinutes: Number(task.estimateMinutes || 0)
      };
      if (seen.has(normalized.key)) throw new Error(`Duplicate task id: ${normalized.key}`);
      seen.add(normalized.key);
      return normalized;
    })
  }));

  return { ...plan, rooms };
}

export function createInitialState(now = new Date()) {
  return {
    sessionStartedAt: now.toISOString(),
    goal: '',
    completed: {},
    started: {},
    notApplicable: {},
    customTasks: {},
    order: {}
  };
}

export function mergeState(saved, now = new Date()) {
  return {
    ...createInitialState(now),
    ...(saved && typeof saved === 'object' ? saved : {}),
    completed: { ...(saved?.completed || {}) },
    started: { ...(saved?.started || {}) },
    notApplicable: { ...(saved?.notApplicable || {}) },
    customTasks: { ...(saved?.customTasks || {}) },
    order: { ...(saved?.order || {}) }
  };
}

export function getAllTasks(plan, state = {}) {
  return plan.rooms.flatMap(room => {
    const custom = (state.customTasks?.[room.id] || []).map((task, index) => ({
      priority: 'normal',
      tag: 'anytime',
      estimateMinutes: 10,
      ...task,
      custom: true,
      roomId: room.id,
      roomName: room.name,
      key: `${room.id}:${task.id}`,
      order: room.tasks.length + index
    }));
    return [...room.tasks, ...custom];
  });
}

export function getRoomTasks(plan, room, state = {}) {
  const tasks = getAllTasks({ ...plan, rooms: [room] }, state);
  const desiredOrder = state.order?.[room.id] || [];
  if (!desiredOrder.length) return tasks;
  const position = new Map(desiredOrder.map((key, index) => [key, index]));
  return [...tasks].sort((a, b) => {
    const aPos = position.has(a.key) ? position.get(a.key) : Number.MAX_SAFE_INTEGER;
    const bPos = position.has(b.key) ? position.get(b.key) : Number.MAX_SAFE_INTEGER;
    return aPos - bPos || a.order - b.order;
  });
}

export function isTaskDone(task, state) {
  return Boolean(state.completed?.[task.key] || state.notApplicable?.[task.key]);
}

export function getProgress(tasks, state) {
  const total = tasks.length;
  const done = tasks.filter(task => isTaskDone(task, state)).length;
  return { total, done, percent: total ? Math.round((done / total) * 100) : 100 };
}

export function getRemainingMinutes(tasks, state) {
  return tasks.reduce((total, task) => total + (isTaskDone(task, state) ? 0 : Number(task.estimateMinutes || 0)), 0);
}

export function shouldWarnForDaylight(task, now, sunset) {
  if (task.tag !== 'needs-daylight' || !sunset) return false;
  const millisecondsUntilSunset = sunset.getTime() - now.getTime();
  return millisecondsUntilSunset > 0 && millisecondsUntilSunset <= 2 * 60 * 60 * 1000;
}

export function getRecommendedTasks(plan, state, now = new Date(), sunset = null) {
  return getAllTasks(plan, state)
    .filter(task => !isTaskDone(task, state))
    .sort((a, b) => {
      const daylightA = a.tag === 'needs-daylight' && sunset && sunset > now ? 0 : 1;
      const daylightB = b.tag === 'needs-daylight' && sunset && sunset > now ? 0 : 1;
      return TAG_WEIGHT[a.tag] - TAG_WEIGHT[b.tag]
        || daylightA - daylightB
        || PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]
        || a.order - b.order;
    });
}

export function completeTask(state, task, completedAt = new Date()) {
  const next = mergeState(state, completedAt);
  const startedAt = next.started[task.key] ? new Date(next.started[task.key]) : new Date(next.sessionStartedAt);
  const durationMinutes = Math.max(1, Math.round((completedAt.getTime() - startedAt.getTime()) / 60000));
  next.completed[task.key] = { completedAt: completedAt.toISOString(), durationMinutes };
  delete next.notApplicable[task.key];
  return next;
}

export function addCustomTask(state, roomId, input) {
  const next = mergeState(state);
  const name = String(input.name || '').trim();
  if (!name) return next;
  const id = `custom-${slugify(name)}-${Date.now().toString(36)}`;
  const task = {
    id,
    name,
    priority: input.priority || 'normal',
    tag: input.tag || 'anytime',
    estimateMinutes: Number(input.estimateMinutes || 10)
  };
  next.customTasks[roomId] = [...(next.customTasks[roomId] || []), task];
  return next;
}

export function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'task';
}

function splitKeyValue(line) {
  const index = line.indexOf(':');
  if (index === -1) return [line, ''];
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}

function parseScalar(value) {
  if (value === '') return '';
  if (/^['"].*['"]$/.test(value)) return value.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}
