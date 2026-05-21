# Architecture

Cleaning Coach is a static PWA with no build step.

## Runtime flow

1. `index.html` loads `src/app.js` as an ES module.
2. `src/app.js` fetches `data/cleaning-plan.yml` with `cache: "no-store"` so repository task updates are visible quickly.
3. `src/planner.js` parses the repository YAML, normalizes built-in and custom tasks, calculates progress, and creates recommended task order.
4. UI state such as completions, actual times, custom tasks, not-applicable tasks, reordering, and the motivational goal is stored in `localStorage`.
5. Daylight data is requested from browser geolocation and `api.sunrise-sunset.org`; if permission or network fails, the app falls back to same-day estimated sunrise and sunset.
6. `sw.js` caches the app shell and YAML for offline use. Updating `CACHE_VERSION` busts old caches after deploys.

## Data model

The YAML file contains an `apartment` section and a `rooms` list. Rooms contain task entries with:

- `id`
- `name`
- `priority`: `urgent`, `normal`, or `low`
- `tag`: `needs-daylight`, `time-sensitive`, `set-and-forget`, or `anytime`
- `estimateMinutes`

Custom browser tasks use the same task shape and are merged at runtime.

## Testing

`npm test` runs Node's built-in test runner against planner logic and static PWA wiring.
