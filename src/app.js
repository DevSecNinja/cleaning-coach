import { getRecommendedTasks, isSunsetWithin, makeCustomTask, normalizePlan, parseCleaningYaml, summarizeProgress } from './planner.js';

const STORAGE_KEY = 'cleaning-coach-state-v1';
const messages = [
  'Nice! One less thing weighing on your mind.',
  'That sparkle is earning its keep.',
  'Momentum unlocked — keep cruising.',
  'Future you is going to love this.',
];

let basePlan;
let plan;
let state = loadState();
let sun = {};
let deferredInstallPrompt;
const startedAt = Date.now();
let reminderIntervalId;

const $ = (selector) => document.querySelector(selector);

init();

async function init() {
  await loadPlan();
  bindGlobalEvents();
  await updateSunTimes();
  await renderBuildInfo();
  startReminderLoop();
  render();
  registerServiceWorker();
}

async function loadPlan() {
  const response = await fetch('data/cleaning-plan.yml', { cache: 'no-store' });
  if (!response.ok) throw new Error('Unable to load cleaning plan');
  basePlan = parseCleaningYaml(await response.text());
  plan = normalizePlan(basePlan, state);
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    const defaults = defaultState();
    return {
      ...defaults,
      ...saved,
      notificationSettings: {
        ...defaults.notificationSettings,
        ...(saved.notificationSettings || {}),
      },
    };
  } catch {
    return defaultState();
  }
}

function defaultState() {
  return {
    completed: {},
    skipped: {},
    customTasks: {},
    order: {},
    starts: {},
    goal: '',
    notificationSettings: {
      enabled: false,
      weekendLunch: true,
      homeOnly: false,
      homeLocation: null,
      lastLunchReminderDate: '',
    },
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  plan = normalizePlan(basePlan, state);
}

function bindGlobalEvents() {
  $('#goal-form').addEventListener('submit', (event) => {
    event.preventDefault();
    state.goal = $('#goal').value.trim();
    saveState();
    render();
  });
  $('#reset-progress').addEventListener('click', () => {
    if (!confirm('Start fresh and clear all progress? Custom tasks and your goal stay saved.')) return;
    state.completed = {};
    state.skipped = {};
    state.starts = {};
    saveState();
    render();
  });
  $('#refresh-sun').addEventListener('click', updateSunTimes);
  $('#notify-enabled').addEventListener('change', async (event) => {
    state.notificationSettings.enabled = event.target.checked;
    if (event.target.checked) await requestNotificationPermission();
    saveState();
    renderNotificationSettings();
  });
  $('#notify-weekend-lunch').addEventListener('change', (event) => {
    state.notificationSettings.weekendLunch = event.target.checked;
    saveState();
    renderNotificationSettings();
  });
  $('#notify-home-only').addEventListener('change', (event) => {
    state.notificationSettings.homeOnly = event.target.checked;
    saveState();
    renderNotificationSettings();
  });
  $('#set-home-location').addEventListener('click', saveHomeLocation);
  $('#install-app').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $('#install-app').hidden = true;
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $('#install-app').hidden = false;
  });
}

async function updateSunTimes() {
  $('#sun-title').textContent = 'Finding local sunrise & sunset…';
  try {
    const position = await getPosition();
    const { latitude, longitude } = position.coords;
    const response = await fetch(`https://api.sunrise-sunset.org/json?lat=${latitude}&lng=${longitude}&formatted=0`);
    const data = await response.json();
    sun = { sunrise: data.results.sunrise, sunset: data.results.sunset, source: 'local' };
  } catch {
    const today = new Date();
    const sunrise = new Date(today);
    sunrise.setHours(7, 30, 0, 0);
    const sunset = new Date(today);
    sunset.setHours(18, 0, 0, 0);
    sun = { sunrise: sunrise.toISOString(), sunset: sunset.toISOString(), source: 'fallback' };
  }
  renderSun();
  render();
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 7000, maximumAge: 3600000 });
  });
}

function render() {
  if (!plan) return;
  $('#goal').value = state.goal || '';
  $('#goal-display').hidden = !state.goal;
  $('#goal-display').textContent = state.goal ? `Reward waiting: ${state.goal}` : '';
  renderNotificationSettings();
  renderSun();
  renderOverall();
  renderRecommended();
  renderRooms();
  renderSummary();
}

