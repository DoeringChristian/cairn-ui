const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/three-ns-BC2hkirH.js","assets/three.module-Ao4xqtFv.js"])))=>i.map(i=>d[i]);
var st=Object.defineProperty;var it=(e,t,n)=>t in e?st(e,t,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[t]=n;var D=(e,t,n)=>it(e,typeof t!="symbol"?t+"":t,n);import{fl as Ke,fm as at,fn as ke,cH as ot,a as re,r as i,az as ct,es as ut,fo as lt,fp as ft,j as S,ek as dt}from"./index-CTdOm8tA.js";const J=e=>e!=null&&typeof e=="object"&&!Array.isArray(e);function Se(e){let t=e;if(typeof e=="string")try{t=JSON.parse(e)}catch{return null}if(!J(t)||typeof t.kind!="string")return null;const n=t.format==="json"||t.format==="bytes"?t.format:"npz",s={};if(J(t.arrays))for(const[l,c]of Object.entries(t.arrays))J(c)&&Array.isArray(c.shape)&&(s[l]={shape:c.shape.map(Number),dtype:String(c.dtype??"")});return{kind:t.kind,format:n,meta:J(t.meta)?t.meta:{},arrays:s,values:J(t.values)?t.values:{}}}const pt=e=>{const t=new Uint8Array(e,0,Math.min(2,e.byteLength));return t[0]===80&&t[1]===75},ht=e=>{const t=new Uint8Array(e,0,Math.min(6,e.byteLength));return t[0]===147&&t[1]===78&&t[2]===85&&t[3]===77};async function Ce(e){const t=await at(e),n={};for(const[s,l]of Object.entries(t))n[s]=Ke(l);return n}async function mt(e,t,n={}){switch(t){case"npz":return{...structuredClone(n),...await Ce(e)};case"json":return JSON.parse(new TextDecoder().decode(e));case"bytes":return e.slice(0);default:return pt(e)?Ce(e):ht(e)?{array:Ke(e)}:e.slice(0)}}function gt(e){return e.webgl?1:0}class yt{constructor(t=1){D(this,"waiting",new Map);D(this,"running",new Map);D(this,"order",0);D(this,"concurrency");this.concurrency=t}request(t,n,s=0){return this.waiting.set(t,{id:t,start:n,priority:s,order:this.order++}),this.pump(),()=>this.cancel(t)}cancel(t){this.waiting.delete(t),this.running.delete(t)&&this.pump()}stats(){return{waiting:this.waiting.size,running:this.running.size}}pump(){for(;this.running.size<this.concurrency&&this.waiting.size>0;){let t=null;for(const c of this.waiting.values())(!t||c.priority>t.priority||c.priority===t.priority&&c.order<t.order)&&(t=c);const n=t;this.waiting.delete(n.id);let s=!1;const l=()=>{s||(s=!0,this.running.get(n.id)===l&&(this.running.delete(n.id),this.pump()))};this.running.set(n.id,l),n.start(l)}}}const B="cairn-viewer:/",Re="__cairn/",wt={js:"text/javascript",mjs:"text/javascript",cjs:"text/javascript",json:"application/json",css:"text/css",wasm:"application/wasm",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",svg:"image/svg+xml",txt:"text/plain",html:"text/html",glsl:"text/plain",frag:"text/plain",vert:"text/plain",bin:"application/octet-stream"};function bt(e){var n,s;const t=((s=(n=/\.([A-Za-z0-9]+)$/.exec(e))==null?void 0:n[1])==null?void 0:s.toLowerCase())??"";return wt[t]??"application/octet-stream"}const Qe=e=>/\.(m?js|cjs)$/i.test(e),Ze=/(\bfrom\s*|\bimport\s*|\bimport\s*\(\s*)(["'])([^"'\n\r]+)\2/g,je=e=>/^(\.{1,2}\/|\/(?!\/))/.test(e);function vt(e){const t=[];for(const n of e.matchAll(Ze)){const s=n[3];je(s)&&!t.includes(s)&&t.push(s)}return t}function Xe(e,t){return e.replace(Ze,(n,s,l,c)=>{if(!je(c))return n;const f=t(c);return f==null?n:`${s}${l}${f}${l}`})}function xt(e,t){if(t.startsWith("/"))return ke(t);const n=e.includes("/")?e.slice(0,e.lastIndexOf("/")+1):"";return ke(n+t.replace(/[?#].*$/,""))}const kt=new TextDecoder,qe=e=>typeof e=="string"?e:kt.decode(e);function St(e){return typeof e=="string"?new TextEncoder().encode(e).buffer:e instanceof ArrayBuffer?e:e.buffer.slice(e.byteOffset,e.byteOffset+e.byteLength)}function Rt(e,t,n=[]){const s=[],l=new Map;for(const u of t){const d=ke(u.path);if(!(d==null||d==="")){if(d.startsWith(Re))throw new Error(`${d}: the folder "${Re}" is cairn's`);l.set(d,u)}}if(!l.has(e.entry))throw new Error(`the entry "${e.entry}" is not in the viewer`);const c=[],f={},k=(u,d)=>{c.push({path:u,mime:"text/javascript",data:d}),f[B+u]=u};for(const[u,d]of l){if(!Qe(u)){c.push({path:u,mime:bt(u),data:St(d.data)}),f[B+u]=u;continue}const v=Xe(qe(d.data),x=>{const g=xt(u,x);return g==null||!l.has(g)?(s.push(`${u} imports "${x}", which is not in the viewer`),null):B+g});k(u,v)}for(const[u,d]of Object.entries(e.imports))if(u.endsWith("/")){let v=!1;for(const x of l.keys())x.startsWith(d)&&(f[u+x.slice(d.length)]=x,v=!0);v||s.push(`imports["${u}"]: no files under "${d}"`)}else l.has(d)?f[u]=d:s.push(`imports["${u}"]: "${d}" is not in the viewer`);for(const u of n){for(const d of u.files)k(d.path,qe(d.data));f[u.specifier]=u.entry;for(const d of u.aliases??[])d in f||(f[d]=u.entry)}return{files:c,imports:f,entry:B+e.entry,warnings:s}}const Ge="1",Ot="default-src 'none'; script-src blob: 'unsafe-inline'; style-src blob: 'unsafe-inline'; img-src blob: data:; font-src blob: data:; media-src blob: data:; connect-src 'none'; worker-src blob:; base-uri 'none'; form-action 'none'",jt=`(function(){
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
post({type:"cairn:ready",sdk:"${Ge}"});
})();`;function Et(){return`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${Ot}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:transparent;color:var(--cairn-fg,inherit);font:12px/1.4 var(--cairn-font,system-ui,sans-serif)}canvas{display:block}</style><script>${jt}<\/script></head><body></body></html>`}const _t=`const VERSION = "${Ge}";
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
`;let ve=null;function $t(){return ve??(ve=Tt().catch(e=>{throw ve=null,e})),ve}async function Tt(){const e=await ot(()=>import("./three-ns-BC2hkirH.js"),__vite__mapDeps([0,1])),t=new URL(e.__cairnChunkUrl,location.href),n=`${Re}three/`,s=new Map,l=[],c=[t];for(s.set(t.href,`${n}0.js`);c.length;){const f=c.splice(0),k=await Promise.all(f.map(async u=>{const d=await fetch(u.href);if(!d.ok)throw new Error(`cairn:three: ${u.pathname}: HTTP ${d.status}`);return d.text()}));f.forEach((u,d)=>{const v=k[d];for(const g of vt(v)){const R=new URL(g,u);s.has(R.href)||(s.set(R.href,`${n}${s.size}.js`),c.push(R))}const x=Xe(v,g=>je(g)?B+s.get(new URL(g,u).href):null);l.push({path:s.get(u.href),data:x})})}return{specifier:"cairn:three",aliases:["three"],entry:`${n}0.js`,files:l}}const Ft={specifier:"cairn:sdk",entry:"__cairn/sdk.js",files:[{path:"__cairn/sdk.js",data:_t}]};function Mt(e,t){if("three"in t.imports)return e.some(s=>typeof s.data=="string"&&s.data.includes("cairn:three"));const n=new TextDecoder;return e.some(s=>{const l=typeof s.data=="string"?s.data:n.decode(s.data);return/["']cairn:three["']|["']three["']/.test(l)})}async function De(e,t,n){const s=new Array(e.length);let l=0;const c=async()=>{for(;l<e.length;){const f=l++;s[f]=await n(e[f])}};return await Promise.all(Array.from({length:Math.min(t,e.length)},c)),s}async function Nt(e,t){const{info:n}=t;if(n.dev){const c=await re.viewerDevFiles(e,n.name);return De(c.files,8,async f=>({path:f.path,data:await re.viewerDevFile(e,n.name,f.path)}))}if(!n.version_id)throw new Error(`viewer ${n.name} has no published version`);const l=(await re.artifactVersionFiles(n.version_id)).files.filter(c=>c.digest!=null);return De(l,8,async c=>({path:c.path,data:await re.artifactVersionFileBytes(n.version_id,c.path)}))}async function Pt(e,t){const n=t.manifest,s=await Nt(e,t),l=s.filter(k=>Qe(k.path)),c=[Ft];Mt(l,n)&&c.push(await $t());const f=Rt(n,s,c);for(const k of f.warnings)console.warn(`viewer ${n.name}: ${k}`);return f}const zt=12,F=new Map;function Lt(e,t){if(!t.manifest)return Promise.reject(new Error(t.error??"invalid viewer"));const n=`${e}|${t.key}`;let s=F.get(n);if(s)return F.delete(n),F.set(n,s),s;for(s=Pt(e,t),s.catch(()=>F.delete(n)),F.set(n,s);F.size>zt;)F.delete(F.keys().next().value);return s}const At=1;function P(e){return{...e,v:At}}const Je=e=>e!=null&&typeof e=="object"&&!Array.isArray(e),se=(e,t=4e3)=>typeof e=="string"?e.slice(0,t):null,xe=e=>typeof e=="number"&&Number.isFinite(e)?e:null;function Vt(e){if(!Je(e)||typeof e.type!="string")return null;switch(e.type){case"cairn:ready":return{type:"cairn:ready",sdk:se(e.sdk,40)??""};case"cairn:loaded":return{type:"cairn:loaded"};case"cairn:rendered":{const t=xe(e.seq);return t==null?null:{type:"cairn:rendered",seq:t}}case"cairn:view":{if(!("view"in e))return null;let t;try{const n=JSON.stringify(e.view);if(n===void 0||n.length>64e3)return null;t=JSON.parse(n)}catch{return null}return{type:"cairn:view",view:t,final:e.final===!0}}case"cairn:size":{const t=xe(e.height);return t==null||t<0?null:{type:"cairn:size",height:t}}case"cairn:settings":{if(!Je(e.patch))return null;const t={};for(const[n,s]of Object.entries(e.patch).slice(0,100))(typeof s=="string"||typeof s=="boolean"||typeof s=="number"&&Number.isFinite(s))&&(t[n.slice(0,100)]=s);return{type:"cairn:settings",patch:t}}case"cairn:snapshot":{const t=xe(e.id);if(t==null)return null;const n=se(e.url,32e6);return{type:"cairn:snapshot",id:t,url:n&&/^data:image\/(png|jpeg|webp);base64,/.test(n)?n:null}}case"cairn:error":{const t=se(e.message)??"viewer error",n=se(e.stack);return n?{type:"cairn:error",message:t,stack:n}:{type:"cairn:error",message:t}}default:return null}}function Oe(e,t=new Set,n=0){if(n>8||e==null||typeof e!="object")return[...t];if(e instanceof ArrayBuffer)t.add(e);else if(ArrayBuffer.isView(e))e.buffer instanceof ArrayBuffer&&t.add(e.buffer);else if(Array.isArray(e))for(const s of e)Oe(s,t,n+1);else for(const s of Object.values(e))Oe(s,t,n+1);return[...t]}const Be=15e3,We=2e4,It=1e3,Ut=1e4,He=new yt(1);let Ct=1;function qt(e){const t=getComputedStyle(e??document.documentElement),n=(s,l)=>t.getPropertyValue(s).trim()||l;return{mode:"light",bg:n("--color-bg","#ffffff"),fg:n("--color-fg","#1f2328"),muted:n("--color-fg-muted","#656d76"),border:n("--color-border","#d0d7de"),accent:n("--color-accent","#0969da"),font:t.fontFamily||"system-ui, sans-serif",monoFont:"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"}}function Dt(e){let t=e;if(typeof e=="string")try{t=JSON.parse(e)}catch{return{}}return t!=null&&typeof t=="object"&&!Array.isArray(t)?t:{}}function Jt(e,t){const n=Se(e.point.artifact_metadata),s=dt(e.point.metadata);return{data:t,format:(n==null?void 0:n.format)??e.point.artifact_mime??"bytes",kind:(n==null?void 0:n.kind)??e.point.object_type,meta:n?n.meta:Dt(e.point.artifact_metadata),step:e.point.step,run:e.run,name:e.name,label:e.label,...s?{caption:s}:{}}}function Ht({project:e,viewer:t,inputs:n,step:s,settings:l,view:c,bus:f,onViewCommit:k,onSettingsPatch:u,height:d,title:v}){var Ie;const x=t.manifest,g=x?gt(x)>0:!1,R=i.useRef(null),M=i.useRef(null),[z,Ee]=i.useState(null),[_e,O]=i.useState(t.error?{message:t.error}:null),[W,ie]=i.useState(!g),H=i.useRef(!g),ae=i.useRef(0),[E,$e]=i.useState(null),[_,oe]=i.useState(!1),$=i.useRef(!1);$.current=_;const T=i.useRef(null),[ce,Te]=i.useState(0),K=i.useMemo(()=>`f${Ct++}`,[]),[Ye,ue]=i.useState(0),[y,N]=i.useState(!1),[le,Fe]=i.useState(!1),[et,Q]=i.useState(!1),[fe,tt]=i.useState(null),Z=i.useRef(k);Z.current=k;const X=i.useRef(u);X.current=u;const de=i.useRef(l);de.current=l;const V=i.useRef(null),I=i.useRef(void 0),pe=i.useRef(c);pe.current=c;const he=i.useRef({width:0,height:0,dpr:1}),G=i.useRef(new Map),Y=i.useRef(0),j=i.useRef(null),U=(r,o=[])=>{var a,p;(p=(a=M.current)==null?void 0:a.contentWindow)==null||p.postMessage(r,"*",o)};i.useEffect(()=>{let r=!1;if(Ee(null),N(!1),!t.manifest){O({message:t.error??"invalid viewer"});return}return O(null),Lt(e,t).then(o=>!r&&Ee(o),o=>!r&&O({message:`could not load viewer ${t.info.name}: ${o instanceof Error?o.message:String(o)}`})),()=>{r=!0}},[e,t]);const me=ct({queries:n.map(r=>({...ut(r.point.artifact_hash??"",r.url),enabled:!!r.point.artifact_hash}))}),Me=me.map(r=>r.data),C=Me.every(r=>r!=null),Ne=(Ie=me.find(r=>r.error))==null?void 0:Ie.error,Pe=me.map(r=>r.dataUpdatedAt).join("|")+n.map(r=>r.point.artifact_hash).join("|"),ee=JSON.stringify(l),te=`${t.key}|${Pe}|${s}|${ee}`,ge=i.useRef(te);ge.current=te;const h=(W||_)&&!le&&z!=null&&x!=null,ne=`${t.key}:${Ye}`;i.useEffect(()=>{if(!h)return;const r=o=>{var p,m,w;if(o.source==null||o.source!==((p=M.current)==null?void 0:p.contentWindow))return;const a=Vt(o.data);if(a)switch(a.type){case"cairn:ready":U(P({type:"cairn:boot",files:z.files,imports:z.imports,entry:z.entry}));break;case"cairn:loaded":N(!0);break;case"cairn:rendered":if(a.seq===Y.current&&j.current&&(clearTimeout(j.current),j.current=null),a.seq===Y.current&&Q(!1),a.seq===Y.current&&$.current){const b=ge.current;we().then(q=>{q&&$e({url:q,key:b}),Le()})}break;case"cairn:view":I.current=JSON.stringify(a.view),f==null||f.publish(a.view,ye),a.final&&((m=Z.current)==null||m.call(Z,a.view));break;case"cairn:snapshot":{const b=G.current.get(a.id);G.current.delete(a.id),b==null||b(a.url);break}case"cairn:error":O({message:a.message,stack:a.stack}),Q(!1);break;case"cairn:settings":(w=X.current)==null||w.call(X,a.patch);break}};return window.addEventListener("message",r),()=>window.removeEventListener("message",r)},[h,ne,z,f]),i.useEffect(()=>{if(!h||y)return;const r=setTimeout(()=>O({message:`viewer ${t.info.name} did not load within ${Be/1e3} s`}),Be);return()=>clearTimeout(r)},[h,y,ne,t.info.name]),i.useEffect(()=>{if(!h||!y||!C)return;let r=!1;const o=++Y.current;return(async()=>{try{const a=await Promise.all(n.map((w,b)=>{var q,Ue;return mt(Me[b],((q=Se(w.point.artifact_metadata))==null?void 0:q.format)??null,(Ue=Se(w.point.artifact_metadata))==null?void 0:Ue.values)}));if(r)return;const p=n.map((w,b)=>Jt(w,a[b])),m=P({type:"cairn:render",seq:o,inputs:p,step:s,settings:de.current,size:he.current,theme:qt(R.current),view:pe.current??null});I.current=JSON.stringify(pe.current??null),V.current=JSON.stringify(de.current),U(m,Oe(p)),Q(!0),j.current&&clearTimeout(j.current),j.current=setTimeout(()=>{j.current=null,Q(!1),O({message:`viewer ${t.info.name} did not finish rendering step ${s} within ${We/1e3} s`})},We)}catch(a){r||O({message:`could not decode the data: ${a instanceof Error?a.message:String(a)}`})}})(),()=>{r=!0}},[h,y,C,Pe,s,ne]),i.useEffect(()=>{!h||!y||V.current==null||V.current===ee||(V.current=ee,U(P({type:"cairn:settings",settings:l})))},[ee,h,y]),i.useEffect(()=>()=>{j.current&&clearTimeout(j.current)},[]),i.useEffect(()=>{if(!h||!y)return;const r=JSON.stringify(c??null);r!==I.current&&(I.current=r,U(P({type:"cairn:view",view:c??null})))},[c,h,y]);const ye=i.useMemo(()=>({show:r=>{var o,a;I.current=JSON.stringify(r),(a=(o=M.current)==null?void 0:o.contentWindow)==null||a.postMessage(P({type:"cairn:view",view:r}),"*")}}),[]);i.useEffect(()=>f?f.join(ye):void 0,[f,ye]),i.useEffect(()=>{const r=R.current;if(!r)return;let o=0;const a=()=>{const m=r.getBoundingClientRect(),w={width:Math.round(m.width),height:Math.round(m.height),dpr:window.devicePixelRatio||1},b=he.current;b.width===w.width&&b.height===w.height&&b.dpr===w.dpr||(he.current=w,M.current&&U(P({type:"cairn:resize",size:w})))};a();const p=new ResizeObserver(()=>{cancelAnimationFrame(o),o=requestAnimationFrame(a)});return p.observe(r),()=>{p.disconnect(),cancelAnimationFrame(o)}},[]);const ze=i.useRef(y);ze.current=y;const nt=i.useRef(1),we=()=>new Promise(r=>{var p;if(!M.current||!ze.current)return r(null);const o=nt.current++,a=setTimeout(()=>{G.current.delete(o),r(null)},It);G.current.set(o,m=>{clearTimeout(a),r(m)}),(p=M.current.contentWindow)==null||p.postMessage(P({type:"cairn:snapshot",id:o}),"*")}),Le=()=>{const r=T.current;T.current=null,!(!$.current&&!r)&&($.current=!1,oe(!1),H.current||N(!1),r==null||r())},be=i.useRef(E);be.current=E;const Ae=i.useRef(!1);Ae.current=h&&y&&!_,i.useEffect(()=>{const r=R.current;if(r)return lt(r,{snapshot:async()=>{var o,a;return Ae.current?await we()??((o=be.current)==null?void 0:o.url)??null:((a=be.current)==null?void 0:a.url)??null},setPrint:tt})},[]);const L=i.useRef(null);i.useEffect(()=>{const r=R.current;if(!g||!r)return;const o=ft.register(r,{activate:()=>{ae.current++,H.current=!0;const a=T.current;if(T.current=null,$.current){$.current=!1,oe(!1),a==null||a(),ie(!0);return}N(!1),ue(p=>p+1),ie(!0)},deactivate:async()=>{const a=++ae.current,p=ge.current,m=await we();m&&$e({url:m,key:p}),a===ae.current&&(H.current=!1,ie(!1),N(!1))}},1);return L.current=o,()=>{o.unregister(),L.current=null}},[g]),i.useEffect(()=>{const r=R.current;if(!g||!r)return;const o=new IntersectionObserver(([p])=>Te(m=>p.isIntersecting?2:m===2?0:m),{threshold:0}),a=new IntersectionObserver(([p])=>Te(m=>p.isIntersecting?Math.max(m,1):0),{rootMargin:"100% 0px",threshold:0});return o.observe(r),a.observe(r),()=>{o.disconnect(),a.disconnect()}},[g]);const Ve=g&&!W&&!_&&!le&&!_e&&z!=null&&C&&ce>0&&(E==null?void 0:E.key)!==te;i.useEffect(()=>{if(!Ve)return;const r=He.request(K,o=>{if(H.current)return o();T.current=o,$.current=!0,N(!1),ue(a=>a+1),oe(!0)},ce);return()=>{$.current||r()}},[Ve,K,ce,te]),i.useEffect(()=>{if(!_)return;const r=setTimeout(Le,Ut);return()=>clearTimeout(r)},[_]),i.useEffect(()=>()=>{var r;(r=T.current)==null||r.call(T),He.cancel(K)},[K]);const A=_e??(Ne?{message:`could not fetch the data: ${String(Ne)}`}:null);i.useEffect(()=>{y||(V.current=null)},[y]);const rt=()=>{O(null),Fe(!1),N(!1),ue(r=>r+1)};return S.jsxs("div",{ref:R,className:"relative w-full min-h-0 overflow-hidden rounded bg-bg",style:{height:d??"100%"},"data-viewer":"custom","data-viewer-name":t.info.name,"data-viewer-state":_?"capturing":h?y?"live":"loading":W?"waiting":E?"snapshot":"paused","data-viewer-busy":String(!A&&(h&&(!y||!C||et)||W&&!h&&!le)),onPointerEnter:()=>{var r;return(r=L.current)==null?void 0:r.pin(!0)},onPointerLeave:()=>{var r;return(r=L.current)==null?void 0:r.pin(!1)},onPointerDown:()=>{var r;return(r=L.current)==null?void 0:r.touch()},onWheel:()=>{var r;return(r=L.current)==null?void 0:r.touch()},children:[h?S.jsx("iframe",{ref:M,sandbox:"allow-scripts",srcDoc:Et(),title:v,className:`absolute inset-0 h-full w-full border-0${fe?" print:hidden":""}`,onLoad:r=>{const o=r.currentTarget;o.__cairnLoads=(o.__cairnLoads??0)+1,o.__cairnLoads>1&&(Fe(!0),O({message:"the viewer navigated its frame away; it was stopped"}))}},ne):null,fe&&S.jsx("img",{src:fe,alt:v,className:"pointer-events-none absolute inset-0 hidden h-full w-full object-contain print:block",draggable:!1}),(!h||_)&&(E?S.jsx("img",{src:E.url,alt:v,className:"pointer-events-none absolute inset-0 h-full w-full object-contain",draggable:!1}):S.jsx("div",{className:"absolute inset-0 motion-safe:animate-pulse bg-bg-hover","aria-label":`${v}: loading`})),!C&&!A&&h&&S.jsx("div",{className:"pointer-events-none absolute right-1 top-1 rounded bg-bg/80 px-1 text-[10px] text-fg-subtle",children:"loading data…"}),A&&S.jsxs("div",{role:"alert",className:"absolute inset-x-1 bottom-1 max-h-[70%] overflow-auto rounded border border-status-failed/40 bg-bg/95 p-2 text-xs text-status-failed",children:[S.jsxs("div",{className:"flex items-start gap-2",children:[S.jsx("pre",{className:"min-w-0 flex-1 whitespace-pre-wrap break-words font-mono",children:A.message}),S.jsx("button",{type:"button",onClick:rt,className:"shrink-0 rounded px-1.5 py-0.5 text-fg-muted hover:bg-bg-hover hover:text-fg",children:"Reload"})]}),A.stack&&S.jsx("pre",{className:"mt-1 whitespace-pre-wrap break-words text-[10px] text-fg-muted",children:A.stack})]})]})}export{Ht as V,Se as p};
