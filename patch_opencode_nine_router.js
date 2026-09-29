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

const TOOLS_DECL = `x=0,y=0;`;
const TOOLS_INSERT = TOOLS_DECL + `let _Q4=${JSON.stringify(Q4_TOOLS)};` + HELPER_SRC;
const TOOLS_MARK = "let _Q4=[";
const TOOLS_END = "b.tools.push(t)}";

const ROUTING_OLD = 'w=new Set(["union-alpha"])';
const ROUTING_NEW = 'w=new Set(["union-alpha","union-alpha-free"])';
const TR_OLD = 'transformRequest(a,b,c,d){if(b&&"object"==typeof b&&a&&!b.model&&(b.model=a),b&&"object"==typeof b&&(b.stream=!0)';
const TR_NEW = 'transformRequest(a,b,c,d){if(b&&"object"==typeof b&&a&&(b.model==="union-alpha-free"&&(b.model="union-alpha"),!b.model&&(b.model=a)),b&&"object"==typeof b&&(b.stream=!0),_injectQ4(b)';

const CATALOG_ANCHORS = [
  ['{id:"union-alpha",name:"Union Alpha",supportedFormats:["claude"]}', '{id:"union-alpha-free",name:"Union Alpha Free",supportedFormats:["claude"]}'],
  ['{id:"union-alpha",name:"Union Alpha Free",targetFormat:"claude"}', '{id:"union-alpha-free",name:"Union Alpha Free",targetFormat:"claude"}']
];

const CAP_OLD = '"union-alpha":{vision:!0,contextWindow:262144,maxOutput:131072}';
const CAP_NEW = '"union-alpha":{vision:!0,reasoning:!0,thinkingFormat:"anthropic",contextWindow:262144,maxOutput:131072}';
const CAP_MUSE = '"muse-spark-1.2-contributor-free":{vision:!0,reasoning:!0,thinkingFormat:"openai",contextWindow:1048576,maxOutput:131072}';
const CAP_FREE = '"union-alpha-free":{vision:!0,reasoning:!0,thinkingFormat:"anthropic",contextWindow:262144,maxOutput:131072}';

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
  const mark = src.indexOf(TOOLS_MARK);
  if (mark !== -1) {
    const decl = src.lastIndexOf(TOOLS_DECL, mark);
    const end = src.indexOf(TOOLS_END, mark);
    if (decl === -1 || end === -1) return src;
    const existing = src.slice(decl, end + TOOLS_END.length);
    if (existing === TOOLS_INSERT) return src;
    return src.slice(0, decl) + TOOLS_INSERT + src.slice(end + TOOLS_END.length);
  }
  if (!src.includes(TOOLS_DECL)) return null;
  return src.replace(TOOLS_DECL, TOOLS_INSERT);
}

function patchProvider(src) {
  if (!src.includes(TR_OLD) && !src.includes("_injectQ4(b)")) return null;
  let out = src;
  if (out.includes(ROUTING_OLD)) out = out.replace(ROUTING_OLD, ROUTING_NEW);
  else if (!out.includes(ROUTING_NEW)) return null;
  const tools = patchTools(out);
  if (tools === null || tools === out) return out === src ? null : out;
  out = tools;
  if (out.includes(TR_OLD)) out = out.replace(TR_OLD, TR_NEW);
  else if (!out.includes("_injectQ4(b)")) return null;
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

function run(options = {}) {
  const applied = { provider: 0, catalog: 0, capabilities: 0, changed: 0 };
  const state = { provider: false, catalog: false, capabilities: false };
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

    if (out !== src) pending.push([file, out]);

    if (out.includes(ROUTING_NEW) && out.includes("_injectQ4(b)")) state.provider = true;
    if (out.includes(CATALOG_ANCHORS[0][1]) || out.includes(CATALOG_ANCHORS[1][1])) state.catalog = true;
    if (out.includes(CAP_FREE)) state.capabilities = true;
  }

  const missing = [];
  if (!state.provider) missing.push("opencode provider module (routing Set / transformRequest anchors)");
  if (!state.catalog) missing.push("opencode provider model list (union-alpha entry)");
  if (!state.capabilities) missing.push("model capability map (union-alpha entry)");
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

function selfTest() {
  return testInjector();
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
    `opencode patch: provider=${result.applied.provider} catalog=${result.applied.catalog} capabilities=${result.applied.capabilities} (${result.applied.changed} chunk(s) written)${ver}${written}`
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

module.exports = { run, selfTest, findBuild, collectFiles, testInjector };

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
