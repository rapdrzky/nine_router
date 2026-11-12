# Nine Router

![License](https://img.shields.io/badge/license-MIT-blue)
![Railway](https://img.shields.io/badge/deploy-Railway-purple)
![Docker](https://img.shields.io/badge/runtime-Docker-blue)
![Version](https://img.shields.io/badge/9router-v0.5.116-green)

Thin wrapper that deploys [9Router](https://github.com/decolua/9router) to [Railway](https://railway.app) on top of its own Docker image. There is no source build here — the image is pinned by tag and digest, and one Node script patches the installed build at container startup before the server boots.

9Router is a free AI router and token saver: it connects Claude Code, Codex, Cursor, Cline, Copilot and other CLI tools to 40+ providers with automatic fallback and 20-40% token savings via RTK.

## Features

- Image pinned to `v0.5.116` plus an immutable manifest digest, so builds are reproducible and an upstream tag rewrite cannot change production behavior.
- Startup patch forces `stream: true` on opencode requests. The free tier rejects non-streaming requests (`FreeTierError`), so this is required.
- Startup patch registers `union-alpha-free` as an alias of `union-alpha`: added to the messages-format routing set, the provider catalog, and the capability map (vision, reasoning, 262k context, 131k output). The alias is translated back to `union-alpha` inside `transformRequest`.
- Startup patch injects the `bash`, `glob`, `grep` and `read` tool definitions into every opencode request.
- Startup patch neutralizes the `/api/version` update check, so the dashboard never shows an `↑ New version available` banner. The image is pinned here, not by the 9Router CLI updater, so an upstream npm release cannot be installed in place.
- Startup patch makes the Proxy Pool relay templates forward the client IP. Cloudflare strips `cf-connecting-ip` from a Worker's outbound `fetch()`, so free-tier requests sent through a relay reached upstream without any client IP and failed with `429 rate_limit_error: Client IP address is required for free usage`. The patched templates map the platform header (`cf-connecting-ip`, `x-vercel-forwarded-for`, `x-nf-client-connection-ip`) onto `x-forwarded-for` and `x-real-ip`.
- Startup patch drops a rejected OpenCode session so a 429 does not stick until restart. The free tier limits a session id, and the pinned build caches one id per client identity forever; upstream fixed this in `forgetOpencodeSession()` (v0.5.119), which has no published image yet, so this patch backports the behaviour: a 429 or 403 from the free lane evicts that id and the next request mints a fresh one.
- Startup patch fixes the Proxy Pool dashboard test. The stock build hands the pool URL straight to `new ProxyAgent({ uri })`, so a proxy entered as `host:port` throws `Invalid URL` and the dashboard reports the pool as failed even though the proxy works. The patched route adds the missing scheme, raises the default probe timeout from 8 s to 20 s, retries a rejected `HEAD` with a `GET`, and retries a self-signed proxy certificate without verification, which is what the request path itself does.
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
FROM decolua/9router:0.5.116@sha256:12086f97857f784ab7762e95595f70d71279a7a60c800af0f100183e8da7ea36

COPY patch_opencode_nine_router.js /app/

CMD ["node", "/app/patch_opencode_nine_router.js", "--start"]
```

## Opencode patch

`patch_opencode_nine_router.js` runs before the server starts and rewrites the installed 9Router build in place:

- Scans `server/**/*.js` for the provider, catalog, capability and version-route anchors instead of hard-coding chunk file names, so an upstream chunk renumbering does not silently skip a copy of the module. The provider is located by its `super("opencode"` declaration, and the routing `Set` / `transformRequest` are matched by shape, so minifier renames of the Set variable or parameter names (and extra statements such as `var e;`) do not break the patch.
- Adds `union-alpha-free` to the routing set, the provider model list and the capability map. It deliberately stays out of the responses-format set: `OpenCodeExecutor.buildUrl()` tests `isResponsesModel()` before `isMessagesModel()`, so a responses classification would send this claude-format model to `/zen/v1/responses`.
- Rewrites the `opencode` `transformRequest` body so `union-alpha-free` maps to `union-alpha`, forces `stream: true`, and calls `_injectQ4(b)`.
- Installs the `_injectQ4` helper, which fills `body.tools` with the `bash`, `glob`, `grep` and `read` definitions when absent and never overwrites a tool the client already sent.
- Rewrites the `/api/version` route handler so it reports `currentVersion === latestVersion` and `hasUpdate: false` without contacting the npm registry. Upstream fetches `registry.npmjs.org/9router/latest` and compares it to the version baked into the build, so a pinned image would otherwise advertise an update it can never install.
- Rewrites the four Proxy Pool relay templates (`cloudflare-deploy`, `deno-deploy`, `vercel-deploy`, `netlify-deploy`) so each relay copies the platform's client-IP header into the outbound `x-forwarded-for` and `x-real-ip`. Without it the free tier answers `429 Client IP address is required for free usage` whenever a request leaves through a relay. The injected code contains no backticks or `${`, so it cannot break the surrounding template literal.
- Wraps the `opencode` executor's `execute()` so a `429` or `403` response evicts the session id it used from both session caches, then returns the response untouched. The executor is located as the class whose constructor calls `super("opencode"` so the sibling `opencode-go` executor is never touched, and the two cache maps are captured by their `new Map` plus cleanup-`setInterval` shape rather than by minified name. Client-supplied session ids never enter those caches, so they are never evicted.
- Rewrites the Proxy Pool test route (`/api/proxy-pools/[id]/test` and `/api/settings/proxy-test`) so a pool entered as `host:port` is tested as an `http://` proxy instead of throwing `Invalid URL`, the default probe timeout is 20 s instead of 8 s, a rejected `HEAD` is retried with a `GET`, and a proxy that intercepts TLS with a self-signed certificate is retried without certificate verification, the same fallback the request path uses. The route is located by its `proxyUrl is required` marker and its `new ProxyAgent({ uri })` call, so minifier renames do not break the patch.
- Writes are two-phase: every file is patched and validated in memory first, and only written (temp file plus rename, so a crash cannot leave a half-written chunk) once all anchors are confirmed present.
- Re-running is safe. Writes converge: a stale injected block is rewritten in place rather than duplicated.

The patch fails fast. If an anchor is missing, or the self-test throws, the container exits with `ERROR: opencode patch failed: …` or `ERROR: opencode patch self-test failed: …` in the Railway logs instead of starting silently unpatched.

A healthy start logs:

```
opencode patch: provider=… catalog=… capabilities=… version=… relay=… session=… proxyTest=… (N chunk(s) written) 9router=<version> files=<paths>
```

The self-test covers the tool helper against empty bodies, OpenAI-style tools, Anthropic-style tools and junk entries, the provider patch against both new and legacy minified shapes (with and without a `var` prelude, and with renamed parameters), the version-route rewrite (anchor match, update flag cleared, npm lookup call removed, idempotent, handler still parses), the relay patch for all four worker templates (injection present, no backticks or `${` added, idempotent, non-relay files untouched), the session patch (correct executor selected, foreign `opencode-go` executor untouched, eviction behaviour across both caches, status gate, idempotent, patched chunk still parses), and the proxy pool test patch (scheme added to a bare `host:port`, scheme left alone when present, `GET` fallback after a failed `HEAD`, insecure retry after a certificate error, no insecure retry after a timeout, timeout raised, idempotent, patched route still parses).

### Relay workers must be redeployed

The relay patch changes the worker source that the dashboard generates. A worker that is already deployed keeps running its old code, so after this image boots, open **Dashboard → Proxy Pools** and redeploy (or delete and recreate) the pool once. Newly created pools pick up the fix automatically.

If the free tier still answers `429 rate_limit_error` after the relay redeploy, the relay pools are degraded and no source-level fix exists in `v0.5.116`: free-tier quota is keyed to the upstream session, and with `strictProxy` set, `v0.5.116` never passes the selected proxy into the `wreq-js` TLS transport (fixed upstream in `a76c2afc`, not published as an image yet). The session patch above makes a 429 self-heal instead of requiring a restart: the rejected session id is evicted and the next request mints a new one. A restart is only needed when the start log reports `session=0`, which means the session anchor no longer matched this build. A residential SOCKS5/HTTP proxy is still bypassed on the free lane until that upstream fix ships.

Standalone usage:

```bash
node patch_opencode_nine_router.js                      # dry run, prints JSON, writes nothing
node patch_opencode_nine_router.js --start              # patch, then launch 9Router
node -e "console.log(require('./patch_opencode_nine_router.js').selfTest() || 'ok')"
```

## Upgrading 9Router

Change the image tag and digest in the `Dockerfile`, redeploy, and update the version badge in this README. Currently pinned:

```dockerfile
FROM decolua/9router:0.5.116@sha256:12086f97857f784ab7762e95595f70d71279a7a60c800af0f100183e8da7ea36
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
| `↑ New version available` banner in the dashboard | The version-route patch did not apply. Check the `version=` count in the startup log and the "version route (npm update-check response)" entry in the failure reason. |
| Provider quota exhausted | Add a combo fallback in the dashboard (Subscription → Cheap → Free). |
| Proxy Pool says failed for a proxy that works elsewhere | The stock build only accepts a full proxy URL. The patched route adds the missing `http://` scheme, so `1.2.3.4:8080` is tested as `http://1.2.3.4:8080`. A pool that still fails with `Proxy CONNECT aborted` or `CONNECT tunnel failed` cannot tunnel HTTPS, so it cannot carry API traffic either, no matter what the proxy list says. A pool that fails with a certificate error is retried without verification, the same way the request path does. |

More help: https://github.com/decolua/9router#troubleshooting

## Design Decisions

- **Thin wrapper repo.** 9Router ships its own Docker image, so there is nothing to compile here — only configuration and the startup patch.
- **Pinned tag and digest.** Upstream releases never change production behavior without an explicit commit.
- **Startup patch instead of a fork.** The patch is small, idempotent and self-testing, so tracking upstream releases stays cheap while the routing fix survives.
- **Update banner disabled, not downgraded.** Upstream decides the banner from the npm registry, which publishes before the Docker image. Pinning the image and silencing the banner keeps the notice honest: this deployment has no in-place updater.
- **Railway.** It builds from a one-line Dockerfile and handles TLS, domains, restarts and the injected `PORT`.

## Contributing

Fork the repo, branch from `main`, and keep changes focused. When bumping the 9Router version, update the tag and digest in the `Dockerfile` and the version badge in this README in the same commit.

## License

[MIT](https://github.com/decolua/9router)
