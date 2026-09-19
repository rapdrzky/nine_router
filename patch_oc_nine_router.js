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
    if (fs.existsSync(path.join(dir, "server", "chunks", "318.js"))) return dir;
    for (const ent of entries) {
      if (ent.isDirectory() && !SKIP.has(ent.name)) {
        stack.push([path.join(dir, ent.name), depth + 1]);
      }
    }
  }
  return null;
}

const MODULE_4493 = `4493:(a,b,c)=>{c.d(b,{j:()=>p});var d=c(55511),e=c.n(d),f=c(74957),g=c(35024),h=c(72239),i=c(86724),j=c(80662),k=c(59096);let l=new Set(["muse-spark-1.2-contributor-free","muse-spark-1.3-contributor-free"]);let _Q4=[{type:"function",function:{name:"bash",description:"Run shell commands",parameters:{type:"object",properties:{command:{type:"string"}},required:["command"]}}},{type:"function",function:{name:"glob",description:"Find files by pattern",parameters:{type:"object",properties:{pattern:{type:"string"}},required:["pattern"]}}},{type:"function",function:{name:"grep",description:"Search file contents",parameters:{type:"object",properties:{pattern:{type:"string"},path:{type:"string"}},required:["pattern","path"]}}},{type:"function",function:{name:"read",description:"Read file contents",parameters:{type:"object",properties:{path:{type:"string"}},required:["path"]}}}];function _b62(p){let ch="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",hx=Date.now().toString(16).padStart(12,"0").slice(-12),rd="",by=require("crypto").randomBytes(14);for(let i=0;i<14;i++)rd+=ch[by[i]%62];return p+hx+rd}function m(){return _b62("ses_")}function n(a){return String(a||"").replace(/\\([^()]+\\)\\s*$/,"").trim()}function o(a){let b=n(a);return l.has(b)||(0,k.nh)(b)}function _isU(a){let b=n(a).toLowerCase();return b==="union-alpha"||b==="union-alpha-free"||b.includes("union-alpha")}function _injectQ4(b){if(!b||typeof b!=="object")return;b.stream=!0;if(!Array.isArray(b.tools))b.tools=[];let have=new Set(b.tools.map(t=>t?.function?.name||"").filter(Boolean));for(let t of _Q4)if(!have.has(t.function.name))b.tools.push(t)}class p extends f.H{constructor(){super("opencode",g.xq.opencode),this._currentSessionId=null}transformRequest(a,b,c,d){let e;b&&b.model==="union-alpha-free"&&(b.model="union-alpha");_injectQ4(b);return this._currentSessionId=(e=d?.rawHeaders||{},(0,j.oV)({headers:e,body:b,connectionId:d?.connectionId,scope:"opencode",generate:m})),o(a)&&(void 0===b.max_output_tokens&&(void 0!==b.max_completion_tokens?b.max_output_tokens=b.max_completion_tokens:void 0!==b.max_tokens&&(b.max_output_tokens=b.max_tokens)),delete b.max_tokens,delete b.max_completion_tokens,!function(a,b){let c=b.reasoning,d=c&&"object"==typeof c&&!Array.isArray(c)?c:null,e="string"==typeof b.reasoning_effort?b.reasoning_effort:d?.effort;if("string"!=typeof e)return;let f=n(a||b.model),g=(0,h.k)("opencode",f),i=e.toLowerCase().trim();("max"===i||"ultra"===i)&&g?.length&&!g.includes(i)&&("ultra"===i&&g.includes("max")?i="max":g.includes("xhigh")&&(i="xhigh")),b.reasoning={...d,effort:i},b.reasoning.summary||(b.reasoning.summary="auto"),delete b.reasoning_effort}(a,b)),(0,i.Z)({provider:this.provider,model:a,body:b})}buildUrl(a){let b=this.config.baseUrl;return _isU(a)?\`\${b}/zen/v1/messages\`:o(a)?\`\${b}/zen/v1/responses\`:\`\${b}/zen/v1/chat/completions\`}buildHeaders(a,b=!0,u_url,u_model){let c=a?.rawHeaders||{},d={};for(let[a,b]of Object.entries(c))d[a.toLowerCase()]=b;let f=d["user-agent"]||"",ua=/opencode\\/\\d+/i.test(f)?f:"opencode/1.18.31",isC=_isU(u_model)||(u_url&&u_url.includes("/messages")),ses=d["x-opencode-session"]||this._currentSessionId||m(),req=d["x-opencode-request"]||_b62("msg_");ses.startsWith("ses_")&&ses.length===30||(ses=m());req.startsWith("msg_")&&req.length===30||(req=_b62("msg_"));let hdrs={"Content-Type":"application/json",Authorization:"Bearer public","User-Agent":ua,"x-opencode-client":"desktop","x-opencode-session":ses,"x-opencode-request":req,"x-opencode-project":d["x-opencode-project"]||"global",Accept:b?"text/event-stream":"*/*"};if(isC){hdrs["anthropic-version"]="2023-06-01";}return hdrs;}}}`

const CLAUDE_MODELS = [
  { id: "union-alpha", name: "Union Alpha Free", targetFormat: "claude" },
  { id: "union-alpha-free", name: "Union Alpha Free", targetFormat: "claude" }
];

const CAP_ANCHOR = `"muse-spark-1.2-contributor-free":{vision:!0,reasoning:!0,thinkingFormat:"openai",contextWindow:1048576,maxOutput:131072}`;
const CAP_EXTRA = `"union-alpha":{vision:!0,reasoning:!0,thinkingFormat:"anthropic",contextWindow:262144,maxOutput:131072},"union-alpha-free":{vision:!0,reasoning:!0,thinkingFormat:"anthropic",contextWindow:262144,maxOutput:131072},`;

const PATCHES = [
  {
    files: [["server", "chunks", "318.js"]],
    fn(c) {
      const start = c.indexOf("4493:(a,b,c)=>");
      if (start === -1) return null;
      const m = /\d+:\(a,b,c\)=>/.exec(c.slice(start + 10));
      const boundary = m ? /,\d+:\(a,b,c\)=>/.exec(c.slice(start + 10)) : null;
      if (!boundary) return null;
      const cut = start + 10 + boundary.index;
      return c.slice(0, start) + MODULE_4493 + c.slice(cut);
    }
  },
  {
    files: [
      ["server", "chunks", "3753.js"],
      ["server", "chunks", "7011.js"],
      ["server", "chunks", "8236.js"],
      ["static", "chunks", "1321-b7836dc184959aa5.js"]
    ],
    fn(c) {
      const out = c.replace(/(\{id:"opencode"[^}]*?)models:\[[^\]]*\]/, `$1models:${JSON.stringify(CLAUDE_MODELS)}`);
      return out === c ? null : out;
    }
  },
  {
    files: [
      ["server", "chunks", "24.js"],
      ["server", "chunks", "412.js"],
      ["server", "chunks", "8402.js"],
      ["static", "chunks", "5497-a3aa1159d255e86a.js"]
    ],
    fn(c) {
      return c.includes(CAP_ANCHOR) ? c.replace(CAP_ANCHOR, CAP_EXTRA + CAP_ANCHOR) : null;
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
