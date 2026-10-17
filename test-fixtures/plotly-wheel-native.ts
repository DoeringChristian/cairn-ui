/** Dev-only regression: exercise through browser scroll, never dispatchEvent. */
import {loadPlotly} from '../src/charts/plotly-loader';
import {guardCartesianWheel} from '../src/charts/plotly-wheel';

type Plot = HTMLDivElement & {
  _fullLayout: {_replotting?:boolean; xaxis:{range:number[]}; yaxis:{range:number[]}};
};
type Sample = {tick:number; phase:string; trusted?:boolean; prevented?:boolean; guard:boolean; xSpan:number; ySpan:number; expectedX:number; expectedY:number};
const plot=document.querySelector<HTMLDivElement>('#plot')! as Plot;
const result=document.querySelector<HTMLElement>('#result')!;
const status=document.querySelector<HTMLElement>('#status')!;
const trace=document.querySelector<HTMLElement>('#trace')!;
const reset=document.querySelector<HTMLButtonElement>('#reset')!;
const logarithmic=document.querySelector<HTMLInputElement>('#logarithmic')!;
const Plotly=await loadPlotly();
let samples:Sample[]=[], errors=new Set<string>();
let trusted=0, checkpoints=0, guardedCheckpoints=0, immediate=0;
let expectedX=0, expectedY=0, generation=0, settledTimer=0, ready=false;
const close=(value:number,expected:number)=>Math.abs(value/expected-1)<1e-6;
function record(phase:string,event?:WheelEvent):Sample {
  const layout=plot._fullLayout;
  const sample={tick:trusted,phase,trusted:event?.isTrusted,prevented:event?.defaultPrevented,guard:layout._replotting===true,
    xSpan:layout.xaxis.range[1]-layout.xaxis.range[0],ySpan:layout.yaxis.range[1]-layout.yaxis.range[0],expectedX,expectedY};
  samples.push(sample);
  // Keep the UI stable and the trace bounded during long manual gestures.
  if(samples.length>300)samples.shift();
  trace.textContent=JSON.stringify(samples,null,2);
  return sample;
}
function retention(sample:Sample):boolean {
  return close(sample.xSpan,sample.expectedX) && close(sample.ySpan,sample.expectedY);
}
function render(settled=false) {
  const last=samples[samples.length-1];
  const tested=trusted>=3 && checkpoints>0;
  const pass=tested && errors.size===0 && settled;
  const label=errors.size ? 'FAIL' : pass ? 'PASS' : trusted ? 'RUNNING' : 'READY';
  result.dataset.result=label.toLowerCase();
  status.textContent=`${label} · ${logarithmic.checked ? 'Logarithmic Y axis' : 'Linear axes'}`;
  result.textContent=[
    `Trusted wheel events: ${trusted}`,
    `Guard held at pre-target microtask: ${guardedCheckpoints}/${checkpoints}`,
    `Immediate ranges retained: ${immediate}/${trusted}`,
    `Settled ranges retained: ${settled && last ? retention(last) : 'waiting for pause'}`,
    `Guard released after settling: ${settled && last ? !last.guard : 'waiting for pause'}`,
    `Current / expected X span: ${last?.xSpan.toPrecision(9) ?? '—'} / ${expectedX.toPrecision(9)}`,
    ...errors,
    ...(!tested ? ['Use at least three wheel events over the plot center.'] : []),
  ].join('\n');
}
async function initialize() {
  ready=false;reset.disabled=true;clearTimeout(settledTimer);generation++;
  Plotly.purge(plot);
  samples=[];errors=new Set();trusted=0;checkpoints=0;guardedCheckpoints=0;immediate=0;
  await Plotly.newPlot(plot,[{type:'scatter',mode:'lines',x:[0,.5,1,1.5,2],y:[1,.2,.1,.02,.01]}],{
    width:680,height:360,margin:{l:48,r:12,t:12,b:36},
    xaxis:{automargin:true},yaxis:{automargin:true,type:logarithmic.checked ? 'log' : 'linear'},
  },{scrollZoom:true,displayModeBar:true,responsive:false});
  expectedX=plot._fullLayout.xaxis.range[1]-plot._fullLayout.xaxis.range[0];
  expectedY=plot._fullLayout.yaxis.range[1]-plot._fullLayout.yaxis.range[0];
  ready=true;reset.disabled=false;record('initial');render();
}
plot.addEventListener('wheel',event=>{
  if(!ready || !(event.target instanceof Element) || !event.target.closest('.nsewdrag'))return;
  if(!event.isTrusted){errors.add('Synthetic wheel input does not validate browser listener checkpoints.');render();return;}
  trusted++;
  const zoom=Math.exp(Math.min(Math.max(event.deltaY,-20),20)/200);
  expectedX*=zoom;expectedY*=zoom;
  guardCartesianWheel(plot,event);record('capture',event);
  const currentGeneration=generation;
  queueMicrotask(()=>{
    if(generation!==currentGeneration)return;
    const sample=record('microtask',event);
    if(!event.defaultPrevented){
      checkpoints++;
      if(sample.guard)guardedCheckpoints++;
      else errors.add('Guard released before the Plotly target listener.');
    }
  });
},{capture:true,passive:true});
plot.addEventListener('wheel',event=>{
  if(!ready || !event.isTrusted || !(event.target instanceof Element) || !event.target.closest('.nsewdrag'))return;
  const sample=record('bubble',event);
  if(retention(sample))immediate++;
  else errors.add('Immediate range lost wheel motion (snapback).');
  clearTimeout(settledTimer);
  settledTimer=window.setTimeout(()=>{
    const settled=record('settled');
    if(!retention(settled))errors.add('Settled range lost wheel motion.');
    if(settled.guard)errors.add('Automatic margin guard remained active after settling.');
    render(true);
  },200);
  render();
},{passive:true});
reset.addEventListener('click',()=>void initialize());
logarithmic.addEventListener('change',()=>void initialize());
await initialize();
