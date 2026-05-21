import {
  STORAGE_KEY,
  addCustomTask,
  completeTask,
  createInitialState,
  getAllTasks,
  getProgress,
  getRecommendedTasks,
  getRemainingMinutes,
  getRoomTasks,
  isTaskDone,
  mergeState,
  parseCleaningPlanYaml,
  shouldWarnForDaylight
} from './planner.js';

const elements = {
  app: document.querySelector('#app'),
  clock: document.querySelector('#clock'),
  sun: document.querySelector('#sun'),
  locationStatus: document.querySelector('#location-status'),
  goalForm: document.querySelector('#goal-form'),
  goalInput: document.querySelector('#goal-input'),
  goalDisplay: document.querySelector('#goal-display'),
  overallProgress: document.querySelector('#overall-progress'),
  overallProgressText: document.querySelector('#overall-progress-text'),
  remainingTime: document.querySelector('#remaining-time'),
  recommendations: document.querySelector('#recommendations'),
  rooms: document.querySelector('#rooms'),
  summary: document.querySelector('#summary'),
  reset: document.querySelector('#reset-progress'),
  confetti: document.querySelector('#confetti'),
  toast: document.querySelector('#toast')
};

let plan;
let state = loadState();
let sun = { sunrise: null, sunset: null };
let draggedTask = null;

init();

async function init() {
  try {
    const response = await fetch('./data/cleaning-plan.yaml', { cache: 'no-cache' });
    plan = parseCleaningPlanYaml(await response.text());
    elements.goalInput.value = state.goal || '';
    render();
    bindGlobalEvents();
    await updateSunTimes();
    updateClock();
    setInterval(updateClock, 30000);
    registerServiceWorker();
  } catch (error) {
    elements.app.innerHTML = `<p class="error">Could not load the cleaning plan. ${escapeHtml(error.message)}</p>`;
  }
}

function bindGlobalEvents() {
  elements.goalForm.addEventListener('submit', event => {
    event.preventDefault();
    state.goal = elements.goalInput.value.trim();
    persist();
    render();
  });

  elements.reset.addEventListener('click', () => {
    if (!confirm('Reset all progress and custom tasks?')) return;
    state = createInitialState();
    persist();
    render();
  });
}

function render() {
  const allTasks = getAllTasks(plan, state);
  const overall = getProgress(allTasks, state);
  const remaining = getRemainingMinutes(allTasks, state);

  elements.goalDisplay.textContent = state.goal ? `End goal: ${state.goal}` : 'Set a reward to keep future-you motivated.';
  elements.overallProgress.value = overall.percent;
  elements.overallProgressText.textContent = `${overall.done}/${overall.total} tasks complete (${overall.percent}%)`;
  elements.remainingTime.textContent = `${formatMinutes(remaining)} remaining`;
  renderRecommendations();
  renderRooms();
  renderSummary(overall, allTasks);

  if (overall.total > 0 && overall.done === overall.total) launchConfetti();
}

function renderRecommendations() {
  const now = new Date();
  const recommended = getRecommendedTasks(plan, state, now, sun.sunset).slice(0, 6);
  elements.recommendations.innerHTML = recommended.length
    ? recommended.map(task => `<li><strong>${escapeHtml(task.name)}</strong><span>${escapeHtml(task.roomName)} · ${escapeHtml(labelFor(task.tag))} · ${task.estimateMinutes} min</span></li>`).join('')
    : '<li><strong>All clear!</strong><span>Every task is done or marked not applicable.</span></li>';
}

