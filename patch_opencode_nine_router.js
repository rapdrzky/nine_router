const fs = require("fs");
const path = require("path");

const proxyPatch = require("./patch_proxy_nine_router.js");


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

const SESSION_MARK = "function _forgetQ4Session(";

const SESSION_STORE_RE = /let (\w+)=new Map,\w+=setInterval\(\(\)=>\{let \w+=Date\.now\(\);for\(let\[\w+,\w+\]of \1\)/g;

const SESSION_EXEC_RE = /async execute\((\w+)\)\{let (\w+)=this\.prepareRequestCredentials\(\1\);return /;

const SESSION_CLASS_RE = /class (\w+) extends [\w.$]+\.H\{constructor\(\)\{super\("opencode"/;

const VERSION_OLD = `async function i(){let a=await h(),b=f.rE,c=!!a&&function(a,b){let c=a.split(".").map(Number),d=b.split(".").map(Number);for(let a=0;a<3;a++){if(c[a]>d[a])return 1;if(c[a]<d[a])return -1}return 0}(a,b)>0;return Response.json({currentVersion:b,latestVersion:a,hasUpdate:c})}`;
const VERSION_NEW = `async function i(){let a=f.rE;return Response.json({currentVersion:a,latestVersion:a,hasUpdate:!1})}`;
const VERSION_DONE = "hasUpdate:!1";

// Free-lane proxy transport backport (9router upstream commit a76c2afc93e34070cf11685968c47a06fcd1fcb0).
// Upstream fix commit: "fix(opencode): carry the selected proxy through the wreq-js transport".
// Bug: Proxy Pool selection never reached the wreq-js runtime — opencodeTlsFetch() created its
// session without a proxy, so free-tier requests left through the server's direct interface even
// with a pool selected and strictProxy set, and proxyAwareFetch() swapped the adapter for an
// undici ProxyAgent, dropping the TLS impersonation the free gate requires. That is why the
// rotation over 455 proxies never helped and the lane kept answering 429.
// Backport for the pinned 9Router v0.5.116 image, which predates the fix.

const PROXY_FIX_MARK = "proxyCapable";

// Full opencode-executor `execute` method on the real 0.5.116 build:
//   async execute(a){let b=this.prepareRequestCredentials(a);return super.execute({...a,credentials:b,directFetch:(a,b)=>r(a,{method:b.method,headers:b.headers,body:b.body},{signal:b.signal})})}
// The rewritten form folds in (1) the proxy-capable adapter that forwards the
// resolved proxy URL, (2) status-based session eviction on 429/403, and (3)
// preemptive session rotation (rotate before the free-tier wall, not after).
const EXEC_FULL_OLD = 'async execute(a){let b=this.prepareRequestCredentials(a);return super.execute({...a,credentials:b,directFetch:(a,b)=>r(a,{method:b.method,headers:b.headers,body:b.body},{signal:b.signal})})}';
const EXEC_FULL_NEW = 'async execute(a){let b=this.prepareRequestCredentials(a);if(!globalThis.__ocFr)globalThis.__ocFr={m:new Map};let __sid=b&&b._opencodeSession;if(__sid){let __n=(globalThis.__ocFr.m.get(__sid)||0)+1;globalThis.__ocFr.m.set(__sid,__n);if(__n>=(Number(process.env.OPENCODE_SESSION_MAX_USES)||8))_forgetQ4Session(__sid,429)}const c=(t,e,f)=>r(t,{method:e.method,headers:e.headers,body:e.body},{signal:e.signal,proxyUrl:f});c.proxyCapable=!0;let _oc9r=await super.execute({...a,credentials:b,directFetch:c});try{_forgetQ4Session(b&&b._opencodeSession,_oc9r&&_oc9r.response&&_oc9r.response.status)}catch{}return _oc9r}';

const PROXY_CLASS_RE = /class (\w+) extends [\w.$]+\.H\{constructor\(\)\{super\("opencode"/;

const PROXY_EXEC_RE = /async execute\((\w+)\)\{let (\w+)=this\.prepareRequestCredentials\(\1\);return super\.execute\(\{\.\.\.\1,credentials:\2,directFetch:\((\w+),(\w+)\)=>(\w+)\(\1,\{method:\4\.method,headers:\4\.headers,body:\4\.body\},\{signal:\4\.signal\}\)\}\);/;

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

function findBuild(target) {
  const arg = target !== undefined ? target : process.argv[2];
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

function patchSession(src) {
  if (src.includes(SESSION_MARK)) return null;

  const cls = SESSION_CLASS_RE.exec(src);
  if (!cls) return null;

  const marker = src.lastIndexOf("_opencodeSession", cls.index);
  if (marker < 0) return null;

  const window = src.slice(marker, marker + 4000);
  const stores = [];
  SESSION_STORE_RE.lastIndex = 0;
  let store;
  while ((store = SESSION_STORE_RE.exec(window)) && stores.length < 2) stores.push(store[1]);
  if (stores.length < 2) return null;

  // Only inject the eviction helper. The `execute` rewrite (proxy adapter +
  // status eviction + preemptive rotation) is done by patchFreeLaneProxyExecutor,
  // which must run on the untouched method shape — so we must NOT rewrite it here.
  const helper =
    `function _forgetQ4Session(a,b){if(!a||(429!==b&&403!==b))return!1;let c=!1;` +
    `for(let d of [${stores.join(",")}]){for(let e of d){let f=e[1];` +
    `if(f&&f.sessionId===a){d.delete(e[0]);c=!0}}}return c}`;

  const out = src.slice(0, cls.index) + helper + src.slice(cls.index);
  return out === src ? null : out;
}

// ─── Free-lane proxy transport backport (9router a76c2afc) ─────────────────

function patchFreeLaneProxyExecutor(src) {
  if (src.includes(EXEC_FULL_NEW)) return null;
  if (!src.includes(EXEC_FULL_OLD)) return null;
  const next = src.replace(EXEC_FULL_OLD, EXEC_FULL_NEW);
  if (next === src) return null;
  if (!next.includes(PROXY_FIX_MARK)) return null;
  return next;
}

function patchProxyFetchAdapter(src) {
  if (src.includes("b?.directFetch?.proxyCapable")) return null;
  // Real anchor in the minified 9router build (app/.next-cli-build/server/chunks/7525.js,
  // free-lane proxyAwareFetch): the MITM DNS-bypass branch starts here.
  const anchor = "if(function(a){try{let b=new URL(a).hostname;return r.some(a=>b.includes(a))}catch{return!1}}(d)){";
  const at = src.indexOf(anchor);
  if (at < 0) return null;
  const block = [
    "if(h&&b?.directFetch?.proxyCapable===!0){try{return await b.directFetch(a,{...b,proxyUrl:h},h)}catch(e){if(c?.strictProxy===!0)throw Error(`[ProxyFetch] Proxy required but failed (strictProxy=true): ${e.message}`);throw e}}",
    "",
  ].join("\n");
  const next = src.slice(0, at) + block + src.slice(at);
  if (next === src) return null;
  if (!next.includes("proxyCapable")) return null;
  return next;
}

function patchTlsSessionCache(src) {
  if (src.includes("sessionsByProxy")) return null;
  const declOld = 'let o=null;class p extends Error{constructor(a){super(a),this.name="OpencodeTlsUnavailableError"}}';
  if (!src.includes(declOld)) return null;
  const clMatch = /cipherList:"([^"]+)"/.exec(src);
  if (!clMatch) return null;
  const tlsBlock =
    'const sessionsByProxy=new Map;const SESSIONS_MAX=8;class p extends Error{constructor(a){super(a),this.name="OpencodeTlsUnavailableError"}};' +
    'function normalizeProxyKey(a){let b=String(a??"").trim();if(!b)return"";try{let c=new URL(b);let d=c.port?": "+c.port:"";return c.protocol+"/"+c.hostname+d}catch{return b}}' +
    'async function buildSession(a){let b=await (0,n.A)("wreq-js");if("function"!=typeof b.createSession)throw Error("wreq-js runtime is missing createSession");let c=await b.createSession({emulation:{tlsOptions:{cipherList:"' + clMatch[1] + '"}}});if(a){c.proxy=a}return Object.assign(c,{__proxyKey:normalizeProxyKey(a)})}' +
    'async function loadSession(a=""){let b=normalizeProxyKey(a);if(!sessionsByProxy.has(b)){if(sessionsByProxy.size>=SESSIONS_MAX){let c=sessionsByProxy.keys().next().value;let d=sessionsByProxy.get(c);sessionsByProxy.delete(c);d.then((e)=>e.close?.()).catch(()=>{})}let e=buildSession(a).catch((f)=>{sessionsByProxy.delete(b);throw f});sessionsByProxy.set(b,e)}return sessionsByProxy.get(b)}' +
    'function bunHop(a,b={},o={}){return new Promise((q)=>{let cp;try{cp=(0,c(31421).spawn)(process.env.OPENCODE_BUN_BIN||"bun",[process.env.OPENCODE_BUN_HOP||"/app/bun-hop.mjs"],{stdio:["pipe","pipe","inherit"]})}catch(e){q(Promise.reject(e));return}let z=JSON.stringify({url:a,method:b.method||"GET",headers:b.headers||{},body:"string"==typeof b.body?b.body:(b.body?JSON.stringify(b.body):void 0),proxy:o.proxyUrl||void 0,timeoutMs:o.timeoutMs||120000});cp.stdin.write(z);cp.stdin.end();let buf=Buffer.alloc(0),hdone=!1,st=0,ss="",hs={};cp.stdout.on("data",(d)=>{buf=Buffer.concat([buf,d]);if(!hdone){let nl=buf.indexOf(10);if(nl>=0){hdone=!0;try{let j=JSON.parse(buf.slice(0,nl).toString("utf8"));st=j.status;ss=j.statusText;hs=j.headers||{}}catch{}buf=buf.slice(nl+1)}}});cp.on("error",(e)=>q(Promise.reject(e)));cp.on("close",()=>q(new Response(new Uint8Array(buf),{status:st,statusText:ss,headers:hs})))})}';
  let out = src.replace(declOld, tlsBlock);
  const startAnchor = "async function q(){return o||";
  const start = out.indexOf(startAnchor);
  const endAnchor = "async function r(a,b={}";
  const end = out.indexOf(endAnchor, start);
  if (start < 0 || end < 0 || end < start) return null;
  const qNew = 'async function q(a=""){return loadSession(a)}';
  let next = out.slice(0, start) + qNew + out.slice(end);
  const sigOld = 'async function r(a,b={},{signal:c,timeoutMs:d=12e4}={}){let e;try{e=await q()}catch(a){';
  const sigNew = 'async function r(a,b={},{signal:c,timeoutMs:d=12e4,proxyUrl:pu=""}={}){if("bun"===(process.env.OPENCODE_TLS_ENGINE||""))return bunHop(a,b,{signal:c,timeoutMs:d,proxyUrl:pu});let e;try{e=await q(pu)}catch(a){';
  if (!next.includes(sigOld)) return null;
  next = next.replace(sigOld, sigNew);
  const tailOld = 'let g=await e.fetch(a,f),h={};return g.headers?.forEach?.((a,b)=>{h[b]=a}),new Response(g.body,{status:g.status,statusText:g.statusText,headers:h})}';
  const tailNew = 'let g=await e.fetch(a,f),h={};g.headers?.forEach?.((a,b)=>{h[b]=a});if(pu){h["x-9r-proxy-via"]=e.__proxyKey||"wreq-js-proxy"}return new Response(g.body,{status:g.status,statusText:g.statusText,headers:h})}';
  if (!next.includes(tailOld)) return null;
  next = next.replace(tailOld, tailNew);
  if (next.includes("async function q(){return o||")) return null;
  if (!next.includes("sessionsByProxy")) return null;
  return next;
}

function patchFreeLaneProxy(src) {
  if (src.includes(PROXY_FIX_MARK)) return { out: src, applied: 0 };
  let out = src;
  let applied = 0;
  const steps = [patchFreeLaneProxyExecutor, patchProxyFetchAdapter, patchTlsSessionCache];
  for (const step of steps) {
    const res = step(out);
    if (res) {
      out = res;
      applied++;
    }
  }
  return { out, applied };
}

function scanCallEnd(src, from) {
  let depth = 0;
  let quote = "";
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i + 1;
  }
  return -1;
}

function uniqueName(src, base) {
  let name = base;
  let n = 0;
  while (src.includes(name)) name = base + (++n);
  return name;
}

function run(options = {}) {
  const applied = { provider: 0, catalog: 0, capabilities: 0, version: 0, relay: 0, session: 0, freelanProxy: 0, proxyTest: 0, changed: 0 };
  const state = { provider: false, catalog: false, capabilities: false, version: false, relay: false, relayTemplates: false, session: false, freelanProxy: false, proxyTest: false, proxyTestTarget: false };
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
    const session = patchSession(out);
    if (session) { out = session; applied.session++; }
    const freelanProxy = patchFreeLaneProxy(out);
    if (freelanProxy.applied) {
      out = freelanProxy.out;
      applied.freelanProxy += freelanProxy.applied;
    }
    const proxy = proxyPatch.patchSource(out);
    if (proxy.changed) {
      out = proxy.out;
      if (proxy.applied.relay) applied.relay++;
      if (proxy.applied.proxyTest) applied.proxyTest++;
    }

    if (out !== src) pending.push([file, out]);

    if (out.includes('"union-alpha-free"') && /,_injectQ4\(\w+\)/.test(out)) state.provider = true;
    if (out.includes(CATALOG_ANCHORS[0][1]) || out.includes(CATALOG_ANCHORS[1][1])) state.catalog = true;
    if (out.includes(CAP_FREE)) state.capabilities = true;
    if (out.includes(VERSION_DONE)) state.version = true;
    if (proxyPatch.sourceMarks(out).relay) state.relay = true;
    if (src.includes(proxyPatch.RELAY_TEMPLATE_ANCHOR)) state.relayTemplates = true;
    if (out.includes(SESSION_MARK)) state.session = true;
    if (out.includes(PROXY_FIX_MARK)) state.freelanProxy = true;
    if (proxyPatch.sourceMarks(out).proxyTest) state.proxyTest = true;
    if (src.includes(proxyPatch.PROXY_TEST_ANCHOR)) state.proxyTestTarget = true;
  }

  const missing = [];
  if (!state.provider) missing.push("opencode provider module (routing Set / transformRequest anchors)");
  if (!state.catalog) missing.push("opencode provider model list (union-alpha entry)");
  if (!state.capabilities) missing.push("model capability map (union-alpha entry)");
  if (!state.version) missing.push("version route (npm update-check response)");
  if (state.relayTemplates && !state.relay) missing.push("proxy pool relay templates (client IP forwarding)");
  if (!state.freelanProxy) missing.push("free-lane proxy transport anchors not found (opencode executor / proxy fetch / TLS session cache)");
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

function testSessionPatch() {
  const foreign = [
    'class Go extends f.H{constructor(){super("opencode-go")}',
    'async execute(a){let b=this.prepareRequestCredentials(a);return super.execute({...a,credentials:b})}',
    'prepareRequestCredentials(){return{}}}'
  ].join("\n");
  const sample = [
    'let u="x-opencode-session",v="_opencodeSession",w=/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;',
    "let E=new Map,F=setInterval(()=>{let a=Date.now();for(let[b,c]of E)a-c.lastUsed>h.v1.sessionTtlMs&&E.delete(b)},h.v1.sessionCleanupIntervalMs);",
    "let I=new Map,J=setInterval(()=>{let a=Date.now();for(let[b,c]of I)a-c.lastUsed>h.v1.sessionTtlMs&&I.delete(b)},h.v1.sessionCleanupIntervalMs);",
    'class M extends f.H{constructor(){super("opencode",g.xq.opencode)}async execute(a){let b=this.prepareRequestCredentials(a);return super.execute({...a,credentials:b,directFetch:(a,b)=>r(a,{method:b.method,headers:b.headers,body:b.body},{signal:b.signal})})}buildUrl(a){return 1}}'
  ].join("\n");
  const withForeign = foreign + "\n" + sample;

  const out = patchSession(withForeign);
  if (!out) return "session patch did not match the executor anchor";
  if (!out.includes(SESSION_MARK)) return "session patch did not install the forget helper";
  if (!out.includes("for(let d of [E,I])")) return "session patch did not bind the two session stores";
  if (!out.includes("_opencodeSession")) return "session patch dropped the session field lookup";
  if (!out.includes("429!==b&&403!==b")) return "session patch dropped the status gate";
  // The proxy executor patch must still be able to match the untouched execute
  // method, so the session patch must not rewrite it.
  if (!out.includes('directFetch:(a,b)=>r(a,{method:b.method,headers:b.headers,body:b.body},{signal:b.signal})')) return "session patch rewrote the execute method (breaks the proxy patch)";
  if (patchSession(out) !== null) return "session patch is not idempotent";
  try {
    new Function(out);
  } catch (err) {
    return "session patch produced invalid JavaScript: " + err.message;
  }

  try {
    const helper = out.slice(out.indexOf(SESSION_MARK), out.indexOf("class M extends"));
    const probe = [
      'let E=new Map([["k1",{sessionId:"ses_a"}],["k2",{sessionId:"ses_b"}]]);',
      'let I=new Map([["x",{sessionId:"ses_a"}]]);',
      helper,
      'let r1=_forgetQ4Session("ses_a",429);',
      'let r2=[E.size,I.size];',
      'let r3=_forgetQ4Session("ses_a",200);',
      'let r4=E.size;',
      'let r5=_forgetQ4Session("",429);',
      "return [r1,r2[0],r2[1],r3,r4,r5]"
    ].join("\n");
    const got = new Function(probe)();
    const want = [true, 1, 0, false, 1, false];
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      return `session patch forget helper returned ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`;
    }
  } catch (err) {
    return "session patch forget helper threw: " + err.message;
  }

  const unrelated = 'class M extends f.H{constructor(){super("bedrock")}async execute(a){return 1}}';
  if (patchSession(unrelated) !== null) return "session patch modified an unrelated provider";
  const noStores = 'class M extends f.H{constructor(){super("opencode")}async execute(a){let b=this.prepareRequestCredentials(a);return super.execute({...a,credentials:b})}}';
  if (patchSession(noStores) !== null) return "session patch matched without the session stores";
  return null;
}

function testFreeLaneProxy() {
  // Backport of upstream 9router a76c2afc: "fix(opencode): carry the selected
  // proxy through the wreq-js transport". Executor must forward the resolved
  // proxy URL through the adapter and mark it proxy-capable; proxyAwareFetch
  // must route through the adapter when the adapter opts in; the TLS session
  // cache must be keyed by proxy URL.

  const execSample = [
    'class M extends f.H{constructor(){super("opencode",g.xq.opencode)}async execute(a){let b=this.prepareRequestCredentials(a);return super.execute({...a,credentials:b,directFetch:(a,b)=>r(a,{method:b.method,headers:b.headers,body:b.body},{signal:b.signal})})}}',
  ].join("\n");
  const execPatched = patchFreeLaneProxyExecutor(execSample);
  if (!execPatched) return "free-lane proxy patch (executor) did not match the anchors";
  if (!execPatched.includes("proxyCapable")) return "free-lane proxy patch (executor) did not mark the adapter proxy-capable";
  if (!execPatched.includes("proxyUrl:f")) return "free-lane proxy patch (executor) did not forward the proxy URL";
  if (!execPatched.includes("_forgetQ4Session(b&&b._opencodeSession")) return "free-lane proxy patch (executor) did not install the session-eviction call";
  if (!execPatched.includes("OPENCODE_SESSION_MAX_USES")) return "free-lane proxy patch (executor) did not install preemptive session rotation";
  if (patchFreeLaneProxyExecutor(execPatched) !== null) return "free-lane proxy patch (executor) is not idempotent";

  const fetchSample = [
    'async function G(a,b={},c=null){let h=null,i=c?.forceFreshSocket===!0||b?.forceFreshSocket===!0;if(function(a){try{let b=new URL(a).hostname;return r.some(a=>b.includes(a))}catch{return!1}}(d)){if(h)try{return await E(a,b,h,i)}catch(a){if(c?.strictProxy===!0)throw Error(`[ProxyFetch] Proxy required but failed (strictProxy=true): ${a.message}`);throw a}}return E(a,b,null,i)}',
  ].join("\n");
  const fetchPatched = patchProxyFetchAdapter(fetchSample);
  if (!fetchPatched) return "free-lane proxy patch (proxyFetch adapter) did not match the anchors";
  if (!fetchPatched.includes("b?.directFetch?.proxyCapable")) return "free-lane proxy patch (proxyFetch adapter) did not install the adapter branch";
  if (patchProxyFetchAdapter(fetchPatched) !== null) return "free-lane proxy patch (proxyFetch adapter) is not idempotent";

  const tlsSample = [
    'let o=null;class p extends Error{constructor(a){super(a),this.name="OpencodeTlsUnavailableError"}}',
    'async function q(){return o||(o=(async()=>{let a=await (0,n.A)("wreq-js");if("function"!=typeof a.createSession)throw Error("wreq-js runtime is missing createSession");return a.createSession({emulation:{tlsOptions:{cipherList:"TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-ECDSA-AES128-SHA:ECDHE-RSA-AES128-SHA:ECDHE-ECDSA-AES256-SHA:ECDHE-RSA-AES256-SHA:AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA"}}})})().catch(a=>{throw o=null,a})),o}',
    'async function r(a,b={},{signal:c,timeoutMs:d=12e4}={}){let e;try{e=await q()}catch(a){throw new p(`wreq-js unavailable (${a instanceof Error?a.message:"unknown"}) — install the optional wreq-js dependency to reach the OpenCode free tier`)}let f={method:b.method||"GET",headers:b.headers,redirect:"follow",timeout:d};void 0!==b.body&&(f.body=b.body),c&&(f.signal=c);let g=await e.fetch(a,f),h={};return g.headers?.forEach?.((a,b)=>{h[b]=a}),new Response(g.body,{status:g.status,statusText:g.statusText,headers:h})}',
  ].join("\n");
  const tlsPatched = patchTlsSessionCache(tlsSample);
  if (!tlsPatched) return "free-lane proxy patch (tls session cache) did not match the anchors";
  if (!tlsPatched.includes("sessionsByProxy")) return "free-lane proxy patch (tls session cache) did not install the proxy-keyed cache";
  if (tlsPatched.includes("let o=null")) return "free-lane proxy patch (tls session cache) left the old session cache in place";
  if (tlsPatched.includes("let sessionPromise")) return "free-lane proxy patch (tls session cache) left the old session promise in place";

  return null;
}

async function selfTest() {
  return (
    testInjector() ||
    testProviderPatch() ||
    testVersionPatch() ||
    testSessionPatch() ||
    testFreeLaneProxy() ||
    (await proxyPatch.selfTest())
  );
}

async function start() {
  const result = run();

  if (!result.ok) {
    console.error("ERROR: opencode patch failed: " + result.reason);
    process.exit(1);
  }

  const fail = await selfTest();
  if (fail) {
    console.error("ERROR: opencode patch self-test failed: " + fail);
    process.exit(1);
  }

  const ver = result.version ? ` 9router=${result.version}` : "";
  const written = result.files.length ? " files=" + result.files.join(",") : "";
  console.log(
    `opencode patch: provider=${result.applied.provider} catalog=${result.applied.catalog} capabilities=${result.applied.capabilities} version=${result.applied.version} relay=${result.applied.relay} session=${result.applied.session} freelanProxy=${result.applied.freelanProxy} proxyTest=${result.applied.proxyTest} (${result.applied.changed} chunk(s) written)${ver}${written}`
  );
  if (!result.state.session) {
    console.warn("WARN: opencode session cache anchor not found; a 429 still needs a manual restart");
  }
  if (result.state.proxyTestTarget && !result.state.proxyTest) {
    console.warn("WARN: proxy pool test route anchor not found; bare host:port proxies will still fail the dashboard test");
  }

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

module.exports = {
  run,
  selfTest,
  findBuild,
  collectFiles,
  testInjector,
  testProviderPatch,
  testVersionPatch,
  testSessionPatch,
  testFreeLaneProxy,
  patchProvider,
  patchVersion,
  patchSession,
  patchFreeLaneProxy,
  patchFreeLaneProxyExecutor,
  patchProxyFetchAdapter,
  patchTlsSessionCache,
  proxyPatch
};

if (require.main === module) {
  if (process.argv[2] === "--start") start();
  else {
    (async () => {
      const result = run();
      const fail = await selfTest();
      console.log(JSON.stringify({ ...result, selfTest: fail || "ok" }, null, 2));
      if (fail) process.exit(1);
      if (!result.ok) {
        console.error("ERROR: opencode patch skipped: " + result.reason);
        process.exit(1);
      }
    })();
  }
}
