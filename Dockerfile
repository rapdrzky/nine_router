FROM decolua/9router:0.5.116@sha256:12086f97857f784ab7762e95595f70d71279a7a60c800af0f100183e8da7ea36

# OpenCode Free's TLS impersonation (wreq-js) is a lazy runtime dependency that
# the pinned 0.5.116 image does not ship (upstream only started bundling it in
# later images — see 9router#5245). Without it, every free-lane request goes out
# over native Node fetch and is refused by the TLS-fingerprint gate with
# 429 FreeUsageLimitError even when the session/proxy patch is applied. Install
# it (with its native prebuilt binding) into /app/node_modules where the
# lazyRuntime loader resolves it.
RUN (command -v npm >/dev/null 2>&1 || apk add --no-cache npm) \
  && mkdir -p /opt/lazy-runtime \
  && cd /opt/lazy-runtime \
  && npm init -y >/dev/null \
  && npm install --no-save --prefer-online "wreq-js@^3.2.0" \
  && mkdir -p /app/node_modules \
  && cp -r node_modules/. /app/node_modules/

COPY patch_opencode_nine_router.js patch_proxy_nine_router.js /app/

CMD ["node", "/app/patch_opencode_nine_router.js", "--start"]