function renderRooms() {
  elements.rooms.innerHTML = plan.rooms.map(room => {
    const tasks = getRoomTasks(plan, room, state);
    const progress = getProgress(tasks, state);
    return `
      <section class="room-card ${progress.total && progress.done === progress.total ? 'complete' : ''}" data-room-id="${escapeHtml(room.id)}">
        <div class="room-card__header">
          <div>
            <p class="eyebrow">${progress.done}/${progress.total} done · ${formatMinutes(getRemainingMinutes(tasks, state))} left</p>
            <h2>${escapeHtml(room.name)}</h2>
          </div>
          <button class="secondary" data-action="complete-room" data-room-id="${escapeHtml(room.id)}">Complete room</button>
        </div>
        <progress value="${progress.percent}" max="100"></progress>
        <ul class="task-list">
          ${tasks.map(task => renderTask(task)).join('')}
        </ul>
        <form class="custom-task" data-room-id="${escapeHtml(room.id)}">
          <label>Add task<input name="name" placeholder="e.g. Window sill" required></label>
          <label>Minutes<input name="estimateMinutes" type="number" min="1" value="10"></label>
          <label>Priority<select name="priority"><option value="urgent">Urgent</option><option value="normal" selected>Normal</option><option value="low">Low</option></select></label>
          <label>Tag<select name="tag"><option value="anytime">Anytime</option><option value="needs-daylight">Needs daylight</option><option value="time-sensitive">Time-sensitive</option><option value="set-and-forget">Set and forget</option></select></label>
          <button type="submit">Add</button>
        </form>
      </section>`;
  }).join('');

  elements.rooms.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', handleAction));
  elements.rooms.querySelectorAll('.custom-task').forEach(form => form.addEventListener('submit', handleCustomTask));
  elements.rooms.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragover', event => event.preventDefault());
    card.addEventListener('drop', handleDrop);
  });
}

function renderTask(task) {
  const completed = state.completed[task.key];
  const skipped = state.notApplicable[task.key];
  const started = state.started[task.key];
  const daylightWarning = shouldWarnForDaylight(task, new Date(), sun.sunset);
  return `
    <li class="task-card ${completed ? 'done' : ''} ${skipped ? 'skipped' : ''}" draggable="true" data-task-key="${escapeHtml(task.key)}" data-room-id="${escapeHtml(task.roomId)}">
      <div class="task-card__main">
        <button class="check" data-action="toggle-task" data-task-key="${escapeHtml(task.key)}" aria-label="${completed ? 'Undo' : 'Complete'} ${escapeHtml(task.name)}">${completed ? '✓' : ''}</button>
        <div>
          <h3>${escapeHtml(task.name)}</h3>
          <p>${escapeHtml(task.roomName)} · ${task.estimateMinutes} min ${task.custom ? '· custom' : ''}</p>
          ${completed ? `<p class="log">Completed ${formatDateTime(completed.completedAt)} · ${completed.durationMinutes} min tracked</p>` : ''}
          ${started && !completed ? `<p class="log">Timer started ${formatDateTime(started)}</p>` : ''}
          ${skipped ? `<p class="log">Marked not applicable ${formatDateTime(skipped)}</p>` : ''}
          ${daylightWarning ? '<p class="warning">Sunset is within 2 hours — do this while there is still daylight.</p>' : ''}
        </div>
      </div>
      <div class="task-card__meta">
        <span class="pill priority-${escapeHtml(task.priority)}">${escapeHtml(task.priority)}</span>
        <span class="pill">${escapeHtml(labelFor(task.tag))}</span>
        <button class="ghost" data-action="start-task" data-task-key="${escapeHtml(task.key)}">Start</button>
        <button class="ghost" data-action="toggle-na" data-task-key="${escapeHtml(task.key)}">${skipped ? 'Undo N/A' : 'N/A'}</button>
      </div>
    </li>`;
}
function renderSummary(overall, allTasks) {
  const completedEntries = allTasks.map(task => state.completed[task.key]).filter(Boolean);
  const totalTracked = completedEntries.reduce((total, entry) => total + Number(entry.durationMinutes || 0), 0);
  const completeRooms = plan.rooms.filter(room => {
    const tasks = getRoomTasks(plan, room, state);
    const progress = getProgress(tasks, state);
    return progress.total && progress.done === progress.total;
  }).length;

  elements.summary.innerHTML = `
    <h2>Session summary</h2>
    <dl>
      <div><dt>Total tracked time</dt><dd>${formatMinutes(totalTracked)}</dd></div>
      <div><dt>Rooms completed</dt><dd>${completeRooms}/${plan.rooms.length}</dd></div>
      <div><dt>Tasks done</dt><dd>${overall.done}/${overall.total}</dd></div>
    </dl>`;
}

