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

const $ = (selector) => document.querySelector(selector);

init();

async function init() {
  await loadPlan();
  bindGlobalEvents();
  await updateSunTimes();
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
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState();
  } catch {
    return defaultState();
  }
}

function defaultState() {
  return { completed: {}, skipped: {}, customTasks: {}, order: {}, starts: {}, goal: '' };
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
    if (!navigator.geolocation) reject(new Error('Geolocation unavailable'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 7000, maximumAge: 3600000 });
  });
}

function render() {
  if (!plan) return;
  $('#goal').value = state.goal || '';
  $('#goal-display').hidden = !state.goal;
  $('#goal-display').textContent = state.goal ? `Reward waiting: ${state.goal}` : '';
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
    item.innerHTML = `<strong>${task.name}</strong><span>${task.roomName} · ${task.tag} · ${task.estimateMinutes} min</span>`;
    list.append(item);
  }
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
        <button class="secondary" type="button" data-room-complete="${room.id}">Complete room</button>
      </div>
      <div class="progress-shell"><span style="width:${roomProgress.percent}%"></span></div>
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
        <span><strong>${task.name}</strong><small>${task.priority} · ${task.tag} · ${task.estimateMinutes} min${actual}${lastDone}</small></span>
      </label>
      ${daylightWarning ? '<p class="warning-copy">Sunset is close — do this while light is available.</p>' : ''}
    </div>
    <div class="task-actions">
      <button class="secondary" type="button" data-start="${task.uid}">${state.starts[task.uid] ? 'Started' : 'Start'}</button>
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

function registerServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
}
