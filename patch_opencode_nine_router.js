const fs = require("fs");
const path = require("path");


const SKIP = new Set(["proc", "sys", "dev", ".git", "tmp", "socket", "run", "node_modules", "dist"]);

const Q4_TOOLS = [
  { name: "bash", description: "Run shell commands", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
  { name: "glob", description: "Find files by pattern", parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } },
  { name: "grep", description: "Search file contents", parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" } }, required: ["pattern", "path"] } },
  { name: "read", description: "Read file contents", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }
];

const HELPER_SRC = `function _injectQ4(b){if(!b||typeof b!=="object")return;b.stream=!0;if(!Array.isArray(b.tools))b.tools=[];let have=new Set;for(let t of b.tools){if(!t||typeof t!=="object")continue;let f=t.function&&typeof t.function==="object"?t.function:t;if(typeof f.name==="string"&&f.name)have.add(f.name)}for(let d of _Q4){if(have.has(d.name))continue;b.tools.push({type:"function",function:{name:d.name,description:d.description,parameters:JSON.parse(JSON.stringify(d.parameters||{type:"object",properties:{}}))}})}}`;

const TOOLS_MARK = "let _Q4=[";
const TOOLS_INSERT = `let _Q4=${JSON.stringify(Q4_TOOLS)};` + HELPER_SRC;

const ROUTING_RE = /new Set\(\[([^\]]*"union-alpha"[^\]]*)\]\)/;