function handleAction(event) {
  const action = event.currentTarget.dataset.action;
  const taskKey = event.currentTarget.dataset.taskKey;
  const roomId = event.currentTarget.dataset.roomId;
  const task = taskKey ? getAllTasks(plan, state).find(item => item.key === taskKey) : null;

  if (action === 'toggle-task' && task) {
    if (state.completed[task.key]) {
      delete state.completed[task.key];
    } else {
      state = completeTask(state, task);
      showToast(`${task.roomName}: ${task.name} complete — nice!`);
      showRoomEncouragement(task.roomId);
    }
  }

  if (action === 'start-task' && task) {
    state.started[task.key] = new Date().toISOString();
    showToast(`Timer started for ${task.name}.`);
  }

  if (action === 'toggle-na' && task) {
    if (state.notApplicable[task.key]) {
      delete state.notApplicable[task.key];
    } else {
      state.notApplicable[task.key] = new Date().toISOString();
      delete state.completed[task.key];
    }
  }

  if (action === 'complete-room') {
    const room = plan.rooms.find(item => item.id === roomId);
    for (const roomTask of getRoomTasks(plan, room, state)) {
      if (!isTaskDone(roomTask, state)) state = completeTask(state, roomTask);
    }
    showToast(room.encouragement || `${room.name} done — great work!`);
  }

  persist();
  render();
}

function handleCustomTask(event) {
  event.preventDefault();
  const form = event.currentTarget;
  state = addCustomTask(state, form.dataset.roomId, Object.fromEntries(new FormData(form)));
  form.reset();
  persist();
  render();
}

function handleDragStart(event) {
  draggedTask = {
    key: event.currentTarget.dataset.taskKey,
    roomId: event.currentTarget.dataset.roomId
  };
}

function handleDrop(event) {
  event.preventDefault();
  const target = event.currentTarget;
  if (!draggedTask || draggedTask.roomId !== target.dataset.roomId) return;
  const room = plan.rooms.find(item => item.id === draggedTask.roomId);
  const keys = getRoomTasks(plan, room, state).map(task => task.key).filter(key => key !== draggedTask.key);
  const targetIndex = keys.indexOf(target.dataset.taskKey);
  keys.splice(targetIndex, 0, draggedTask.key);
  state.order[room.id] = keys;
  draggedTask = null;
  persist();
  render();
}

async function updateSunTimes() {
  if (!navigator.geolocation) {
    elements.locationStatus.textContent = 'Geolocation unavailable; daylight warnings use your clock only.';
    return;
  }

  navigator.geolocation.getCurrentPosition(async position => {
    try {
      const { latitude, longitude } = position.coords;
      const response = await fetch(`https://api.sunrise-sunset.org/json?lat=${latitude}&lng=${longitude}&formatted=0`);
      const data = await response.json();
      sun = {
        sunrise: new Date(data.results.sunrise),
        sunset: new Date(data.results.sunset)
      };
      elements.locationStatus.textContent = 'Sunrise and sunset are based on your current location.';
      updateClock();
      render();
    } catch {
      elements.locationStatus.textContent = 'Could not load public sunrise/sunset data; try again later.';
    }
  }, () => {
    elements.locationStatus.textContent = 'Allow location access to calculate sunrise and sunset warnings.';
  }, { maximumAge: 60 * 60 * 1000, timeout: 8000 });
}

function updateClock() {
  const now = new Date();
  elements.clock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  elements.sun.textContent = sun.sunset
    ? `Sunrise ${formatTime(sun.sunrise)} · Sunset ${formatTime(sun.sunset)}`
    : 'Sunrise/sunset pending';
}

function showRoomEncouragement(roomId) {
  const room = plan.rooms.find(item => item.id === roomId);
  const tasks = getRoomTasks(plan, room, state);
  const progress = getProgress(tasks, state);
  if (progress.total && progress.done === progress.total) showToast(room.encouragement || `${room.name} complete!`);
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => { elements.toast.hidden = true; }, 3500);
}

function launchConfetti() {
  if (elements.confetti.dataset.active) return;
  elements.confetti.dataset.active = 'true';
  elements.confetti.innerHTML = Array.from({ length: 28 }, (_, index) => `<span style="--x:${index % 7};--d:${index * 70}ms">✨</span>`).join('');
  setTimeout(() => { elements.confetti.innerHTML = ''; delete elements.confetti.dataset.active; }, 3200);
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  try {
    return mergeState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return createInitialState();
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
}

function formatMinutes(minutes) {
  const value = Number(minutes || 0);
  if (value < 60) return `${value} min`;
  return `${Math.floor(value / 60)}h ${value % 60}m`;
}

function formatTime(date) {
  return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
}

function formatDateTime(value) {
  return new Date(value).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
}

function labelFor(value) {
  return String(value).replaceAll('-', ' ');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
