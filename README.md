# Cleaning Coach

Cleaning Coach is a mobile-first, dependency-light PWA for planning and tracking a phased home deep clean. Rooms and starter tasks are stored in `data/cleaning-plan.yaml` so the cleaning plan can be version-controlled and reused.

## Features

- Room-based checklist with priorities, tags, estimates, and apartment-size metadata loaded from YAML.
- Recommended task order that starts set-and-forget work early, prioritizes time-sensitive chores, and keeps daylight tasks visible before sunset.
- Browser geolocation plus the public Sunrise-Sunset API for local sunrise/sunset display and daylight warnings.
- Local progress tracking, completion timestamps, task timers, room and overall progress bars, reset, undo, and not-applicable states.
- Custom tasks, drag-and-drop reordering per room, motivational goal text, room encouragement, confetti, and end-of-session summary.
- Offline-capable PWA with service worker cache busting during GitHub Pages deployment.

## Development

This project intentionally uses plain HTML, CSS, and JavaScript with Node's built-in test runner.

```bash
npm test
python3 -m http.server 4173
```

Then open <http://localhost:4173>.

## Deployment

`.github/workflows/pages.yml` builds a static Pages artifact on pushes to `main` and pull requests. During the Pages build, the service worker build version is replaced with the current commit SHA so clients refresh cached assets on every deployed commit.
