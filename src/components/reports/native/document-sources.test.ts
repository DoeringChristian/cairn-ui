import test from "node:test";
import assert from "node:assert/strict";
import { capturedHeadingSources, loadHeadingSources, projectSource, referenceBlock, TITLE_TARGET, DESCRIPTION_TARGET } from "./document-sources.ts";
import { blockReference } from "./clipboard.ts";

test("title and description references use their captured YAML key locations", () => {
  const expected = {title: "Height [criteria]", description: "First line\nSecond line\n"};
  const sources = capturedHeadingSources('---\n# A note\ntitle: "Height [criteria]"\ndescription: |\n  First line\n  Second line\n---\n\n# Findings\n', "study.qmd", expected);
  assert.deepEqual(sources, {title_source: {file: "study.qmd", line: 3}, description_source: {file: "study.qmd", line: 4}});
  const document = {...expected, ...sources, blocks: []};
  const title = referenceBlock(document, TITLE_TARGET)!;
  title.source = projectSource(title.source, "height-criteria");
  assert.equal(blockReference({url:"https://example.test"}, title), 'reports/height-criteria/study.qmd:3 "Height [criteria]"');
  assert.equal(blockReference({url:"https://example.test"}, referenceBlock(document, DESCRIPTION_TARGET)!, {exact:"Second line", prefix:"First line\n", suffix:"\n"}), 'study.qmd:4 "Second line"');
});

test("an unavailable or mismatched title never receives a guessed source line", () => {
  const expected = {title:"Published title"};
  assert.deepEqual(capturedHeadingSources("# Published title", "report.md", expected), {});
  assert.deepEqual(capturedHeadingSources("---\ntitle: Another title\n---", "report.qmd", expected), {});
  assert.deepEqual(capturedHeadingSources("---\ntitle: [invalid\n---", "report.qmd", expected), {});
  const title = referenceBlock({...expected, blocks:[]}, TITLE_TARGET)!;
  assert.throws(() => blockReference({url:"https://example.test"},title), /no source location/);
});

test("heading lookups leave included-file and figure source identities intact", () => {
  const figure = {id:"figure", source:{file:"parts/analysis.qmd",line:42},code:"plot(data)"};
  assert.equal(referenceBlock({title:"Study",blocks:[figure]},"figure"),figure);
  assert.deepEqual(projectSource(figure.source,"study"),{file:"parts/analysis.qmd",line:42,project_file:"reports/study/parts/analysis.qmd"});
  assert.equal(referenceBlock({title:"Study",blocks:[figure]},"missing"),undefined);
});

test("older publications recover title source only from the pinned captured entry", async () => {
  const original = globalThis.fetch;
  const urls:string[]=[];
  globalThis.fetch = async (input) => {
    const url = String(input); urls.push(url);
    if (url.endsWith("/study/manifest.json")) return Response.json({entry:"chapters/study.qmd"});
    if (url.endsWith("/sources/chapters/study.qmd")) return new Response('---\n# metadata\ntitle: Study\n---\n');
    return new Response("",{status:404});
  };
  try {
    const document = {title:"Study", blocks:[]};
    assert.deepEqual(await loadHeadingSources(document,"https://example.test/api/reports/r/builds/v1/study/document.json",new AbortController().signal),{title_source:{file:"chapters/study.qmd",line:3}});
    assert.deepEqual(urls,["https://example.test/api/reports/r/builds/v1/study/manifest.json","https://example.test/api/reports/r/builds/v1/sources/chapters/study.qmd"]);
    urls.length=0;
    await loadHeadingSources({...document,title_source:{file:"report.qmd",line:2}},"https://example.test/document.json",new AbortController().signal);
    assert.deepEqual(urls,[]);
  } finally {globalThis.fetch=original;}
});

test("ambiguous legacy entries and unsafe capture paths do not produce references", async () => {
  const original = globalThis.fetch;
  let manifest:unknown={sources:{"report.qmd":"a","report.md":"b"}};
  let requests=0;
  globalThis.fetch=async()=>{requests++;return Response.json(manifest);};
  try {
    const load=()=>loadHeadingSources({title:"Study",blocks:[]},"https://example.test/study/document.json",new AbortController().signal);
    assert.deepEqual(await load(),{});
    manifest={entry:"../../outside.qmd"};
    assert.deepEqual(await load(),{});
    assert.equal(requests,2);
  } finally {globalThis.fetch=original;}
});
