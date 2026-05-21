# Cleaning Coach

Cleaning Coach is a mobile-first home cleaning planner for a deep, phased apartment clean. It loads version-controlled room and task definitions from YAML, recommends the next best tasks, tracks progress locally, and works offline as a PWA.

## Features

- Rooms and tasks are defined in [`data/cleaning-plan.yml`](data/cleaning-plan.yml), including apartment size, priority, tag, and estimated minutes.
- Browser geolocation plus the public sunrise-sunset API estimates local sunrise and sunset. `needs-daylight` tasks warn when sunset is within two hours.
- Recommended ordering prioritizes set-and-forget work, time-sensitive tasks, daylight-dependent tasks, then priority and duration.
- Per-room and overall progress bars, completion timestamps, actual time tracking, undo, reset, room completion, and not-applicable handling.
- Custom tasks and drag-and-drop task ordering persist in `localStorage`.
- Dark/light mode follows the operating system preference, with a soft Apple-inspired mobile-first interface.
- PWA manifest and service worker provide offline support and cache refresh when `sw.js` changes.

## Run locally

This project intentionally uses plain HTML, CSS, and JavaScript without a build toolchain.

```bash
python3 -m http.server 8080
```

Open <http://localhost:8080>. A local server is required because the app fetches YAML at runtime.

## Test

```bash
npm test
```

The test suite uses Node's built-in test runner.

## Deployment

GitHub Pages deployment is configured in [`.github/workflows/pages.yml`](.github/workflows/pages.yml) for pushes to `main` and pull requests.
