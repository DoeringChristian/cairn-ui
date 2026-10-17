import {test} from "node:test";
import assert from "node:assert/strict";
import {copyText,reportReference,blockReference,mediaReference} from "./clipboard.ts";

test("block references quote the first source paragraph at its precise project-relative line",()=>{
  const publication=reportReference("report","version-1","https://example.test/report?version=version-1");
  assert.equal(blockReference(publication,{id:"prose",markdown:"\nThe manifest supports inspection.[^note]\n\n[^note]: Details\n",source:{file:"report.qmd",project_file:"reports/methods/report.qmd",line:113,end_line:120}}),'reports/methods/report.qmd:114 "The manifest supports inspection.[^note]"');
  assert.equal(blockReference(publication,{id:"card",source:{file:"nested/part.md",line:8}}),"nested/part.md:8");
  assert.throws(()=>blockReference(publication,{id:"generated"}),/no source location/);
});
test("selected passages preserve source math and identify the selected line",()=>{
  const block={id:"prose",source:{file:"report.md",project_file:"reports/height-criteria/report.md",line:280},markdown:String.raw`An earlier paragraph.

Another paragraph.

Setup.

with three columns, the cost is $\sigma_3(W)/\sigma_2(W)$.

The following conclusion.`};
  assert.equal(blockReference({url:"https://example.test"},block,{exact:"with three columns, the cost is .",prefix:"Setup.",suffix:"The following conclusion."}),String.raw`reports/height-criteria/report.md:286 "with three columns, the cost is $\sigma_3(W)/\sigma_2(W)$."`);
  assert.equal(blockReference({url:"https://example.test"},block,{exact:"with three columns, the cost is ",prefix:"Setup.",suffix:".The following conclusion."}),String.raw`reports/height-criteria/report.md:286 "with three columns, the cost is $\sigma_3(W)/\sigma_2(W)$"`);
});
test("selection maps emphasis, links and repeated text to original source",()=>{
  const block={id:"prose",source:{file:"nested/part.md",line:7},markdown:"A result.\n\nThe **second** [result](https://example.test) is useful.\n\nA result."};
  assert.equal(blockReference({url:"https://example.test"},block,{exact:"second result is useful.",prefix:"A result.The ",suffix:"A result."}),'nested/part.md:9 "second** [result](https://example.test) is useful."');
  assert.equal(blockReference({url:"https://example.test"},block,{exact:"A result.",prefix:"is useful.",suffix:""}),'nested/part.md:11 "A result."');
});
test("unique selected prose ignores surrounding rendered footnote context and ambiguous selections fail explicitly",()=>{
  const block={id:"prose",source:{file:"report.qmd",line:1},markdown:"Earlier.\n\nUnique later passage.\n\nRepeated.\n\nRepeated."};
  assert.equal(blockReference({url:"https://example.test"},block,{exact:"Unique later passage.",prefix:"unrelated UI",suffix:"1footnote"}),'report.qmd:3 "Unique later passage."');
  assert.throws(()=>blockReference({url:"https://example.test"},block,{exact:"Repeated."}),/cannot be located uniquely/);
  assert.throws(()=>blockReference({url:"https://example.test"},block,{exact:"Missing."}),/cannot be located uniquely/);
});
test("quotes are bounded, and references never contain a publication URL or line range",()=>{
  const reference=blockReference({url:"https://example.test/report?version=1"},{id:"prose",source:{file:"report.qmd",line:2,end_line:8},markdown:"x".repeat(1000)});
  assert.equal(reference,'report.qmd:2 "'+"x".repeat(297)+'…"');
  assert.doesNotMatch(reference,/https:|:2-8/);
});
test("media links retain captured version and compact standard time/region fragments",()=>{
  const item={url:"https://example.test/api/reports/report/builds/version-1/media/movie.mp4"};
  assert.equal(mediaReference(item,{time:1.23456}),item.url+"#t=1.235");
  assert.equal(mediaReference(item,{time:9,clip:{start:1,end:3}}),item.url+"#t=1,3");
  assert.equal(mediaReference(item,{region:{x:10,y:20,width:30,height:40}}),item.url+"#xywh=pixel:10,20,30,40");
});
test("embedded media references never include payload bytes",()=>{
  assert.equal(mediaReference({url:"data:image/png;base64,"+"x".repeat(100000),source:{url:"https://example.test/report?version=1",block_id:"figure"}},{}),"https://example.test/report?version=1#figure");
  assert.throws(()=>mediaReference({url:"data:image/png;base64,abc"},{}),/no published reference/);
});

test("clipboard API copies exact text",async()=>{
  const prior=Object.getOwnPropertyDescriptor(globalThis,"navigator");let copied="";
  Object.defineProperty(globalThis,"navigator",{configurable:true,value:{clipboard:{writeText:async(value:string)=>{copied=value;}}}});
  try{await copyText("immutable reference");assert.equal(copied,"immutable reference");}
  finally{if(prior)Object.defineProperty(globalThis,"navigator",prior);else Reflect.deleteProperty(globalThis,"navigator");}
});

test("denied clipboard uses fallback and failed fallback gives actionable feedback",async()=>{
  const names=["navigator","document","window"] as const;
  const prior=names.map(name=>Object.getOwnPropertyDescriptor(globalThis,name));let removed=false;let copied=true;let restored=false;
  const field={value:"",readOnly:false,style:{cssText:""},focus:()=>{},select:()=>{},remove:()=>{removed=true;}};
  Object.defineProperty(globalThis,"navigator",{configurable:true,value:{clipboard:{writeText:async()=>{throw new Error("denied");}}}});
  Object.defineProperty(globalThis,"document",{configurable:true,value:{activeElement:{focus:()=>{restored=true;}},body:{appendChild:()=>{}},createElement:()=>field,execCommand:()=>copied}});
  Object.defineProperty(globalThis,"window",{configurable:true,value:{getSelection:()=>null}});
  try{await copyText("fallback");assert.equal(field.value,"fallback");assert.ok(removed&&restored);copied=false;await assert.rejects(copyText("manual"),/Select and copy/);}
  finally{names.forEach((name,i)=>{if(prior[i])Object.defineProperty(globalThis,name,prior[i]!);else Reflect.deleteProperty(globalThis,name);});}
});
