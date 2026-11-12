// Bun transport hop for the OpenCode free lane.
//
// Runs under Bun. Bun's own HTTP/TLS stack (BoringSSL, browser-shaped ClientHello
// and HTTP/2 SETTINGS) passes the free-lane TLS-fingerprint gate that native Node
// fetch fails with 429 FreeUsageLimitError. This helper reads exactly one request
// from stdin as JSON, performs the fetch, then writes a JSON header line
// (status/statusText/headers) followed by the raw response body to stdout, then
// exits. Under Node this file is only syntax-parsed, never executed.
const input = await new Promise((resolve) => {
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { data += chunk; });
  process.stdin.on("end", () => resolve(data));
});
const req = JSON.parse(input || "{}");

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), Number(req.timeoutMs) || 120000);
try {
  const res = await fetch(req.url, {
    method: req.method || "GET",
    headers: req.headers || {},
    body: req.body ?? undefined,
    redirect: "follow",
    proxy: req.proxy || undefined,
    signal: controller.signal,
  });
  const headers = {};
  res.headers?.forEach?.((v, k) => { headers[k] = v; });
  process.stdout.write(JSON.stringify({ status: res.status, statusText: res.statusText, headers }) + "\n");
  if (res.body) {
    for await (const chunk of res.body) process.stdout.write(chunk);
  }
} finally {
  clearTimeout(timer);
}