function renderSun() {
  if (!sun.sunset) return;
  const sunset = new Date(sun.sunset);
  const sunrise = new Date(sun.sunrise);
  const label = sun.source === 'local' ? 'Local daylight' : 'Estimated daylight';
  $('#sun-title').textContent = `${label}: sunset ${formatTime(sunset)}`;
  $('#sun-detail').textContent = `Sunrise ${formatTime(sunrise)} · ${isSunsetWithin(sun.sunset, 2) ? 'Sunset is within 2 hours — do daylight tasks now.' : 'There is still daylight buffer for bright-space tasks.'}`;
}

function renderOverall() {
  const progress = summarizeProgress(plan, state);
  $('#overall-title').textContent = `${progress.done}/${progress.total} tasks complete`;
  $('#time-summary').textContent = `${formatDuration(progress.remainingMinutes)} estimated remaining · Apartment size: ${basePlan.apartment.size}`;
  $('#overall-progress').style.width = `${progress.percent}%`;
}

function renderRecommended() {
  const list = $('#recommended-list');
  list.innerHTML = '';
  const recommended = getRecommendedTasks(plan, state, sun).slice(0, 5);
  if (!recommended.length) {
    list.innerHTML = '<li>Everything actionable is done. Enjoy the reward.</li>';
    return;
  }
  for (const task of recommended) {
    const item = document.createElement('li');
    const quick = Number(task.estimateMinutes || 0) <= 12 ? ' · quick chore' : '';
    item.innerHTML = `<div><strong>${task.name}</strong><span>${task.roomName} · ${task.tag} · ${task.estimateMinutes} min${quick}</span></div><button class="secondary" type="button" data-recommended-done="${task.uid}">Done</button>`;
    list.append(item);
  }
  list.querySelectorAll('[data-recommended-done]').forEach((button) => button.addEventListener('click', () => toggleComplete(button.dataset.recommendedDone, true)));
}

function renderRooms() {
  const container = $('#rooms');
  const progress = summarizeProgress(plan, state);
  container.innerHTML = '';

  for (const room of plan.rooms) {
    const roomProgress = progress.rooms.find((item) => item.id === room.id);
    const card = document.createElement('article');
    card.className = `room-card ${roomProgress.percent === 100 ? 'complete' : ''}`;
    card.innerHTML = `
      <div class="room-heading">
        <div>
          <p class="eyebrow">${roomProgress.done}/${roomProgress.total} complete</p>
          <h2>${room.name}</h2>
        </div>
        <button class="room-complete-button" type="button" data-room-complete="${room.id}"${roomProgress.percent === 100 ? ' disabled' : ''}>Complete room</button>
      </div>
      <ul class="task-list" data-room-list="${room.id}"></ul>
      <form class="custom-task" data-add-task="${room.id}">
        <input name="name" required placeholder="Add custom task" />
        <input name="minutes" type="number" min="1" max="240" value="15" aria-label="Estimated minutes" />
        <button type="submit">Add</button>
      </form>
    `;
    const list = card.querySelector('.task-list');
    for (const task of room.tasks) list.append(renderTask(task));
    container.append(card);
  }
  bindRoomEvents(container);
}

