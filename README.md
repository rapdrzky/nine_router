# Nine Router

![License](https://img.shields.io/badge/license-MIT-blue)
![Railway](https://img.shields.io/badge/deploy-Railway-purple)
![Docker](https://img.shields.io/badge/runtime-Docker-blue)
![Version](https://img.shields.io/badge/9router-v0.5.95-green)

Thin wrapper that deploys [9Router](https://github.com/decolua/9router) to [Railway](https://railway.app) on top of its own Docker image. There is no source build here — the image is pinned by tag and digest, and one Node script patches the installed build at container startup before the server boots.

9Router is a free AI router and token saver: it connects Claude Code, Codex, Cursor, Cline, Copilot and other CLI tools to 40+ providers with automatic fallback and 20-40% token savings via RTK.

## Features

- Image pinned to `v0.5.91` plus an immutable manifest digest, so builds are reproducible and an upstream tag rewrite cannot change production behavior.
- Startup patch forces `stream: true` on opencode requests. The free tier rejects non-streaming requests (`FreeTierError`), so this is required.
- Startup patch registers `union-alpha-free` as an alias of `union-alpha`: added to the messages-format routing set, the provider catalog, and the capability map (vision, reasoning, 262k context, 131k output). The alias is translated back to `union-alpha` inside `transformRequest`.
- Startup patch injects the `bash`, `glob`, `grep` and `read` tool definitions into every opencode request.
- Dashboard for provider setup, quota tracking and API keys.
- OpenAI-compatible API at `/v1` for any CLI tool or client.
- Healthcheck on `/api/health`, the only unauthenticated route. `/v1/models` needs an API key, so a probe there returns `401` and Railway restarts the service in a loop.

## Deploy to Railway

1. Fork or push this repository to GitHub.
2. In Railway, create a project and choose **Deploy from GitHub repo**.
3. Railway picks up `Dockerfile` and `railway.json` automatically.
4. Set environment variables on the service (Variables tab):

   | Variable | Default | Description |
   |---|---|---|
   | `INITIAL_PASSWORD` | `123456` | First-login password for the dashboard. Change it after signing in. |
   | `PORT` | injected by Railway | Do not set it manually. Railway injects the port the container must bind to. |

5. When the deploy finishes, open the Railway domain. The dashboard lives at `/dashboard`.

## Repository Layout

| File | Purpose |
|---|---|
| `Dockerfile` | Pinned base image; copies the patch script into `/app` and runs it as the container entrypoint. |
| `railway.json` | Railway build and deploy settings, including the healthcheck path. |
| `patch_opencode_nine_router.js` | Startup entrypoint. With `--start` it applies the opencode patch and then launches 9Router; without arguments it dry-runs the patch and prints JSON. |
| `.env` | Local-only defaults (`PORT`, `INITIAL_PASSWORD`) used by `docker run --env-file`. Never commit production secrets. |

## Dockerfile

```dockerfile
FROM decolua/9router:0.5.91@sha256:efc6e88c963ddb035f8da26a74e156b927863cd05625b47f3587972bc865bd25

COPY patch_opencode_nine_router.js /app/

CMD ["node", "/app/patch_opencode_nine_router.js", "--start"]
```

## Opencode patch

`patch_opencode_nine_router.js` runs before the server starts and rewrites the installed 9Router build in place:

- Scans `server/**/*.js` for the provider, catalog and capability anchors instead of hard-coding chunk file names, so an upstream chunk renumbering does not silently skip a copy of the module.
- Adds `union-alpha-free` to the routing set, the provider model list and the capability map. It deliberately stays out of the responses-format set: `OpenCodeExecutor.buildUrl()` tests `isResponsesModel()` before `isMessagesModel()`, so a responses classification would send this claude-format model to `/zen/v1/responses`.
- Rewrites the `opencode` `transformRequest` body so `union-alpha-free` maps to `union-alpha`, forces `stream: true`, and calls `_injectQ4(b)`.
- Installs the `_injectQ4` helper, which fills `body.tools` with the `bash`, `glob`, `grep` and `read` definitions when absent and never overwrites a tool the client already sent.
- Writes are two-phase: every file is patched and validated in memory first, and only written (temp file plus rename, so a crash cannot leave a half-written chunk) once all anchors are confirmed present.
- Re-running is safe. Writes converge: a stale injected block is rewritten in place rather than duplicated.

The patch fails fast. If an anchor is missing, or the self-test throws, the container exits with `ERROR: opencode patch failed: …` or `ERROR: opencode patch self-test failed: …` in the Railway logs instead of starting silently unpatched.

A healthy start logs:

```
opencode patch: provider=… catalog=… capabilities=… (N chunk(s) written) 9router=<version> files=<paths>
```

The self-test covers the tool helper against empty bodies, OpenAI-style tools, Anthropic-style tools and junk entries.

Standalone usage:

```bash
node patch_opencode_nine_router.js                      # dry run, prints JSON, writes nothing
node patch_opencode_nine_router.js --start              # patch, then launch 9Router
node -e "console.log(require('./patch_opencode_nine_router.js').selfTest() || 'ok')"
```

## Upgrading 9Router

Change the image tag and digest in the `Dockerfile`, redeploy, and update the version badge in this README. Currently pinned:

```dockerfile
FROM decolua/9router:0.5.95@sha256:4316fefb95ea642d57db885d906b1227b1768b15ac5def314621fd781da7b3f1
```

Upgrade to:

```dockerfile
FROM decolua/9router:<new-tag>@sha256:<new-digest>
```

Get the digest from Docker Hub:

```bash
docker pull decolua/9router:<new-tag>
docker image inspect decolua/9router:<new-tag> --format '{{index .RepoDigests 0}}'
```

Or from the Docker Hub API at `https://hub.docker.com/v2/repositories/decolua/9router/tags/<new-tag>`. Pin the manifest **index** digest (the tag's `docker-content-digest`, e.g. `sha256:4316fefb…` for `0.5.95`), not a per-platform manifest digest, so the image stays multi-arch.

Release list: https://hub.docker.com/r/decolua/9router/tags — the GitHub releases page lags behind the published images.

## Running Locally

Requires Docker.

```bash
docker build -t nine_router .
docker run -p 20128:20128 --env-file .env nine_router
```

The container listens on the port from `.env` (`PORT=20128` by default), so keep both sides of `-p` in sync if you change it.

- Dashboard: http://localhost:20128/dashboard
- API: http://localhost:20128/v1

## Usage

After signing in to the dashboard:

1. Connect a provider — Kiro AI (about 50 free credits a month), OpenCode Free (no auth), or any of the 40+ API key providers.
2. Copy an API key from the dashboard.
3. Point a CLI tool at the endpoint:

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

Requests to the opencode provider additionally receive the injected tool set described above, so a client can call `bash`, `glob`, `grep` and `read` without declaring them.

## Security

The dashboard is protected by a single password. Anyone who knows the Railway domain and that password can use your configured providers, so set a strong `INITIAL_PASSWORD` in production and keep the domain private. All provider credentials are stored inside 9Router itself; this repository contains none. The `.env` file in the repo holds only local defaults and must never carry production secrets.

## Troubleshooting

| Problem | Fix |
|---|---|
| Deploy fails to start | Check the Railway deploy logs. The container must bind to the `PORT` injected by Railway. |
| Healthcheck fails, service restarts in a loop | The healthcheck is `/api/health`, which 9Router serves unauthenticated (`src/app/api/health/route.js`). Do not point it at `/v1/models`: that path is in the `PUBLIC_PREFIXES` LLM API group and requires a valid API key from a remote host, so an unauthenticated probe gets `401 {"error":"API key required for remote API access"}`. |
| Dashboard opens on the wrong port | Let Railway set `PORT`; do not define it manually. |
| First login not working | Check `INITIAL_PASSWORD`. When unset, the fallback password is `123456`. |
| Container exits with `ERROR: opencode patch failed` | An upstream release moved or renamed a patch anchor. Check the log line for which anchor is missing, then update the constants at the top of `patch_opencode_nine_router.js`. |
| Provider quota exhausted | Add a combo fallback in the dashboard (Subscription → Cheap → Free). |

More help: https://github.com/decolua/9router#troubleshooting

## Design Decisions

- **Thin wrapper repo.** 9Router ships its own Docker image, so there is nothing to compile here — only configuration and the startup patch.
- **Pinned tag and digest.** Upstream releases never change production behavior without an explicit commit.
- **Startup patch instead of a fork.** The patch is small, idempotent and self-testing, so tracking upstream releases stays cheap while the routing fix survives.
- **Railway.** It builds from a one-line Dockerfile and handles TLS, domains, restarts and the injected `PORT`.

## Contributing

Fork the repo, branch from `main`, and keep changes focused. When bumping the 9Router version, update the tag and digest in the `Dockerfile` and the version badge in this README in the same commit.

## License

[MIT](https://github.com/decolua/9router)