const TR_OLD_RE = /transformRequest\((\w+),(\w+),(\w+),(\w+)\)\{((?:(?:var|let|const)\s+[^;{}]+;\s*)*)if\(\2&&"object"==typeof \2&&\1&&!\2\.model&&\(\2\.model=\1\),\2&&"object"==typeof \2&&\(\2\.stream=!0\)/;

const CATALOG_ANCHORS = [
  ['{id:"union-alpha",name:"Union Alpha",supportedFormats:["claude"]}', '{id:"union-alpha-free",name:"Union Alpha Free",supportedFormats:["claude"]}'],
  ['{id:"union-alpha",name:"Union Alpha Free",targetFormat:"claude"}', '{id:"union-alpha-free",name:"Union Alpha Free",targetFormat:"claude"}']
];

const CAP_OLD = '"union-alpha":{vision:!0,contextWindow:262144,maxOutput:131072}';
const CAP_NEW = '"union-alpha":{vision:!0,reasoning:!0,thinkingFormat:"anthropic",contextWindow:262144,maxOutput:131072}';
const CAP_MUSE = '"muse-spark-1.2-contributor-free":{vision:!0,reasoning:!0,thinkingFormat:"openai",contextWindow:1048576,maxOutput:131072}';
const CAP_FREE = '"union-alpha-free":{vision:!0,reasoning:!0,thinkingFormat:"anthropic",contextWindow:262144,maxOutput:131072}';

const RELAY_MARK = "relayClientIp";

const RELAY_RULES = [
  {
    anchor: 'newRequestInit.headers.delete("host");',
    insert:
      'newRequestInit.headers.delete("host");\n' +
      '    const relayClientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "";\n' +
      '    if (relayClientIp) {\n' +
      '      newRequestInit.headers.set("x-forwarded-for", relayClientIp);\n' +
      '      newRequestInit.headers.set("x-real-ip", relayClientIp);\n' +
      '    }'
  },
  {
    anchor: 'newHeaders.delete("host");',
    insert:
      'newHeaders.delete("host");\n' +
      '  const relayClientIp = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "";\n' +
      '  if (relayClientIp) {\n' +
      '    newHeaders.set("x-forwarded-for", relayClientIp);\n' +
      '    newHeaders.set("x-real-ip", relayClientIp);\n' +
      '  }'
  },
  {
    anchor: 'delete rawHeaders["host"];',
    insert:
      'delete rawHeaders["host"];\n\n' +
      '  const relayClientIp = req.headers.get("x-vercel-forwarded-for") || req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "";\n' +
      '  if (relayClientIp) {\n' +
      '    rawHeaders["x-forwarded-for"] = relayClientIp;\n' +
      '    rawHeaders["x-real-ip"] = relayClientIp;\n' +
      '  }'
  },
  {
    anchor: /for \(const k of Object\.keys\(forwardHeaders\)\) \{[\s\S]*?\n  \}/,
    insert:
      '\n  const relayClientIp = headers["x-nf-client-connection-ip"] || headers["client-ip"] || headers["x-real-ip"] || headers["x-forwarded-for"] || "";\n' +
      '  if (relayClientIp) {\n' +
      '    forwardHeaders["x-forwarded-for"] = relayClientIp;\n' +
      '    forwardHeaders["x-real-ip"] = relayClientIp;\n' +
      '  }'
  }
];

const VERSION_OLD = `async function i(){let a=await h(),b=f.rE,c=!!a&&function(a,b){let c=a.split(".").map(Number),d=b.split(".").map(Number);for(let a=0;a<3;a++){if(c[a]>d[a])return 1;if(c[a]<d[a])return -1}return 0}(a,b)>0;return Response.json({currentVersion:b,latestVersion:a,hasUpdate:c})}`;
const VERSION_NEW = `async function i(){let a=f.rE;return Response.json({currentVersion:a,latestVersion:a,hasUpdate:!1})}`;
const VERSION_DONE = "hasUpdate:!1";

function isChunkName(name) {
  return name.endsWith(".js");
}

function locate(start, maxDepth) {
  const found = [];
  const stack = [[start, 0]];
  while (stack.length) {
    const [dir, depth] = stack.pop();
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    try {
      if (fs.readdirSync(path.join(dir, "server", "chunks")).some(isChunkName)) found.push(dir);
    } catch {}
    for (const ent of entries) {
      if (ent.isDirectory() && !SKIP.has(ent.name)) stack.push([path.join(dir, ent.name), depth + 1]);
    }
  }
  return found;
}

function looksLike9Router(build) {
  for (const p of [path.join(build, "package.json"), path.join(build, "..", "package.json")]) {
    try {
      const name = JSON.parse(fs.readFileSync(p, "utf8")).name;
      if (typeof name === "string" && /9router/i.test(name)) return true;
    } catch {}
  }
  return false;
}

function findBuild() {
  const arg = process.argv[2];
  if (arg && arg !== "--start") return locate(arg, 6)[0] || null;
  const roots = [process.cwd(), "/app", "/root", "/home", "/usr", "/var", "/opt", "/"].filter(Boolean);
  let structural = null;
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const build of locate(root, root === "/" ? 5 : 6)) {
      if (looksLike9Router(build)) return build;
      if (!structural) structural = build;
    }
  }
  return structural;
}

function collectFiles(build) {
  const out = [];
  const walk = dir => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith(".js")) out.push(p);
    }
  };
  walk(path.join(build, "server"));
  return out.sort();
}

function appendEntry(src, anchor, extra) {
  if (!src.includes(anchor) || src.includes(anchor + "," + extra)) return src;
  return src.replace(anchor, anchor + "," + extra);
}

function patchTools(src) {
  if (src.includes(TOOLS_MARK)) return src;
  return TOOLS_INSERT + src;
}