function renderTask(task) {
  const done = state.completed[task.uid];
  const skipped = state.skipped[task.uid];
  const daylightWarning = task.tag === 'needs-daylight' && isSunsetWithin(sun.sunset, 2);
  const started = state.starts[task.uid];
  const elapsedMinutes = started ? Math.max(1, Math.round((Date.now() - new Date(started).getTime()) / 60000)) : null;
  const item = document.createElement('li');
  item.className = `task ${done ? 'done' : ''} ${skipped ? 'skipped' : ''} ${daylightWarning ? 'warning' : ''}`;
  item.draggable = true;
  item.dataset.taskId = task.uid;
  item.dataset.roomId = task.roomId;
  const actual = done?.actualMinutes ? ` · actual ${formatDuration(done.actualMinutes)}` : '';
  const lastDone = done?.completedAt ? ` · done ${new Date(done.completedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : '';
  item.innerHTML = `
    <div class="task-main">
      <label>
        <input type="checkbox" ${done ? 'checked' : ''} data-complete="${task.uid}" />
        <span><strong>${task.emoji || emojiForTask(task)} ${task.name}</strong><small>${task.priority} · ${task.tag} · ${task.estimateMinutes} min${actual}${lastDone}</small></span>
      </label>
      ${started && !done ? `<p class="task-runtime">⏱ ${formatDuration(elapsedMinutes)} elapsed</p>` : ''}
      ${daylightWarning ? '<p class="warning-copy">Sunset is close — do this while light is available.</p>' : ''}
    </div>
    <div class="task-actions">
      <button class="secondary" type="button" data-start="${task.uid}">${started ? 'Restart' : 'Start'}</button>
      ${!done ? `<button class="secondary" type="button" data-done="${task.uid}">Done</button>` : ''}
      <button class="secondary" type="button" data-skip="${task.uid}">${skipped ? 'Applicable' : 'N/A'}</button>
      ${done ? `<button class="secondary" type="button" data-undo="${task.uid}">Undo</button>` : ''}
    </div>
  `;
  return item;
}

function bindRoomEvents(container) {
  container.querySelectorAll('[data-complete]').forEach((input) => input.addEventListener('change', () => toggleComplete(input.dataset.complete, input.checked)));
  container.querySelectorAll('[data-undo]').forEach((button) => button.addEventListener('click', () => toggleComplete(button.dataset.undo, false)));
  container.querySelectorAll('[data-start]').forEach((button) => button.addEventListener('click', () => {
    state.starts[button.dataset.start] = new Date().toISOString();
    saveState();
    render();
  }));
  container.querySelectorAll('[data-done]').forEach((button) => button.addEventListener('click', () => toggleComplete(button.dataset.done, true)));
  container.querySelectorAll('[data-skip]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.skip;
    state.skipped[id] ? delete state.skipped[id] : state.skipped[id] = new Date().toISOString();
    saveState();
    render();
  }));
  container.querySelectorAll('[data-room-complete]').forEach((button) => button.addEventListener('click', () => completeRoom(button.dataset.roomComplete)));
  container.querySelectorAll('[data-add-task]').forEach((form) => form.addEventListener('submit', (event) => {
    event.preventDefault();
    const task = makeCustomTask(form.dataset.addTask, form.name.value, form.minutes.value);
    state.customTasks[form.dataset.addTask] = [...(state.customTasks[form.dataset.addTask] || []), task];
    saveState();
    render();
  }));
  bindDragAndDrop(container);
}

function bindDragAndDrop(container) {
  let dragged;
  container.querySelectorAll('.task').forEach((task) => {
    task.addEventListener('dragstart', () => { dragged = task; });
    task.addEventListener('dragover', (event) => event.preventDefault());
    task.addEventListener('drop', (event) => {
      event.preventDefault();
      if (!dragged || dragged.dataset.roomId !== task.dataset.roomId) return;
      task.parentElement.insertBefore(dragged, task);
      state.order[task.dataset.roomId] = [...task.parentElement.querySelectorAll('.task')].map((item) => item.dataset.taskId);
      saveState();
      render();
    });
  });
}

function toggleComplete(uid, isComplete) {
  if (isComplete) {
    const started = state.starts[uid] ? new Date(state.starts[uid]).getTime() : startedAt;
    state.completed[uid] = { completedAt: new Date().toISOString(), actualMinutes: Math.max(1, Math.round((Date.now() - started) / 60000)) };
    delete state.skipped[uid];
    showToast(messageFor(uid));
  } else {
    delete state.completed[uid];
  }
  saveState();
  render();
}

function completeRoom(roomId) {
  const room = plan.rooms.find((item) => item.id === roomId);
  room.tasks.filter((task) => !state.skipped[task.uid]).forEach((task) => {
    state.completed[task.uid] ||= { completedAt: new Date().toISOString(), actualMinutes: Number(task.estimateMinutes || 1) };
  });
  showToast(`${room.name} done — ${room.id === 'kitchen' ? 'the hardest room is behind you!' : 'that room is sparkling.'}`);
  saveState();
  render();
}

function messageFor(uid) {
  const task = getTask(uid);
  const room = plan.rooms.find((item) => item.id === task.roomId);
  const remaining = room.tasks.filter((item) => !state.completed[item.uid] && !state.skipped[item.uid] && item.uid !== uid).length;
  if (remaining === 0) return `${room.name} done — ${room.id === 'kitchen' ? 'the hardest room is behind you!' : 'beautiful finish!'}`;
  return messages[Math.floor(Math.random() * messages.length)];
}

function getTask(uid) {
  return plan.rooms.flatMap((room) => room.tasks).find((task) => task.uid === uid);
}

function renderSummary() {
  const progress = summarizeProgress(plan, state);
  const summary = $('#summary');
  if (progress.total && progress.done === progress.total) {
    summary.hidden = false;
    const totalActual = Object.values(state.completed).reduce((sum, item) => sum + (item.actualMinutes || 0), 0);
    summary.querySelector('#summary-copy').textContent = `${progress.done} tasks across ${plan.rooms.length} rooms completed in about ${formatDuration(totalActual)}. ${state.goal ? `Reward time: ${state.goal}` : 'Reward time!'}`;
    launchConfetti();
  } else {
    summary.hidden = true;
  }
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 3200);
}

function launchConfetti() {
  if (document.querySelector('.confetti-piece')) return;
  for (let i = 0; i < 24; i += 1) {
    const piece = $('#confetti-piece').content.firstElementChild.cloneNode();
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.animationDelay = `${Math.random()}s`;
    document.body.append(piece);
    setTimeout(() => piece.remove(), 3500);
  }
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours ? `${hours}h ${mins}m` : `${mins}m`;
}

function emojiForTask(task) {
  if (task.roomId === 'kitchen') return '🍽️';
  if (task.roomId === 'bathroom' || task.roomId === 'toilet-wc') return '🧼';
  if (task.roomId === 'bedroom') return '🛏️';
  if (task.roomId === 'laundry-room') return '🧺';
  if (task.name.toLowerCase().includes('floor')) return '🧹';
  if (task.name.toLowerCase().includes('mirror')) return '🪞';
  return '✨';
}

function renderNotificationSettings() {
  const settings = state.notificationSettings;
  $('#notify-enabled').checked = settings.enabled;
  $('#notify-weekend-lunch').checked = settings.weekendLunch;
  $('#notify-home-only').checked = settings.homeOnly;
  $('#notify-status').textContent = settings.homeLocation
    ? `Home location saved${settings.homeOnly ? ' · reminders only when home' : ''}.`
    : 'No home location saved yet.';
}

async function saveHomeLocation() {
  try {
    const position = await getPosition();
    state.notificationSettings.homeLocation = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    saveState();
    renderNotificationSettings();
    showToast('Home location saved for reminder filtering.');
  } catch {
    showToast('Unable to save home location right now.');
  }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') await Notification.requestPermission();
}

function startReminderLoop() {
  if (reminderIntervalId) clearInterval(reminderIntervalId);
  reminderIntervalId = setInterval(() => { maybeSendWeekendLunchReminder(); }, 60000);
  maybeSendWeekendLunchReminder();
}

async function maybeSendWeekendLunchReminder(now = new Date()) {
  const settings = state.notificationSettings;
  if (!settings.enabled || !settings.weekendLunch) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (![0, 6].includes(now.getDay())) return;
  const hour = now.getHours();
  if (hour < 11 || hour > 14) return;
  const today = now.toISOString().slice(0, 10);
  if (settings.lastLunchReminderDate === today) return;
  if (settings.homeOnly && !(await isAtHome())) return;

  const quickTask = getRecommendedTasks(plan, state, sun, now).find((task) => Number(task.estimateMinutes || 0) <= 12);
  if (!quickTask) return;

  settings.lastLunchReminderDate = today;
  saveState();
  new Notification('Quick lunch chore?', { body: `${quickTask.name} · ${quickTask.estimateMinutes} min` });
}

async function isAtHome() {
  const home = state.notificationSettings.homeLocation;
  if (!home) return false;
  try {
    const position = await getPosition();
    const distance = distanceMeters(home.latitude, home.longitude, position.coords.latitude, position.coords.longitude);
    return distance <= 300;
  } catch {
    return false;
  }
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function renderBuildInfo() {
  const output = $('#build-ref');
  if (!output) return;
  output.textContent = 'Build: loading…';
  try {
    const response = await fetch('sw.js', { cache: 'no-store' });
    const source = await response.text();
    const build = source.match(/CACHE_VERSION = '([^']+)'/)?.[1] || 'cleaning-coach-local';
    output.textContent = `Build: ${build.replace(/^cleaning-coach-/, '')}`;
  } catch {
    output.textContent = 'Build: unavailable';
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
}
