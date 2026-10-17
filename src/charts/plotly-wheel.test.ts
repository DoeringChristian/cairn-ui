import {test} from "node:test";
import assert from "node:assert/strict";
import {guardCartesianWheel} from "./plotly-wheel.ts";

/** The guard's admission/cleanup contract; actual zoom uses the browser fixture. */
class FakeElement {
  kind = "cartesian";
  graph: unknown;
  closest(selector: string): unknown {
    if(selector === ".js-plotly-plot")return this.graph;
    if(selector === ".draglayer")return this.kind === "outside" ? null : this;
    return this.kind === "corner" || this.kind === "outside" ? null : this;
  }
}
Object.defineProperty(globalThis,"Element",{value:FakeElement,configurable:true});
function setup() {
  const graph={_fullLayout:{_replotting:false,_enablescrollzoom:false},_context:{staticPlot:false,_scrollZoom:{cartesian:true}},_transitioningWithDuration:false};
  const target=new FakeElement();target.graph=graph;
  const event={target,deltaY:-20,defaultPrevented:false};
  const run=()=>guardCartesianWheel(graph as unknown as HTMLElement,event as unknown as WheelEvent);
  return {graph,target,event,run};
}
const microtask=()=>new Promise<void>(resolve=>queueMicrotask(resolve));
const nextTask=()=>new Promise<void>(resolve=>setTimeout(resolve,0));

test("consumed Cartesian wheel preserves guard until Plotly's own dragTail",async()=>{
  const {graph,event,run}=setup();run();
  assert.equal(graph._fullLayout._replotting,true);
  event.defaultPrevented=true;await nextTask();
  assert.equal(graph._fullLayout._replotting,true);
});
test("unconsumed wheel restores the preceding guard instead of leaving margins frozen",async()=>{
  for(const previous of [false,true]) {
    const {graph,run}=setup();graph._fullLayout._replotting=previous;run();await nextTask();
    assert.equal(graph._fullLayout._replotting,previous);
  }
});
test("unrelated and disabled interaction paths never acquire the margin guard",()=>{
  const scenarios=[
    (s:ReturnType<typeof setup>)=>{s.graph._context._scrollZoom.cartesian=false;},
    (s:ReturnType<typeof setup>)=>{s.graph._context.staticPlot=true;},
    (s:ReturnType<typeof setup>)=>{s.graph._transitioningWithDuration=true;},
    (s:ReturnType<typeof setup>)=>{s.event.deltaY=NaN;},
    (s:ReturnType<typeof setup>)=>{s.target.kind="corner";},
    (s:ReturnType<typeof setup>)=>{s.target.kind="outside";},
    (s:ReturnType<typeof setup>)=>{s.target.graph={};},
  ];
  for(const alter of scenarios){const value=setup();alter(value);value.run();assert.equal(value.graph._fullLayout._replotting,false);}
});
test("explicit plot scroll override is admitted",async()=>{
  const {graph,run}=setup();graph._context._scrollZoom.cartesian=false;graph._fullLayout._enablescrollzoom=true;
  run();assert.equal(graph._fullLayout._replotting,true);await nextTask();assert.equal(graph._fullLayout._replotting,false);
});
test("cleanup does not overwrite a replacement layout",async()=>{
  const {graph,run}=setup();run();graph._fullLayout={_replotting:true,_enablescrollzoom:false};
  await nextTask();assert.equal(graph._fullLayout._replotting,true);
});

// Native input checkpoints microtasks after each listener; dispatchEvent does not.
test("guard survives the checkpoint before Plotly consumes a trusted wheel",async()=>{
  const {graph,event,run}=setup();run();
  await microtask();
  assert.equal(graph._fullLayout._replotting,true,"must still guard Plotly target listener");
  event.defaultPrevented=true;
  await nextTask();
  assert.equal(graph._fullLayout._replotting,true,"consumed wheel waits for native dragTail");
  graph._fullLayout._replotting=false; // Plotly's dragTail commits the range and releases it.
});