function patchProvider(src) {
  if (!src.includes('super("opencode"')) return null;

  let out = src;

  out = out.replace(ROUTING_RE, (match, inner) => {
    if (inner.includes('"union-alpha-free"')) return match;
    return `new Set([${inner.replace('"union-alpha"', '"union-alpha","union-alpha-free"')}])`;
  });
  if (!out.includes('"union-alpha-free"')) return null;

  const at = out.indexOf('super("opencode"');
  const head = out.slice(0, at);
  const tail = out.slice(at);
  if (!tail.includes(",_injectQ4(")) {
    if (!TR_OLD_RE.test(tail)) return null;
    out = head + tail.replace(TR_OLD_RE, (match, model, body, c, d, prelude) =>
      `transformRequest(${model},${body},${c},${d}){${prelude}if(${body}&&"object"==typeof ${body}&&${model}&&(${body}.model==="union-alpha-free"&&(${body}.model="union-alpha"),!${body}.model&&(${body}.model=${model})),${body}&&"object"==typeof ${body}&&(${body}.stream=!0),_injectQ4(${body})`
    );
  }

  out = patchTools(out);

  return out === src ? null : out;
}

function patchCatalog(src) {
  let out = src;
  for (const [anchor, extra] of CATALOG_ANCHORS) out = appendEntry(out, anchor, extra);
  return out === src ? null : out;
}

function patchCapabilities(src) {
  if (!src.includes(CAP_OLD) && !src.includes(CAP_FREE)) return null;
  let out = src.replace(CAP_OLD, CAP_NEW);
  const anchor = out.includes(CAP_MUSE) ? CAP_MUSE : out.includes(CAP_NEW) ? CAP_NEW : null;
  if (anchor) out = appendEntry(out, anchor, CAP_FREE);
  return out === src ? null : out;
}

function patchVersion(src) {
  if (src.includes(VERSION_DONE)) return null;
  if (!src.includes(VERSION_OLD)) return null;
  const out = src.replace(VERSION_OLD, VERSION_NEW);
  return out;
}

function patchRelay(src) {
  if (!src.includes('"x-relay-target"')) return null;
  if (src.includes(RELAY_MARK)) return null;

  let out = src;
  for (const rule of RELAY_RULES) {
    if (typeof rule.anchor === "string") {
      if (!out.includes(rule.anchor)) continue;
      out = out.replace(rule.anchor, rule.insert);
    } else {
      if (!rule.anchor.test(out)) continue;
      out = out.replace(rule.anchor, m => m + rule.insert);
    }
  }
  return out === src ? null : out;
}

function run(options = {}) {
  const applied = { provider: 0, catalog: 0, capabilities: 0, version: 0, relay: 0, changed: 0 };
  const state = { provider: false, catalog: false, capabilities: false, version: false, relay: false, relayTemplates: false };
  const files = [];
  const pending = [];

  const build = findBuild();
  if (!build) return { ok: false, reason: "9router build dir not found", applied, files };

  for (const file of collectFiles(build)) {
    const src = fs.readFileSync(file, "utf8");
    let out = src;

    const provider = patchProvider(out);
    if (provider) { out = provider; applied.provider++; }
    const catalog = patchCatalog(out);
    if (catalog) { out = catalog; applied.catalog++; }
    const capabilities = patchCapabilities(out);
    if (capabilities) { out = capabilities; applied.capabilities++; }
    const version = patchVersion(out);
    if (version) { out = version; applied.version++; }
    const relay = patchRelay(out);
    if (relay) { out = relay; applied.relay++; }

    if (out !== src) pending.push([file, out]);

    if (out.includes('"union-alpha-free"') && /,_injectQ4\(\w+\)/.test(out)) state.provider = true;
    if (out.includes(CATALOG_ANCHORS[0][1]) || out.includes(CATALOG_ANCHORS[1][1])) state.catalog = true;
    if (out.includes(CAP_FREE)) state.capabilities = true;
    if (out.includes(VERSION_DONE)) state.version = true;
    if (out.includes(RELAY_MARK)) state.relay = true;
    if (src.includes('"x-relay-target"')) state.relayTemplates = true;
  }

  const missing = [];
  if (!state.provider) missing.push("opencode provider module (routing Set / transformRequest anchors)");
  if (!state.catalog) missing.push("opencode provider model list (union-alpha entry)");
  if (!state.capabilities) missing.push("model capability map (union-alpha entry)");
  if (!state.version) missing.push("version route (npm update-check response)");
  if (state.relayTemplates && !state.relay) missing.push("proxy pool relay templates (client IP forwarding)");
  if (missing.length) return { ok: false, reason: "anchors not found: " + missing.join("; "), applied, files };

  for (const [file, out] of pending) {
    const tmp = file + ".9r-tmp";
    try {
      fs.writeFileSync(tmp, out);
      fs.renameSync(tmp, file);
      applied.changed++;
      files.push(file);
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch {}
      return { ok: false, reason: `write failed for ${file}: ${err.message}`, applied, files };
    }
  }

  return { ok: true, applied, state, files, version: readVersion(build) };
}

