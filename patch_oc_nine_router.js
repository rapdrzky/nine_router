const fs = require("fs");
const path = require("path");

const SKIP = new Set(["proc", "sys", "dev", ".git", "tmp", "socket", "run"]);

function locate(start, maxDepth) {
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
    // 0.5.86: module 4493 lives in 5330.js
    if (fs.existsSync(path.join(dir, "server", "chunks", "5330.js"))) return dir;
    for (const ent of entries) {
      if (ent.isDirectory() && !SKIP.has(ent.name)) {
        stack.push([path.join(dir, ent.name), depth + 1]);
      }
    }
  }
  return null;
}

const CLAUDE_MODELS = [
  { id: "union-alpha", name: "Union Alpha Free", targetFormat: "claude" },
  { id: "union-alpha-free", name: "Union Alpha Free", targetFormat: "claude" }
];

const CAP_ANCHOR = `"muse-spark-1.2-contributor-free":{vision:!0,reasoning:!0,thinkingFormat:"openai",contextWindow:1048576,maxOutput:131072}`;
// 0.5.86: union-alpha already exists in capability map but missing reasoning+thinkingFormat
const CAP_EXTRA = `,"union-alpha-free":{vision:!0,reasoning:!0,thinkingFormat:"anthropic",contextWindow:262144,maxOutput:131072}`;

