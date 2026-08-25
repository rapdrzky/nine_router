# Nine Router

![License](https://img.shields.io/badge/license-MIT-blue)
![Railway](https://img.shields.io/badge/deploy-Railway-purple)
![Docker](https://img.shields.io/badge/runtime-Docker-blue)
![Version](https://img.shields.io/badge/9router-v0.5.55-green)

Nine Router deploys [9Router](https://github.com/decolua/9router) to [Railway](https://railway.app) with Docker. 9Router is a free AI router and token saver — it connects Claude Code, Codex, Cursor, Cline, Copilot, and other CLI tools to 40+ AI providers with automatic fallback and 20-40% token savings via RTK.

## Features

- One-click deploy to Railway from this repository.
- Image version is pinned (`v0.5.55`), so builds are reproducible.
- Health check on `/dashboard` with a 30-second timeout.
- Automatic restart on failure (up to 3 retries).
- Dashboard for provider setup, quota tracking, and API keys.
- OpenAI-compatible API at `/v1` for any CLI tool or client.

## Deploy to Railway

1. Fork or push this repository to GitHub.
2. In Railway, create a new project → **Deploy from GitHub repo**.
3. Railway detects the `Dockerfile` and `railway.json` automatically.
4. Set environment variables on the service (Variables tab):

   | Variable | Default | Description |
   |---|---|---|
   | `INITIAL_PASSWORD` | `123456` | First-login password for the dashboard. Change it after signing in. |
   | `PORT` | set by Railway | Do not override. Railway injects it automatically. |

5. Deploy finishes → open the Railway domain → dashboard is at `/dashboard`.

## Configuration

| File | Purpose |
|---|---|
| `Dockerfile` | Base image, pinned to a specific 9Router release |
| `railway.json` | Railway build and deploy settings |
| `.env` | Local variables for manual `docker run` only; Railway ignores it |

### railway.json

```json
{
  "build": { "dockerfilePath": "Dockerfile" },
  "deploy": {
    "healthcheckPath": "/dashboard",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

## Upgrading

Change the image tag in the `Dockerfile`, then redeploy:

```dockerfile
FROM decolua/9router:0.5.55
```

Release list: https://github.com/decolua/9router/releases

## Running Locally (Optional)

Requires Docker.

```bash
docker build -t nine_router .
docker run -p 20128:20128 --env-file .env nine_router
```

The container listens on the port from `.env` (`PORT=20128` by default), so keep both sides of `-p` in sync if you change it.

Dashboard: http://localhost:20128/dashboard
API: http://localhost:20128/v1

## Usage

After signing in to the dashboard:

1. Connect a provider — Kiro AI (~50 free credits/month), OpenCode Free (no auth), or any of the 40+ API key providers.
2. Copy an API key from the dashboard.
3. Point your CLI tool at the endpoint:

   | Setting | Value |
   |---|---|
   | Endpoint | `https://<your-railway-domain>/v1` |
   | API Key | copied from the dashboard |
   | Model | e.g. `kr/claude-sonnet-4.5` |

Example request:

```http
POST /v1/chat/completions
Authorization: Bearer <your-api-key>
Content-Type: application/json

{
  "model": "kr/claude-sonnet-4.5",
  "messages": [
    { "role": "user", "content": "Write a function to..." }
  ],
  "stream": true
}
```

## Security

The dashboard is protected by a single password, so anyone who knows the Railway domain and password can use your configured providers. Use a strong `INITIAL_PASSWORD` in production and keep the domain private if needed. All provider credentials are stored inside 9Router itself; this repository contains none.

## Troubleshooting

| Problem | Fix |
|---|---|
| Deploy fails health check | Confirm `/dashboard` returns 200; increase `healthcheckTimeout` on slow builds |
| Dashboard opens on the wrong port | Let Railway set `PORT`; do not define it manually |
| First login not working | Check `INITIAL_PASSWORD`; unset means fallback password `123456` |
| Provider quota exhausted | Add combo fallback in the dashboard (Subscription → Cheap → Free) |

More help: https://github.com/decolua/9router#troubleshooting

## Design Decisions

Short version of the reasoning:

- **A thin wrapper repo** because 9Router ships its own Docker image; there is nothing to build from source here.
- **A pinned image tag** instead of `:latest` so upstream releases never change production behavior without an explicit commit.
- **Railway** because it builds from a one-line Dockerfile and handles TLS, domains, and restarts out of the box.
- **Health check on `/dashboard`** because it is a stable page that responds 200 without authentication.

## Contributing

Fork the repo, branch from `main`, and keep changes focused. When bumping the 9Router version, update the tag in the `Dockerfile` and this README together.

## License

[MIT LICENSE](https://github.com/decolua/9router)