function readVersion(build) {
  for (const p of [path.join(build, "package.json"), path.join(build, "..", "package.json")]) {
    try {
      const v = JSON.parse(fs.readFileSync(p, "utf8")).version;
      if (v) return v;
    } catch {}
  }
  return null;
}

function testInjector() {
  const cases = [
    ["empty body", {}],
    ["no tools", { model: "opencode/mimo-v2.5-free" }],
    ["openai tools", { tools: [{ type: "function", function: { name: "bash" } }] }],
    ["anthropic tools", { tools: [{ name: "bash", description: "x", input_schema: { type: "object" } }] }],
    ["junk tools", { tools: [null, undefined, 1, "x", [], { type: "function" }] }],
    ["tools not array", { tools: { bash: true } }]
  ];
  let runInject;
  try {
    runInject = new Function("_Q4", HELPER_SRC + ";return _injectQ4;");
  } catch (err) {
    return "injected helper does not parse: " + err.message;
  }
  const before = JSON.stringify(Q4_TOOLS);
  for (const [label, body] of cases) {
    try {
      const inject = runInject(Q4_TOOLS);
      inject(body);
      inject(body);
    } catch (err) {
      return `injected helper threw on "${label}": ${err.message}`;
    }
  }
  try {
    const body = { tools: [{ type: "function", function: { name: "bash" } }] };
    runInject(Q4_TOOLS)(body);
    if (body.stream !== true) return "injected helper did not force stream";
    if (body.tools.length !== Q4_TOOLS.length) return `injected helper added wrong tool count: ${body.tools.length}`;
    const names = body.tools.map(t => t.function.name);
    for (const d of Q4_TOOLS) if (!names.includes(d.name)) return `injected helper missing tool: ${d.name}`;
    runInject(Q4_TOOLS)(body);
    if (body.tools.length !== Q4_TOOLS.length) return "injected helper is not idempotent (duplicate tools)";
    const noTools = { model: "opencode/x" };
    runInject(Q4_TOOLS)(noTools);
    if (noTools.tools.length !== Q4_TOOLS.length) return "injected helper did not add tools to a body without tools";
  } catch (err) {
    return `injected helper assertion threw: ${err.message}`;
  }
  if (JSON.stringify(Q4_TOOLS) !== before) return "injected helper mutated its own tool definitions";
  return null;
}