const PATCHES = [
  // PATCH 1: Inject union-alpha-free into the free-tier Set and add _Q4 tool definitions
  // in module 4493 (5330.js). Also add union-alpha-free to the routing Set.
  {
    files: [["server", "chunks", "5330.js"]],
    fn(c) {
      // Add "union-alpha-free" to the muse-spark free-tier Set
      const setAnchor = 'new Set(["muse-spark-1.2-contributor-free","muse-spark-1.3-contributor-free"])';
      const setReplacement = 'new Set(["muse-spark-1.2-contributor-free","muse-spark-1.3-contributor-free","union-alpha-free"])';
      let out = c.replace(setAnchor, setReplacement);

      // Add "union-alpha-free" to the union-alpha routing Set (w)
      const routingAnchor = 'w=new Set(["union-alpha"])';
      const routingReplacement = 'w=new Set(["union-alpha","union-alpha-free"])';
      out = out.replace(routingAnchor, routingReplacement);

      // Inject _Q4 tool definitions and _injectQ4 helper after the Set declarations
      // Find the insertion point: after "x=0,y=0;"
      const toolsDecl = `x=0,y=0;`;
      const toolsInsert = `x=0,y=0;let _Q4=[{type:"function",function:{name:"bash",description:"Run shell commands",parameters:{type:"object",properties:{command:{type:"string"}},required:["command"]}}},{type:"function",function:{name:"glob",description:"Find files by pattern",parameters:{type:"object",properties:{pattern:{type:"string"}},required:["pattern"]}}},{type:"function",function:{name:"grep",description:"Search file contents",parameters:{type:"object",properties:{pattern:{type:"string"},path:{type:"string"}},required:["pattern","path"]}}},{type:"function",function:{name:"read",description:"Read file contents",parameters:{type:"object",properties:{path:{type:"string"}},required:["path"]}}}];function _injectQ4(b){if(!b||typeof b!=="object")return;b.stream=!0;if(!Array.isArray(b.tools))b.tools=[];let have=new Set(b.tools.map(t=>t?.function?.name||"").filter(Boolean));for(let t of _Q4)if(!have.has(t.function.name))b.tools.push(t)}`;
      // Guard: toolsInsert starts with toolsDecl, so without this check a second
      // container start would re-declare _Q4 (SyntaxError) on the persisted fs.
      if (!out.includes("let _Q4=[")) out = out.replace(toolsDecl, toolsInsert);

      // Inject model mapping and tool injection at start of transformRequest
      // Original starts with: transformRequest(a,b,c,d){if(b&&"object"==typeof b&&a&&!b.model&&(b.model=a),b&&"object"==typeof b&&(b.stream=!0)
      const trAnchor = 'transformRequest(a,b,c,d){if(b&&"object"==typeof b&&a&&!b.model&&(b.model=a),b&&"object"==typeof b&&(b.stream=!0)';
      const trReplacement = 'transformRequest(a,b,c,d){if(b&&"object"==typeof b&&a&&(b.model==="union-alpha-free"&&(b.model="union-alpha"),!b.model&&(b.model=a)),b&&"object"==typeof b&&(b.stream=!0),_injectQ4(b)';
      out = out.replace(trAnchor, trReplacement);

      return out === c ? null : out;
    }
  },
  // PATCH 2: Add union-alpha-free to opencode provider model list
  // union-alpha already exists in 0.5.86; just inject union-alpha-free after it
  {
    files: [
      ["server", "chunks", "235.js"],
      ["server", "chunks", "4895.js"],
      ["server", "chunks", "8325.js"]
    ],
    fn(c) {
      // Add union-alpha-free after union-alpha in supportedFormats arrays
      const uaEntry = '{id:"union-alpha",name:"Union Alpha",supportedFormats:["claude"]}';
      const uaFreeEntry = '{id:"union-alpha-free",name:"Union Alpha Free",supportedFormats:["claude"]}';
      let out = c;
      if (out.includes(uaEntry) && !out.includes('union-alpha-free')) {
        out = out.replace(uaEntry, uaEntry + ',' + uaFreeEntry);
      }
      // Also handle models:[...] format with targetFormat
      const uaModel = '{"id":"union-alpha","name":"Union Alpha Free","targetFormat":"claude"}';
      const uaFreeModel = '{"id":"union-alpha-free","name":"Union Alpha Free","targetFormat":"claude"}';
      if (out.includes(uaModel) && !out.includes('union-alpha-free')) {
        out = out.replace(uaModel, uaModel + ',' + uaFreeModel);
      }
      return out === c ? null : out;
    }
  },
  // PATCH 3: Add union-alpha-free to capability map
  // union-alpha already exists but missing reasoning+thinkingFormat; union-alpha-free is new
  {
    files: [
      ["server", "chunks", "24.js"],
      ["server", "chunks", "412.js"],
      ["server", "chunks", "8402.js"]
    ],
    fn(c) {
      // First: update existing union-alpha entry to include reasoning+thinkingFormat
      const uaOld = '"union-alpha":{vision:!0,contextWindow:262144,maxOutput:131072}';
      const uaNew = '"union-alpha":{vision:!0,reasoning:!0,thinkingFormat:"anthropic",contextWindow:262144,maxOutput:131072}';
      let out = c.replace(uaOld, uaNew);

      // Then: add union-alpha-free after the muse-spark-1.2 anchor
      if (out.includes(CAP_ANCHOR) && !out.includes('"union-alpha-free"')) {
        out = out.replace(CAP_ANCHOR, CAP_ANCHOR + CAP_EXTRA);
      }

      return out === c ? null : out;
    }
  }
];

function patch() {
  const roots = [process.argv[2] === "--start" ? null : process.argv[2], process.cwd(), "/app", "/root", "/home", "/usr", "/var", "/opt", "/"].filter(Boolean);
  let build = null;
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    build = locate(root, root === "/" ? 5 : 6);
    if (build) break;
  }
  if (!build) return false;

  for (const { files, fn } of PATCHES) {
    for (const rel of files) {
      const file = path.join(build, ...rel);
      if (!fs.existsSync(file)) continue;
      const src = fs.readFileSync(file, "utf8");
      const out = fn(src);
      if (out && out !== src) fs.writeFileSync(file, out);
    }
  }
  return true;
}

function start() {
  if (!patch()) {
    console.error("ERROR: opencode patch failed or build dir not found");
    process.exit(1);
  }

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

if (process.argv[2] === "--start") start();
else patch();
