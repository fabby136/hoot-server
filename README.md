# hoot-server

Tiny Express backend for the Hoot voice-alarm app.

- `POST /api/shares` (multipart: `audio`, `from`, `label`, `unlockAt` ISO) → `{ id, url }`
- `GET /api/shares/:id` → metadata (label hidden until unlock)
- `GET /api/shares/:id/audio` → the clip, or **423 Locked** (+ `Retry-After`) before `unlockAt`
- `GET /s/:id` → web prototype page; `GET /healthz` → health check
- CORS open (`*`); listens on `$PORT` at `0.0.0.0`; clips stored in `$DATA_DIR` (default `./data`)

Run locally: `npm install && npm start` (port 5173).

## Render (free tier)
Uses `render.yaml` (or: Build `npm install`, Start `npm start`, Health check `/healthz`).
**Demo caveats:** free instances have an *ephemeral disk*, so uploaded clips vanish on every
restart/redeploy/spin-down, and the service sleeps after ~15 min idle (first request takes ~30–60 s).
For durable clips, point storage at a persistent disk (paid) or an object store.
