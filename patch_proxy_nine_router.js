const fs = require("fs");
const path = require("path");

const RELAY_MARK = "relayClientIp";

const RELAY_TEMPLATE_ANCHOR = '"x-relay-target"';

const PROXY_TEST_MARK = "function _proxyProbe9r(";

const PROXY_TEST_ANCHOR = '"proxyUrl is required"';

const PROXY_TEST_FN_RE = /async function ([$\w]+)\(\{proxyUrl:/;

const PROXY_AGENT_RE = /new ([$\w]+)\.ProxyAgent\(\{uri:([$\w]+)\}\)/;

const PROXY_HEAD_RE = /await \(0,([$\w]+)\.fetch\)\(([$\w]+),\{method:"HEAD",dispatcher:([$\w]+),signal:([$\w]+)\.signal,headers:\{"User-Agent":"9Router"\}\}\)/;

const PROXY_TEST_HELPER =
  'async function _proxyProbe9r(a,b,c,d,e){' +
  'let f=async(g,h)=>{let i=await a.fetch(b,{method:g,dispatcher:h,signal:e,headers:{"User-Agent":"9Router"}});' +
  'if("HEAD"!==g)try{await i.body?.cancel?.()}catch{}return i};' +
  'try{let g=await f("HEAD",c);if(!g.ok)g=await f("GET",c);return g}' +
  'catch(g){let h=g&&g.cause||g||{},i=String(h.code||h.name||"")+" "+String(h.message||"");' +
  'if(!/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|ALTNAME/i.test(i))throw g;' +
  'let j=new a.ProxyAgent({uri:d,connect:{rejectUnauthorized:!1},requestTls:{rejectUnauthorized:!1}});' +
  'try{let k=await f("HEAD",j);if(!k.ok)k=await f("GET",j);return k}finally{try{await j.close()}catch{}}}}';

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

function patchRelay(src) {
  if (!src.includes(RELAY_TEMPLATE_ANCHOR)) return null;
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

function patchProxyTest(src) {
  if (src.includes(PROXY_TEST_MARK)) return null;

  const required = src.indexOf(PROXY_TEST_ANCHOR);
  if (required < 0) return null;

  const window = src.slice(required, required + 4000);

  const agent = PROXY_AGENT_RE.exec(window);
  if (!agent) return null;
  const agentIndex = required + agent.index;
  const uriVar = agent[2];

  const guard = src.lastIndexOf("try{", agentIndex);
  if (guard < 0 || agentIndex - guard > 200) return null;

  const fnIndex = src.lastIndexOf("async function ", required);
  if (fnIndex < 0) return null;
  const fn = PROXY_TEST_FN_RE.exec(src.slice(fnIndex, required));
  if (!fn) return null;

  const head = PROXY_HEAD_RE.exec(window);
  if (!head) return null;
  const fetchIndex = required + head.index;
  if (fetchIndex < agentIndex) return null;

  const normalize = `if(${uriVar}.indexOf("://")<0)${uriVar}="http://"+${uriVar};`;
  const probe = `await _proxyProbe9r(${head[1]},${head[2]},${head[3]},${uriVar},${head[4]}.signal)`;

  let out =
    src.slice(0, fnIndex) +
    PROXY_TEST_HELPER +
    src.slice(fnIndex, guard + 4) +
    normalize +
    src.slice(guard + 4, fetchIndex) +
    probe +
    src.slice(fetchIndex + head[0].length);

  out = out.replace(/Math\.min\(([$\w]+),3e4\):8e3/, "Math.min($1,3e4):2e4");

  return out === src ? null : out;
}

function patchSource(src) {
  let out = src;
  const applied = { relay: false, proxyTest: false };

  const relay = patchRelay(out);
  if (relay) {
    out = relay;
    applied.relay = true;
  }

  const proxyTest = patchProxyTest(out);
  if (proxyTest) {
    out = proxyTest;
    applied.proxyTest = true;
  }

  return { out, applied, changed: out !== src };
}

function sourceAnchors(src) {
  return {
    relayTemplate: src.includes(RELAY_TEMPLATE_ANCHOR),
    proxyTestTarget: src.includes(PROXY_TEST_ANCHOR)
  };
}

function sourceMarks(src) {
  return {
    relay: src.includes(RELAY_MARK),
    proxyTest: src.includes(PROXY_TEST_MARK)
  };
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

function writeFile(file, src) {
  const tmp = file + ".9r-proxy-tmp";
  try {
    fs.writeFileSync(tmp, src);
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    return err.message;
  }
  return null;
}

function run(build) {
  const applied = { relay: 0, proxyTest: 0, changed: 0 };
  const files = [];

  for (const file of collectFiles(build)) {
    const src = fs.readFileSync(file, "utf8");
    const patched = patchSource(src);
    if (!patched.changed) continue;
    const failure = writeFile(file, patched.out);
    if (failure) return { ok: false, reason: `write failed for ${file}: ${failure}`, applied, files };
    if (patched.applied.relay) applied.relay++;
    if (patched.applied.proxyTest) applied.proxyTest++;
    applied.changed++;
    files.push(file);
  }

  return { ok: true, applied, files };
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

async function testProxyTestPatch() {
  const sample =
    'var d=c(9956);function e(a){return null==a?"":String(a).trim()}async function f({proxyUrl:a,testUrl:b,timeoutMs:c}={}){let g,h=e(a);if(!h)return{ok:!1,status:400,error:"proxyUrl is required"};let i=e(b)||"https://google.com/",j=Number(c),k=Number.isFinite(j)&&j>0?Math.min(j,3e4):8e3;try{try{g=new d.ProxyAgent({uri:h})}catch(a){return{ok:!1,status:400,error:`Invalid proxy URL: ${a?.message||String(a)}`}}let a=new AbortController,b=Date.now(),c=setTimeout(()=>a.abort(),k);try{let c=await (0,d.fetch)(i,{method:"HEAD",dispatcher:g,signal:a.signal,headers:{"User-Agent":"9Router"}});return{ok:c.ok,status:c.status,statusText:c.statusText,url:i,elapsedMs:Date.now()-b}}catch(b){let a=b?.name==="AbortError"?"Proxy test timed out":function(a){if(!a)return"Unknown error";let b=a?.message||String(a),c=a?.cause?.code||a?.code,d=a?.cause?.message;return d&&d!==b?c?`${b}: ${d} (${c})`:`${b}: ${d}`:c&&!b.includes(c)?`${b} (${c})`:b}(b);return{ok:!1,status:500,error:a}}finally{clearTimeout(c)}}finally{try{await g?.close?.()}catch{}}}';

  const out = patchProxyTest(sample);
  if (!out) return "proxy test patch did not match the route anchors";
  if (!out.includes(PROXY_TEST_MARK)) return "proxy test patch did not install the probe helper";
  if (!out.includes('indexOf("://")<0')) return "proxy test patch did not normalize the proxy URL";
  if (!out.includes("Math.min(j,3e4):2e4")) return "proxy test patch did not raise the default timeout";
  if (patchProxyTest(out) !== null) return "proxy test patch is not idempotent";
  try {
    new Function(out);
  } catch (err) {
    return "proxy test patch produced invalid JavaScript: " + err.message;
  }

  const make = plan => {
    const state = { agents: [], methods: [] };
    const undici = {
      ProxyAgent: class {
        constructor(opts) {
          if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(String(opts.uri))) throw new Error("Invalid URL");
          this.uri = opts.uri;
          this.insecure = !!(opts.requestTls && opts.requestTls.rejectUnauthorized === false);
          state.agents.push(this);
        }
        async close() {}
      },
      fetch: async (url, opts) => {
        const index = state.methods.length;
        state.methods.push(opts.method);
        const step = plan[index];
        if (!step) throw new Error("unexpected fetch call " + index);
        if (step.error) throw step.error;
        return { ok: step.ok !== false, status: step.status || 200, statusText: "OK", body: null };
      }
    };
    const fn = new Function("c", "d", "b", out + ";return f;")(() => undici, () => {}, {});
    return { state, run: args => fn(args) };
  };

  const bare = make([{ ok: true }]);
  const bareResult = await bare.run({ proxyUrl: "60.12.215.23:7302" });
  if (!bareResult.ok) return "proxy test patch rejected a bare host:port proxy URL";
  if (bare.state.agents[0].uri !== "http://60.12.215.23:7302") return "proxy test patch did not prefix the missing scheme";

  const fallback = make([{ ok: false, status: 403 }, { ok: true }]);
  const fallbackResult = await fallback.run({ proxyUrl: "http://1.2.3.4:8080" });
  if (!fallbackResult.ok) return "proxy test patch did not fall back to GET after a failed HEAD";
  if (fallback.state.methods.join(",") !== "HEAD,GET") return "proxy test patch ran the wrong request methods";
  if (fallback.state.agents[0].uri !== "http://1.2.3.4:8080") return "proxy test patch rewrote an URL that already had a scheme";

  const tlsError = new Error("fetch failed");
  tlsError.cause = { code: "DEPTH_ZERO_SELF_SIGNED_CERT", message: "self-signed certificate" };
  const insecure = make([{ error: tlsError }, { ok: true }]);
  const insecureResult = await insecure.run({ proxyUrl: "2.27.154.28:3128" });
  if (!insecureResult.ok) return "proxy test patch did not retry a self-signed proxy insecurely";
  if (!insecure.state.agents[1] || insecure.state.agents[1].insecure !== true) return "proxy test patch retried with a verifying agent";
  if (insecure.state.methods.join(",") !== "HEAD,HEAD") return "proxy test patch retried the wrong request method";

  const abort = new Error("aborted");
  abort.name = "AbortError";
  const timedOut = make([{ error: abort }]);
  const timedOutResult = await timedOut.run({ proxyUrl: "1.2.3.4:8080" });
  if (timedOutResult.ok !== false) return "proxy test patch reported an aborted probe as ok";
  if (timedOut.state.agents.length !== 1) return "proxy test patch retried an aborted probe insecurely";

  if (patchProxyTest("const x = 1;") !== null) return "proxy test patch modified a file without the route";
  return null;
}

async function selfTest() {
  return testRelayPatch() || (await testProxyTestPatch());
}

function resolveBuild(arg) {
  const entry = require("./patch_opencode_nine_router.js");
  return entry.findBuild(arg);
}

async function main() {
  const arg = process.argv[2];
  const build = resolveBuild(arg);
  if (!build) {
    console.error("ERROR: 9router build dir not found");
    process.exit(1);
  }

  const fail = await selfTest();
  if (fail) {
    console.error("ERROR: proxy pool patch self-test failed: " + fail);
    process.exit(1);
  }

  const result = run(build);
  console.log(
    `proxy pool patch: relay=${result.applied.relay} proxyTest=${result.applied.proxyTest} (${result.applied.changed} chunk(s) written) build=${build}` +
    (result.files.length ? " files=" + result.files.join(",") : "")
  );
  if (!result.ok) {
    console.error("ERROR: proxy pool patch failed: " + result.reason);
    process.exit(1);
  }
}

module.exports = {
  RELAY_MARK,
  RELAY_TEMPLATE_ANCHOR,
  PROXY_TEST_MARK,
  PROXY_TEST_ANCHOR,
  patchRelay,
  patchProxyTest,
  patchSource,
  sourceAnchors,
  sourceMarks,
  collectFiles,
  run,
  selfTest,
  testRelayPatch,
  testProxyTestPatch
};

if (require.main === module) main();