function testProviderPatch() {
  const cases = [
    [
      "var prelude",
      'let y=new Set(["union-alpha"]);class M extends f.H{constructor(){super("opencode",g.xq.opencode)}transformRequest(a,b,c,d){var e;if(b&&"object"==typeof b&&a&&!b.model&&(b.model=a),b&&"object"==typeof b&&(b.stream=!0),L(a||b?.model)&&b&&"object"==typeof b){let z=1}}}'
    ],
    [
      "no prelude",
      'let u=new Set(["union-alpha"]);class M extends f.H{constructor(){super("opencode",g.xq.opencode)}transformRequest(a,b,c,d){if(b&&"object"==typeof b&&a&&!b.model&&(b.model=a),b&&"object"==typeof b&&(b.stream=!0),L(a||b?.model)&&b&&"object"==typeof b){let z=1}}}'
    ],
    [
      "renamed parameters",
      'let y=new Set(["union-alpha"]);class M extends f.H{constructor(){super("opencode",g.xq.opencode)}transformRequest(x,y,z,w){var q;if(y&&"object"==typeof y&&x&&!y.model&&(y.model=x),y&&"object"==typeof y&&(y.stream=!0),L(x||y?.model)&&y&&"object"==typeof y){let z=1}}}'
    ]
  ];
  for (const [label, src] of cases) {
    const out = patchProvider(src);
    if (!out) return `provider patch (${label}) did not match the anchors`;
    if (!out.includes('"union-alpha-free"')) return `provider patch (${label}) did not add union-alpha-free to the routing Set`;
    if (out.includes("=u=new Set")) return `provider patch (${label}) corrupted the routing assignment`;
    if (!out.includes('.model==="union-alpha-free"')) return `provider patch (${label}) did not map union-alpha-free back to union-alpha`;
    if (!/,_injectQ4\(\w+\)/.test(out)) return `provider patch (${label}) did not inject the tool helper call`;
    try {
      new Function(out);
    } catch (err) {
      return `provider patch (${label}) produced invalid JavaScript: ${err.message}`;
    }
    if (patchProvider(out) !== null) return `provider patch (${label}) is not idempotent`;
  }
  const other = 'class X extends f.H{constructor(){super("huggingface")}transformRequest(a,b,c,d){if(b&&"object"==typeof b&&a&&!b.model&&(b.model=a),b&&"object"==typeof b&&(b.stream=!0),1){}}}';
  if (patchProvider(other) !== null) return "provider patch modified an unrelated provider";
  return null;
}

function testVersionPatch() {
  const src = `(function(){${VERSION_OLD}})`;
  const out = patchVersion(src);
  if (out === null) return "version route anchor did not match";
  if (!out.includes(VERSION_DONE)) return "version route patch did not disable the update flag";
  if (out.includes("await h()")) return "version route patch still calls the npm lookup";
  if (!out.includes("latestVersion:a")) return "version route patch dropped latestVersion from the response";
  if (patchVersion(out) !== null) return "version route patch is not idempotent";
  const untouched = "const unrelated = 1;";
  if (patchVersion(untouched) !== null) return "version route patch modified a file without the anchor";
  try {
    const body = new Function(`${VERSION_NEW};return i`)();
    void body;
  } catch (err) {
    return "patched version handler does not parse: " + err.message;
  }
  return null;
}

function testRelayPatch() {
  const cases = [
    {
      label: "cloudflare",
      src: [
        "export default {",
        "  async fetch(request, env, ctx) {",
        '    const target = request.headers.get("x-relay-target");',
        "    const newRequestInit = { method: request.method, headers: new Headers(request.headers) };",
        '    newRequestInit.headers.delete("host");',
        "    try {",
        "  },",
        "};"
      ].join("\n"),
      need: ['cf-connecting-ip', 'newRequestInit.headers.set("x-forwarded-for", relayClientIp)']
    },
    {
      label: "deno",
      src: [
        "Deno.serve(async (request) => {",
        '  const target = request.headers.get("x-relay-target");',
        "  const newHeaders = new Headers(request.headers);",
        '  newHeaders.delete("host");',
        "  try {",
        "});"
      ].join("\n"),
      need: ['x-forwarded-for", relayClientIp', 'newHeaders.set("x-real-ip", relayClientIp)']
    },
    {
      label: "vercel",
      src: [
        "export default async function handler(req) {",
        '  const target = req.headers.get("x-relay-target");',
        "  const rawHeaders = {};",
        '  delete rawHeaders["host"];',
        "  const response = await fetch(target);",
        "}"
      ].join("\n"),
      need: ['x-vercel-forwarded-for', 'rawHeaders["x-real-ip"] = relayClientIp']
    },
    {
      label: "netlify",
      src: [
        "exports.handler = async (event) => {",
        '  const target = event.headers["x-relay-target"];',
        "  const forwardHeaders = { ...event.headers };",
        "  for (const k of Object.keys(forwardHeaders)) {",
        "    const lower = k.toLowerCase();",
        '    if (lower === "x-relay-target" || lower === "host") {',
        "      delete forwardHeaders[k];",
        "    }",
        "  }",
        "  try {",
        "};"
      ].join("\n"),
      need: ['x-nf-client-connection-ip', 'forwardHeaders["x-forwarded-for"] = relayClientIp']
    }
  ];

  for (const c of cases) {
    const out = patchRelay(c.src);
    if (!out) return `relay patch (${c.label}) did not match the template anchor`;
    for (const token of c.need) {
      if (!out.includes(token)) return `relay patch (${c.label}) missing ${token}`;
    }
    if (out.includes("`") || out.includes("${")) return `relay patch (${c.label}) broke the template literal`;
    if (patchRelay(out) !== null) return `relay patch (${c.label}) is not idempotent`;
  }

  const plain = "const x = 1;";
  if (patchRelay(plain) !== null) return "relay patch modified a file without relay templates";
  const other = 'newHeaders.delete("host");const y=2;';
  if (patchRelay(other) !== null) return "relay patch modified a non-relay template";
  return null;
}

