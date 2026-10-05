const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/three-ns-BC2hkirH.js","assets/three.module-Ao4xqtFv.js"])))=>i.map(i=>d[i]);
var Ze=Object.defineProperty;var Ge=(e,t,n)=>t in e?Ze(e,t,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[t]=n;var q=(e,t,n)=>Ge(e,typeof t!="symbol"?t+"":t,n);import{fj as qe,fk as Xe,fl as me,cG as Ye,a as Y,r as i,az as et,eq as tt,fm as nt,j as S,ei as rt}from"./index-BSiL1Vh9.js";const D=e=>e!=null&&typeof e=="object"&&!Array.isArray(e);function ge(e){let t=e;if(typeof e=="string")try{t=JSON.parse(e)}catch{return null}if(!D(t)||typeof t.kind!="string")return null;const n=t.format==="json"||t.format==="bytes"?t.format:"npz",s={};if(D(t.arrays))for(const[u,o]of Object.entries(t.arrays))D(o)&&Array.isArray(o.shape)&&(s[u]={shape:o.shape.map(Number),dtype:String(o.dtype??"")});return{kind:t.kind,format:n,meta:D(t.meta)?t.meta:{},arrays:s,values:D(t.values)?t.values:{}}}const st=e=>{const t=new Uint8Array(e,0,Math.min(2,e.byteLength));return t[0]===80&&t[1]===75},it=e=>{const t=new Uint8Array(e,0,Math.min(6,e.byteLength));return t[0]===147&&t[1]===78&&t[2]===85&&t[3]===77};async function Le(e){const t=await Xe(e),n={};for(const[s,u]of Object.entries(t))n[s]=qe(u);return n}async function at(e,t,n={}){switch(t){case"npz":return{...structuredClone(n),...await Le(e)};case"json":return JSON.parse(new TextDecoder().decode(e));case"bytes":return e.slice(0);default:return st(e)?Le(e):it(e)?{array:qe(e)}:e.slice(0)}}function ot(e){return e.webgl?1:0}class ct{constructor(t=1){q(this,"waiting",new Map);q(this,"running",new Map);q(this,"order",0);q(this,"concurrency");this.concurrency=t}request(t,n,s=0){return this.waiting.set(t,{id:t,start:n,priority:s,order:this.order++}),this.pump(),()=>this.cancel(t)}cancel(t){this.waiting.delete(t),this.running.delete(t)&&this.pump()}stats(){return{waiting:this.waiting.size,running:this.running.size}}pump(){for(;this.running.size<this.concurrency&&this.waiting.size>0;){let t=null;for(const o of this.waiting.values())(!t||o.priority>t.priority||o.priority===t.priority&&o.order<t.order)&&(t=o);const n=t;this.waiting.delete(n.id);let s=!1;const u=()=>{s||(s=!0,this.running.get(n.id)===u&&(this.running.delete(n.id),this.pump()))};this.running.set(n.id,u),n.start(u)}}}const J="cairn-viewer:/",ye="__cairn/",ut={js:"text/javascript",mjs:"text/javascript",cjs:"text/javascript",json:"application/json",css:"text/css",wasm:"application/wasm",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",svg:"image/svg+xml",txt:"text/plain",html:"text/html",glsl:"text/plain",frag:"text/plain",vert:"text/plain",bin:"application/octet-stream"};function lt(e){var n,s;const t=((s=(n=/\.([A-Za-z0-9]+)$/.exec(e))==null?void 0:n[1])==null?void 0:s.toLowerCase())??"";return ut[t]??"application/octet-stream"}const De=e=>/\.(m?js|cjs)$/i.test(e),Je=/(\bfrom\s*|\bimport\s*|\bimport\s*\(\s*)(["'])([^"'\n\r]+)\2/g,be=e=>/^(\.{1,2}\/|\/(?!\/))/.test(e);function ft(e){const t=[];for(const n of e.matchAll(Je)){const s=n[3];be(s)&&!t.includes(s)&&t.push(s)}return t}function Be(e,t){return e.replace(Je,(n,s,u,o)=>{if(!be(o))return n;const f=t(o);return f==null?n:`${s}${u}${f}${u}`})}function dt(e,t){if(t.startsWith("/"))return me(t);const n=e.includes("/")?e.slice(0,e.lastIndexOf("/")+1):"";return me(n+t.replace(/[?#].*$/,""))}const pt=new TextDecoder,Pe=e=>typeof e=="string"?e:pt.decode(e);function ht(e){return typeof e=="string"?new TextEncoder().encode(e).buffer:e instanceof ArrayBuffer?e:e.buffer.slice(e.byteOffset,e.byteOffset+e.byteLength)}function mt(e,t,n=[]){const s=[],u=new Map;for(const c of t){const d=me(c.path);if(!(d==null||d==="")){if(d.startsWith(ye))throw new Error(`${d}: the folder "${ye}" is cairn's`);u.set(d,c)}}if(!u.has(e.entry))throw new Error(`the entry "${e.entry}" is not in the viewer`);const o=[],f={},x=(c,d)=>{o.push({path:c,mime:"text/javascript",data:d}),f[J+c]=c};for(const[c,d]of u){if(!De(c)){o.push({path:c,mime:lt(c),data:ht(d.data)}),f[J+c]=c;continue}const k=Be(Pe(d.data),v=>{const h=dt(c,v);return h==null||!u.has(h)?(s.push(`${c} imports "${v}", which is not in the viewer`),null):J+h});x(c,k)}for(const[c,d]of Object.entries(e.imports))if(c.endsWith("/")){let k=!1;for(const v of u.keys())v.startsWith(d)&&(f[c+v.slice(d.length)]=v,k=!0);k||s.push(`imports["${c}"]: no files under "${d}"`)}else u.has(d)?f[c]=d:s.push(`imports["${c}"]: "${d}" is not in the viewer`);for(const c of n){for(const d of c.files)x(d.path,Pe(d.data));f[c.specifier]=c.entry;for(const d of c.aliases??[])d in f||(f[d]=c.entry)}return{files:o,imports:f,entry:J+e.entry,warnings:s}}const We="1",gt="default-src 'none'; script-src blob: 'unsafe-inline'; style-src blob: 'unsafe-inline'; img-src blob: data:; font-src blob: data:; media-src blob: data:; connect-src 'none'; worker-src blob:; base-uri 'none'; form-action 'none'",yt=`(function(){
var started=false,urls=[];
function post(m){m.v=1;try{parent.postMessage(m,"*")}catch(e){}}
function fail(e){post({type:"cairn:error",message:String(e&&e.message||e),stack:e&&e.stack?String(e.stack):undefined})}
addEventListener("error",function(e){fail(e.error||e.message)});
addEventListener("unhandledrejection",function(e){fail(e.reason)});
addEventListener("pagehide",function(){urls.forEach(function(u){URL.revokeObjectURL(u)})});
addEventListener("message",function(e){
  var d=e.data;
  if(e.source!==parent||!d||d.type!=="cairn:boot"||started)return;
  started=true;
  var byPath={};
  for(var i=0;i<d.files.length;i++){var f=d.files[i];var u=URL.createObjectURL(new Blob([f.data],{type:f.mime}));byPath[f.path]=u;urls.push(u)}
  var map={imports:{}};
  for(var k in d.imports){if(byPath[d.imports[k]])map.imports[k]=byPath[d.imports[k]]}
  window.__cairnFiles=byPath;
  var s=document.createElement("script");s.type="importmap";s.textContent=JSON.stringify(map);document.head.appendChild(s);
  import("cairn:sdk").then(function(){return import(d.entry)}).then(function(){post({type:"cairn:loaded"})},fail);
});
post({type:"cairn:ready",sdk:"${We}"});
})();`;function wt(){return`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${gt}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:transparent;color:var(--cairn-fg,inherit);font:12px/1.4 var(--cairn-font,system-ui,sans-serif)}canvas{display:block}</style><script>${yt}<\/script></head><body></body></html>`}const bt=`const VERSION = "${We}";
let renderFn = null, resizeFn = null, viewFn = null, themeFn = null, snapshotFn = null, settingsFn = null;
let last = null, rendering = false, pending = null, quiet = null, lastView;

function post(m) { m.v = 1; try { parent.postMessage(m, "*"); } catch (e) { /* the host is gone */ } }
function errorOf(e) { return { type: "cairn:error", message: String((e && e.message) || e), stack: e && e.stack ? String(e.stack) : undefined }; }
export function reportError(e) { post(errorOf(e)); }

function applyTheme(t) {
  if (!t) return;
  const s = document.documentElement.style;
  s.setProperty("--cairn-bg", t.bg); s.setProperty("--cairn-fg", t.fg); s.setProperty("--cairn-muted", t.muted);
  s.setProperty("--cairn-border", t.border); s.setProperty("--cairn-accent", t.accent); s.setProperty("--cairn-font", t.font);
  s.setProperty("--cairn-mono", t.monoFont); s.colorScheme = t.mode;
}

async function run(args) {
  if (!renderFn) { pending = args; return; }
  if (rendering) { pending = args; return; }
  rendering = true;
  try { await renderFn(args); post({ type: "cairn:rendered", seq: args.seq }); }
  catch (e) { post(errorOf(e)); }
  finally {
    rendering = false;
    if (pending) { const p = pending; pending = null; run(p); }
  }
}

addEventListener("message", (e) => {
  const d = e.data;
  if (e.source !== parent || !d || typeof d.type !== "string") return;
  switch (d.type) {
    case "cairn:render":
      last = { inputs: d.inputs || [], step: d.step, settings: d.settings || {}, size: d.size, theme: d.theme, view: d.view, seq: d.seq };
      lastView = d.view;
      applyTheme(d.theme);
      run(last);
      break;
    case "cairn:resize":
      if (!last) break;
      last = Object.assign({}, last, { size: d.size });
      if (resizeFn) { try { resizeFn(d.size); } catch (err) { post(errorOf(err)); } }
      else run(last);
      break;
    case "cairn:view":
      lastView = d.view;
      if (last) last = Object.assign({}, last, { view: d.view });
      if (viewFn) { try { viewFn(d.view); } catch (err) { post(errorOf(err)); } }
      break;
    case "cairn:theme":
      applyTheme(d.theme);
      if (last) last = Object.assign({}, last, { theme: d.theme });
      if (themeFn) { try { themeFn(d.theme); } catch (err) { post(errorOf(err)); } }
      else if (last) run(last);
      break;
    case "cairn:settings":
      if (!last) break;
      last = Object.assign({}, last, { settings: d.settings || {} });
      if (settingsFn) { try { settingsFn(last.settings); } catch (err) { post(errorOf(err)); } }
      else run(last);
      break;
    case "cairn:snapshot":
      takeSnapshot().then((url) => post({ type: "cairn:snapshot", id: d.id, url }));
      break;
  }
});

async function takeSnapshot() {
  try {
    if (snapshotFn) {
      const r = await snapshotFn();
      if (typeof r === "string") return r;
      if (r && typeof r.toDataURL === "function") return r.toDataURL("image/png");
      return null;
    }
    const c = document.querySelector("canvas");
    return c ? c.toDataURL("image/png") : null;
  } catch (e) { return null; }
}

/** Draw: called with {inputs, step, settings, size, theme, view} on every change; may be async. */
export function onRender(fn) { renderFn = fn; if (pending) { const p = pending; pending = null; run(p); } }
/** The frame was resized ({width, height, dpr}); without it, a resize re-renders. */
export function onResize(fn) { resizeFn = fn; }
/** A sibling pane (or the stored card state) moved the shared view. */
export function onView(fn) { viewFn = fn; if (lastView !== undefined && lastView !== null) { try { fn(lastView); } catch (e) { post(errorOf(e)); } } }
/** The card's settings changed (and nothing else); without it, a settings change re-renders. */
export function onSettings(fn) { settingsFn = fn; }
/** Change the card's settings (manifest keys); the host checks them and they come back through onSettings / a render. */
export function setSettings(patch) { post({ type: "cairn:settings", patch: Object.assign({}, patch) }); }
/** The settings of the last render or settings change. */
export function settings() { return last ? last.settings : null; }
/** The theme changed; without it, a theme change re-renders. */
export function onTheme(fn) { themeFn = fn; }
/** Share this pane's view (any JSON, e.g. a camera) with the card's other panes. */
export function setView(view, opts) {
  lastView = view;
  const final = !!(opts && opts.final);
  post({ type: "cairn:view", view, final });
  clearTimeout(quiet);
  if (!final) quiet = setTimeout(() => post({ type: "cairn:view", view: lastView, final: true }), 150);
}
/** How to picture this pane when it is paused or exported: return a data URL or a canvas. */
export function snapshot(fn) { snapshotFn = fn; }
/** The content's preferred height in CSS pixels (cards with auto height follow it). */
export function setHeight(px) { post({ type: "cairn:size", height: Math.max(0, Number(px) || 0) }); }
/** A blob URL of a file of the viewer folder (images, data, shaders); null when there is none. */
export function asset(path) {
  const files = window.__cairnFiles || {};
  const p = String(path).replace(/^\\.?\\//, "");
  return files[p] || null;
}
/** The current theme tokens. */
export function theme() { return last ? last.theme : null; }
export const version = VERSION;
`;let pe=null;function vt(){return pe??(pe=xt().catch(e=>{throw pe=null,e})),pe}async function xt(){const e=await Ye(()=>import("./three-ns-BC2hkirH.js"),__vite__mapDeps([0,1])),t=new URL(e.__cairnChunkUrl,location.href),n=`${ye}three/`,s=new Map,u=[],o=[t];for(s.set(t.href,`${n}0.js`);o.length;){const f=o.splice(0),x=await Promise.all(f.map(async c=>{const d=await fetch(c.href);if(!d.ok)throw new Error(`cairn:three: ${c.pathname}: HTTP ${d.status}`);return d.text()}));f.forEach((c,d)=>{const k=x[d];for(const h of ft(k)){const O=new URL(h,c);s.has(O.href)||(s.set(O.href,`${n}${s.size}.js`),o.push(O))}const v=Be(k,h=>be(h)?J+s.get(new URL(h,c).href):null);u.push({path:s.get(c.href),data:v})})}return{specifier:"cairn:three",aliases:["three"],entry:`${n}0.js`,files:u}}const kt={specifier:"cairn:sdk",entry:"__cairn/sdk.js",files:[{path:"__cairn/sdk.js",data:bt}]};function St(e,t){if("three"in t.imports)return e.some(s=>typeof s.data=="string"&&s.data.includes("cairn:three"));const n=new TextDecoder;return e.some(s=>{const u=typeof s.data=="string"?s.data:n.decode(s.data);return/["']cairn:three["']|["']three["']/.test(u)})}async function Ae(e,t,n){const s=new Array(e.length);let u=0;const o=async()=>{for(;u<e.length;){const f=u++;s[f]=await n(e[f])}};return await Promise.all(Array.from({length:Math.min(t,e.length)},o)),s}async function Ot(e,t){const{info:n}=t;if(n.dev){const o=await Y.viewerDevFiles(e,n.name);return Ae(o.files,8,async f=>({path:f.path,data:await Y.viewerDevFile(e,n.name,f.path)}))}if(!n.version_id)throw new Error(`viewer ${n.name} has no published version`);const u=(await Y.artifactVersionFiles(n.version_id)).files.filter(o=>o.digest!=null);return Ae(u,8,async o=>({path:o.path,data:await Y.artifactVersionFileBytes(n.version_id,o.path)}))}async function Rt(e,t){const n=t.manifest,s=await Ot(e,t),u=s.filter(x=>De(x.path)),o=[kt];St(u,n)&&o.push(await vt());const f=mt(n,s,o);for(const x of f.warnings)console.warn(`viewer ${n.name}: ${x}`);return f}const jt=12,$=new Map;function Et(e,t){if(!t.manifest)return Promise.reject(new Error(t.error??"invalid viewer"));const n=`${e}|${t.key}`;let s=$.get(n);if(s)return $.delete(n),$.set(n,s),s;for(s=Rt(e,t),s.catch(()=>$.delete(n)),$.set(n,s);$.size>jt;)$.delete($.keys().next().value);return s}const _t=1;function z(e){return{...e,v:_t}}const Ve=e=>e!=null&&typeof e=="object"&&!Array.isArray(e),ee=(e,t=4e3)=>typeof e=="string"?e.slice(0,t):null,he=e=>typeof e=="number"&&Number.isFinite(e)?e:null;function $t(e){if(!Ve(e)||typeof e.type!="string")return null;switch(e.type){case"cairn:ready":return{type:"cairn:ready",sdk:ee(e.sdk,40)??""};case"cairn:loaded":return{type:"cairn:loaded"};case"cairn:rendered":{const t=he(e.seq);return t==null?null:{type:"cairn:rendered",seq:t}}case"cairn:view":{if(!("view"in e))return null;let t;try{const n=JSON.stringify(e.view);if(n===void 0||n.length>64e3)return null;t=JSON.parse(n)}catch{return null}return{type:"cairn:view",view:t,final:e.final===!0}}case"cairn:size":{const t=he(e.height);return t==null||t<0?null:{type:"cairn:size",height:t}}case"cairn:settings":{if(!Ve(e.patch))return null;const t={};for(const[n,s]of Object.entries(e.patch).slice(0,100))(typeof s=="string"||typeof s=="boolean"||typeof s=="number"&&Number.isFinite(s))&&(t[n.slice(0,100)]=s);return{type:"cairn:settings",patch:t}}case"cairn:snapshot":{const t=he(e.id);if(t==null)return null;const n=ee(e.url,32e6);return{type:"cairn:snapshot",id:t,url:n&&/^data:image\/(png|jpeg|webp);base64,/.test(n)?n:null}}case"cairn:error":{const t=ee(e.message)??"viewer error",n=ee(e.stack);return n?{type:"cairn:error",message:t,stack:n}:{type:"cairn:error",message:t}}default:return null}}function we(e,t=new Set,n=0){if(n>8||e==null||typeof e!="object")return[...t];if(e instanceof ArrayBuffer)t.add(e);else if(ArrayBuffer.isView(e))e.buffer instanceof ArrayBuffer&&t.add(e.buffer);else if(Array.isArray(e))for(const s of e)we(s,t,n+1);else for(const s of Object.values(e))we(s,t,n+1);return[...t]}const Ie=15e3,Ue=2e4,Tt=1e3,Ft=1e4,Ce=new ct(1);let Mt=1;function zt(e){const t=getComputedStyle(e??document.documentElement),n=(s,u)=>t.getPropertyValue(s).trim()||u;return{mode:"light",bg:n("--color-bg","#ffffff"),fg:n("--color-fg","#1f2328"),muted:n("--color-fg-muted","#656d76"),border:n("--color-border","#d0d7de"),accent:n("--color-accent","#0969da"),font:t.fontFamily||"system-ui, sans-serif",monoFont:"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"}}function Nt(e,t){const n=ge(e.point.artifact_metadata),s=rt(e.point.metadata);return{data:t,format:(n==null?void 0:n.format)??e.point.artifact_mime??"bytes",kind:(n==null?void 0:n.kind)??e.point.object_type,meta:(n==null?void 0:n.meta)??{},step:e.point.step,run:e.run,name:e.name,label:e.label,...s?{caption:s}:{}}}function At({project:e,viewer:t,inputs:n,step:s,settings:u,view:o,bus:f,onViewCommit:x,onSettingsPatch:c,height:d,title:k}){var ze;const v=t.manifest,h=v?ot(v)>0:!1,O=i.useRef(null),T=i.useRef(null),[N,ve]=i.useState(null),[xe,R]=i.useState(t.error?{message:t.error}:null),[te,ne]=i.useState(!h),[L,ke]=i.useState(null),[F,re]=i.useState(!1),E=i.useRef(!1);E.current=F;const _=i.useRef(null),[se,Se]=i.useState(0),B=i.useMemo(()=>`f${Mt++}`,[]),[Ke,ie]=i.useState(0),[y,M]=i.useState(!1),[Oe,Re]=i.useState(!1),W=i.useRef(x);W.current=x;const K=i.useRef(c);K.current=c;const ae=i.useRef(u);ae.current=u;const A=i.useRef(null),V=i.useRef(void 0),oe=i.useRef(o);oe.current=o;const ce=i.useRef({width:0,height:0,dpr:1}),H=i.useRef(new Map),ue=i.useRef(0),j=i.useRef(null),I=(r,l=[])=>{var a,p;(p=(a=T.current)==null?void 0:a.contentWindow)==null||p.postMessage(r,"*",l)};i.useEffect(()=>{let r=!1;if(ve(null),M(!1),!t.manifest){R({message:t.error??"invalid viewer"});return}return R(null),Et(e,t).then(l=>!r&&ve(l),l=>!r&&R({message:`could not load viewer ${t.info.name}: ${l instanceof Error?l.message:String(l)}`})),()=>{r=!0}},[e,t]);const le=et({queries:n.map(r=>({...tt(r.point.artifact_hash??"",r.url),enabled:!!r.point.artifact_hash}))}),je=le.map(r=>r.data),Q=je.every(r=>r!=null),Ee=(ze=le.find(r=>r.error))==null?void 0:ze.error,_e=le.map(r=>r.dataUpdatedAt).join("|")+n.map(r=>r.point.artifact_hash).join("|"),Z=JSON.stringify(u),G=`${t.key}|${_e}|${s}|${Z}`,fe=i.useRef(G);fe.current=G;const m=(te||F)&&!Oe&&N!=null&&v!=null,X=`${t.key}:${Ke}`;i.useEffect(()=>{if(!m)return;const r=l=>{var p,g,w;if(l.source==null||l.source!==((p=T.current)==null?void 0:p.contentWindow))return;const a=$t(l.data);if(a)switch(a.type){case"cairn:ready":I(z({type:"cairn:boot",files:N.files,imports:N.imports,entry:N.entry}));break;case"cairn:loaded":M(!0);break;case"cairn:rendered":if(a.seq===ue.current&&j.current&&(clearTimeout(j.current),j.current=null),a.seq===ue.current&&E.current){const b=fe.current;Te().then(C=>{C&&ke({url:C,key:b}),Fe()})}break;case"cairn:view":V.current=JSON.stringify(a.view),f==null||f.publish(a.view,de),a.final&&((g=W.current)==null||g.call(W,a.view));break;case"cairn:snapshot":{const b=H.current.get(a.id);H.current.delete(a.id),b==null||b(a.url);break}case"cairn:error":R({message:a.message,stack:a.stack});break;case"cairn:settings":(w=K.current)==null||w.call(K,a.patch);break}};return window.addEventListener("message",r),()=>window.removeEventListener("message",r)},[m,X,N,f]),i.useEffect(()=>{if(!m||y)return;const r=setTimeout(()=>R({message:`viewer ${t.info.name} did not load within ${Ie/1e3} s`}),Ie);return()=>clearTimeout(r)},[m,y,X,t.info.name]),i.useEffect(()=>{if(!m||!y||!Q)return;let r=!1;const l=++ue.current;return(async()=>{try{const a=await Promise.all(n.map((w,b)=>{var C,Ne;return at(je[b],((C=ge(w.point.artifact_metadata))==null?void 0:C.format)??null,(Ne=ge(w.point.artifact_metadata))==null?void 0:Ne.values)}));if(r)return;const p=n.map((w,b)=>Nt(w,a[b])),g=z({type:"cairn:render",seq:l,inputs:p,step:s,settings:ae.current,size:ce.current,theme:zt(O.current),view:oe.current??null});V.current=JSON.stringify(oe.current??null),A.current=JSON.stringify(ae.current),I(g,we(p)),j.current&&clearTimeout(j.current),j.current=setTimeout(()=>{j.current=null,R({message:`viewer ${t.info.name} did not finish rendering step ${s} within ${Ue/1e3} s`})},Ue)}catch(a){r||R({message:`could not decode the data: ${a instanceof Error?a.message:String(a)}`})}})(),()=>{r=!0}},[m,y,Q,_e,s,X]),i.useEffect(()=>{!m||!y||A.current==null||A.current===Z||(A.current=Z,I(z({type:"cairn:settings",settings:u})))},[Z,m,y]),i.useEffect(()=>()=>{j.current&&clearTimeout(j.current)},[]),i.useEffect(()=>{if(!m||!y)return;const r=JSON.stringify(o??null);r!==V.current&&(V.current=r,I(z({type:"cairn:view",view:o??null})))},[o,m,y]);const de=i.useMemo(()=>({show:r=>{var l,a;V.current=JSON.stringify(r),(a=(l=T.current)==null?void 0:l.contentWindow)==null||a.postMessage(z({type:"cairn:view",view:r}),"*")}}),[]);i.useEffect(()=>f?f.join(de):void 0,[f,de]),i.useEffect(()=>{const r=O.current;if(!r)return;let l=0;const a=()=>{const g=r.getBoundingClientRect(),w={width:Math.round(g.width),height:Math.round(g.height),dpr:window.devicePixelRatio||1},b=ce.current;b.width===w.width&&b.height===w.height&&b.dpr===w.dpr||(ce.current=w,T.current&&I(z({type:"cairn:resize",size:w})))};a();const p=new ResizeObserver(()=>{cancelAnimationFrame(l),l=requestAnimationFrame(a)});return p.observe(r),()=>{p.disconnect(),cancelAnimationFrame(l)}},[]);const $e=i.useRef(y);$e.current=y;const He=i.useRef(1),Te=()=>new Promise(r=>{var p;if(!T.current||!$e.current)return r(null);const l=He.current++,a=setTimeout(()=>{H.current.delete(l),r(null)},Tt);H.current.set(l,g=>{clearTimeout(a),r(g)}),(p=T.current.contentWindow)==null||p.postMessage(z({type:"cairn:snapshot",id:l}),"*")}),Fe=()=>{const r=_.current;_.current=null,!(!E.current&&!r)&&(E.current=!1,re(!1),M(!1),r==null||r())},P=i.useRef(null);i.useEffect(()=>{const r=O.current;if(!h||!r)return;const l=nt.register(r,{activate:()=>{const a=_.current;if(_.current=null,E.current){E.current=!1,re(!1),a==null||a(),ne(!0);return}M(!1),ie(p=>p+1),ne(!0)},deactivate:async()=>{const a=fe.current,p=await Te();p&&ke({url:p,key:a}),ne(!1),M(!1)}},1);return P.current=l,()=>{l.unregister(),P.current=null}},[h]),i.useEffect(()=>{const r=O.current;if(!h||!r)return;const l=new IntersectionObserver(([p])=>Se(g=>p.isIntersecting?2:g===2?0:g),{threshold:0}),a=new IntersectionObserver(([p])=>Se(g=>p.isIntersecting?Math.max(g,1):0),{rootMargin:"100% 0px",threshold:0});return l.observe(r),a.observe(r),()=>{l.disconnect(),a.disconnect()}},[h]);const Me=h&&!te&&!F&&!Oe&&!xe&&N!=null&&Q&&se>0&&(L==null?void 0:L.key)!==G;i.useEffect(()=>{if(!Me)return;const r=Ce.request(B,l=>{_.current=l,E.current=!0,M(!1),ie(a=>a+1),re(!0)},se);return()=>{E.current||r()}},[Me,B,se,G]),i.useEffect(()=>{if(!F)return;const r=setTimeout(Fe,Ft);return()=>clearTimeout(r)},[F]),i.useEffect(()=>()=>{var r;(r=_.current)==null||r.call(_),Ce.cancel(B)},[B]);const U=xe??(Ee?{message:`could not fetch the data: ${String(Ee)}`}:null);i.useEffect(()=>{y||(A.current=null)},[y]);const Qe=()=>{R(null),Re(!1),M(!1),ie(r=>r+1)};return S.jsxs("div",{ref:O,className:"relative w-full min-h-0 overflow-hidden rounded bg-bg",style:{height:d??"100%"},"data-viewer":"custom","data-viewer-name":t.info.name,"data-viewer-state":F?"capturing":m?y?"live":"loading":te?"waiting":L?"snapshot":"paused",onPointerEnter:()=>{var r;return(r=P.current)==null?void 0:r.pin(!0)},onPointerLeave:()=>{var r;return(r=P.current)==null?void 0:r.pin(!1)},onPointerDown:()=>{var r;return(r=P.current)==null?void 0:r.touch()},onWheel:()=>{var r;return(r=P.current)==null?void 0:r.touch()},children:[m?S.jsx("iframe",{ref:T,sandbox:"allow-scripts",srcDoc:wt(),title:k,className:"absolute inset-0 h-full w-full border-0",onLoad:r=>{const l=r.currentTarget;l.__cairnLoads=(l.__cairnLoads??0)+1,l.__cairnLoads>1&&(Re(!0),R({message:"the viewer navigated its frame away; it was stopped"}))}},X):null,(!m||F)&&(L?S.jsx("img",{src:L.url,alt:k,className:"pointer-events-none absolute inset-0 h-full w-full object-contain",draggable:!1}):S.jsx("div",{className:"absolute inset-0 motion-safe:animate-pulse bg-bg-hover","aria-label":`${k}: loading`})),!Q&&!U&&m&&S.jsx("div",{className:"pointer-events-none absolute right-1 top-1 rounded bg-bg/80 px-1 text-[10px] text-fg-subtle",children:"loading data…"}),U&&S.jsxs("div",{role:"alert",className:"absolute inset-x-1 bottom-1 max-h-[70%] overflow-auto rounded border border-status-failed/40 bg-bg/95 p-2 text-xs text-status-failed",children:[S.jsxs("div",{className:"flex items-start gap-2",children:[S.jsx("pre",{className:"min-w-0 flex-1 whitespace-pre-wrap break-words font-mono",children:U.message}),S.jsx("button",{type:"button",onClick:Qe,className:"shrink-0 rounded px-1.5 py-0.5 text-fg-muted hover:bg-bg-hover hover:text-fg",children:"Reload"})]}),U.stack&&S.jsx("pre",{className:"mt-1 whitespace-pre-wrap break-words text-[10px] text-fg-muted",children:U.stack})]})]})}export{At as V,ge as p};
