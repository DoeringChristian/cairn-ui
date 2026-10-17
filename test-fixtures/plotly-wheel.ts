/** Dev-only actual-renderer regression. Not a production Vite entry. */
import { loadPlotly } from "../src/charts/plotly-loader";
import { guardCartesianWheel } from "../src/charts/plotly-wheel";

type Plot = HTMLDivElement & {
  _fullLayout: {_replotting?: boolean; xaxis: {range: number[]}; yaxis: {range: number[]}};
  on: (name: string, callback: () => void) => void;
};
type Sample = {tick: number; phase: string; x: number[]; y: number[]; xSpan: number; ySpan: number; beforeplots: number};
type Outcome = {name: string; guarded: boolean; samples: Sample[]; monotonic: boolean; expected: boolean; marginGuardReleased: boolean; errors: string[]};
const button = document.querySelector<HTMLButtonElement>("#run")!;
const status = document.querySelector<HTMLElement>("#status")!;
const result = document.querySelector<HTMLElement>("#result")!;
const plots = document.querySelector<HTMLElement>("#plots")!;
const trace = document.querySelector<HTMLElement>("#trace")!;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const count = 12;
const zoom = Math.exp(-.1);

async function exercise(name: string, guarded: boolean, logarithmic: boolean): Promise<Outcome> {
  const Plotly = await loadPlotly();
  const article = document.createElement("article");
  const heading = document.createElement("h2"); heading.textContent = `${name} · ${guarded ? "guarded" : "unguarded control"}`;
  const element = document.createElement("div") as Plot; element.className = "plot";
  article.append(heading,element); plots.append(article);
  const x = Array.from({length:36},(_,i) => i*2/35);
  const y = x.map(value => Math.exp(-value*3));
  await Plotly.newPlot(element,[{type:"scatter",mode:"lines",x,y}],{
    width:680,height:360,margin:{l:48,r:12,t:12,b:36},
    xaxis:{automargin:true},yaxis:{automargin:true,type:logarithmic ? "log" : "linear"},
  },{scrollZoom:true,displayModeBar:false,responsive:false});
  await frame();
  let beforeplots = 0;
  element.on("plotly_beforeplot",() => {beforeplots++;});
  if(guarded) element.addEventListener("wheel",event => guardCartesianWheel(element,event),{capture:true,passive:true});
  const samples: Sample[]=[];
  const record = (tick:number, phase="event") => {
    const x=[...element._fullLayout.xaxis.range],y=[...element._fullLayout.yaxis.range];
    samples.push({tick,phase,x,y,xSpan:x[1]-x[0],ySpan:y[1]-y[0],beforeplots});
  };
  record(0);
  for(let tick=1;tick<=count;tick++) {
    const started=performance.now();
    const drag = element.querySelector<SVGElement>(".nsewdrag")!;
    const bounds=drag.getBoundingClientRect();
    drag.dispatchEvent(new WheelEvent("wheel",{deltaY:-20,clientX:bounds.left+bounds.width*.5,clientY:bounds.top+bounds.height*.5,bubbles:true,cancelable:true}));
    record(tick);
    await frame();record(tick,"frame");
    await sleep(Math.max(0,30-(performance.now()-started)));
  }
  await sleep(180);await frame();record(count+1,"settled");
  const tolerance=1e-6;
  const monotonic=samples.slice(1).every((value,index)=>value.xSpan<=samples[index].xSpan*(1+tolerance) && value.ySpan<=samples[index].ySpan*(1+tolerance));
  const first=samples[0],last=samples[samples.length-1];
  const expected=["xSpan","ySpan"].every(key=>Math.abs(last[key as "xSpan"]/(first[key as "xSpan"]*zoom**count)-1)<1e-4);
  const marginGuardReleased=element._fullLayout._replotting===false;
  const errors=[];
  if(!monotonic)errors.push("range expanded during zoom-in (snapback)");
  if(!expected)errors.push("settled range lost one or more wheel ticks");
  if(guarded && !marginGuardReleased)errors.push("automatic margin guard remained set after gesture settled");
  return {name,guarded,samples,monotonic,expected,marginGuardReleased,errors};
}
button.addEventListener("click",async()=>{
  button.disabled=true;
  const Plotly=await loadPlotly();
  for(const plot of plots.querySelectorAll(".plot"))Plotly.purge(plot);
  plots.replaceChildren();trace.textContent="";result.textContent="Running actual Plotly regression…";
  try {
    const outcomes:Outcome[]=[];
    for(const logarithmic of [false,true])for(const guarded of [false,true]) {
      const name=logarithmic ? "Logarithmic Y axis" : "Linear axes";
      status.textContent=`Running ${name}, ${guarded ? "guarded" : "control"}…`;
      outcomes.push(await exercise(name,guarded,logarithmic));
    }
    const controlReproduces=outcomes.some(outcome=>!outcome.guarded && (!outcome.monotonic || !outcome.expected));
    const guardedPass=outcomes.filter(outcome=>outcome.guarded).every(outcome=>outcome.monotonic && outcome.expected && outcome.marginGuardReleased);
    const pass=controlReproduces && guardedPass;
    result.dataset.result=pass ? "pass" : "fail";
    result.textContent=[pass ? "PASS" : "FAIL",`Unguarded snapback reproduced: ${controlReproduces ? "yes" : "NO — fixture did not reproduce the bug"}`, ...outcomes.map(outcome=>`${outcome.name}, ${outcome.guarded ? "guarded" : "control"}: ${outcome.errors.join("; ") || `all 12 zoom ticks retained; automatic margin guard released: ${outcome.marginGuardReleased}`}`)].join("\n");
    trace.textContent=JSON.stringify(outcomes,null,2);status.textContent="Complete.";
  } catch(error) {result.dataset.result="fail";result.textContent=String(error);status.textContent="Regression failed to execute.";}
  finally {button.disabled=false;}
});
