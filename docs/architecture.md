# Architecture

Cleaning Coach is a static PWA with no runtime backend and no heavy build step.

## Data flow

1. `index.html` loads `src/app.js` as an ES module.
2. `src/app.js` fetches `data/cleaning-plan.yaml` at runtime and parses it with the small parser in `src/planner.js`.
3. The normalized plan is combined with browser-local state from `localStorage`.
4. The UI is rendered from that combined state and persisted after every user action.

## Core modules

- `data/cleaning-plan.yaml`: Apartment metadata, rooms, task priorities, task tags, and estimates.
- `src/planner.js`: Pure planning utilities for YAML parsing, progress, remaining time, daylight warnings, recommended ordering, task completion, and custom task creation.
- `src/app.js`: DOM rendering, geolocation, Sunrise-Sunset API integration, local persistence, drag-and-drop, and service worker registration.
- `sw.js`: Offline cache with a build-version placeholder replaced by the Pages workflow.

## Storage

All mutable user data is stored under `cleaning-coach-state-v1` in `localStorage`. Resetting progress clears this state by replacing it with a fresh session.

## Deployment and cache busting

The GitHub Pages workflow copies static files to `_site`, replaces `__BUILD_VERSION__` in `sw.js` with `GITHUB_SHA`, uploads the artifact, and deploys it on `main`. Pull requests still build and upload a Pages artifact for validation.