function selfTest() {
  return testInjector() || testProviderPatch() || testVersionPatch() || testRelayPatch();
}

function start() {
  const result = run();

  if (!result.ok) {
    console.error("ERROR: opencode patch failed: " + result.reason);
    process.exit(1);
  }

  const fail = selfTest();
  if (fail) {
    console.error("ERROR: opencode patch self-test failed: " + fail);
    process.exit(1);
  }

  const ver = result.version ? ` 9router=${result.version}` : "";
  const written = result.files.length ? " files=" + result.files.join(",") : "";
  console.log(
    `opencode patch: provider=${result.applied.provider} catalog=${result.applied.catalog} capabilities=${result.applied.capabilities} version=${result.applied.version} relay=${result.applied.relay} (${result.applied.changed} chunk(s) written)${ver}${written}`
  );

  spawnServer();
}

function spawnServer() {
  const candidates = [
    ["/app/app/server.js", ["node", "/app/app/server.js"]],
    ["/app/server.js", ["node", "/app/server.js"]],
    ["/root/.npm-global/lib/node_modules/9router/app/server.js", ["node", "/root/.npm-global/lib/node_modules/9router/app/server.js"]],
    ["/usr/local/lib/node_modules/9router/app/server.js", ["node", "/usr/local/lib/node_modules/9router/app/server.js"]]
  ];

  for (const [entry, cmd] of candidates) {
    if (fs.existsSync(entry)) {
      runChild(cmd);
      return;
    }
  }

  runChild(["9router", "-p", process.env.PORT || "20128", "-H", "0.0.0.0", "-n", "-l", "--skip-update"]);
}

function runChild(cmd) {
  const child = require("child_process").spawn(cmd[0], cmd.slice(1), {
    stdio: "inherit",
    env: process.env
  });
  child.on("error", (err) => {
    console.error(`ERROR: failed to start ${cmd[0]}: ${err.message}`);
    process.exit(1);
  });
  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, () => child.kill(sig));
  }
  child.on("exit", (code) => process.exit(code ?? 1));
}

module.exports = { run, selfTest, findBuild, collectFiles, testInjector, testProviderPatch, testVersionPatch, testRelayPatch, patchProvider, patchVersion, patchRelay };

if (require.main === module) {
  if (process.argv[2] === "--start") start();
  else {
    const result = run();
    const fail = selfTest();
    console.log(JSON.stringify({ ...result, selfTest: fail || "ok" }, null, 2));
    if (fail) process.exit(1);
    if (!result.ok) {
      console.error("ERROR: opencode patch skipped: " + result.reason);
      process.exit(1);
    }
  }
}
