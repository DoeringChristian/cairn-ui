import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";

/** Clipboard API first; a selected textarea supports browsers denying that API. */
export async function copyText(text:string):Promise<void> {
  try {
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return;}
  } catch { /* Try the browser's user-gesture copy path before asking for manual copy. */ }
  const active=document.activeElement as HTMLElement|null;
  const selection=window.getSelection();
  const ranges=selection?Array.from({length:selection.rangeCount},(_,i)=>selection.getRangeAt(i).cloneRange()):[];
  const field=document.createElement("textarea");
  field.value=text;field.readOnly=true;field.style.cssText="position:fixed;left:0;top:0;width:1px;height:1px;opacity:0";
  document.body.appendChild(field);
  let copied=false;
  try{field.focus({preventScroll:true});field.select();copied=typeof document.execCommand==="function"&&document.execCommand("copy");}
  finally{field.remove();active?.focus({preventScroll:true});selection?.removeAllRanges();for(const range of ranges)selection?.addRange(range);}
  if(!copied)throw new Error("Your browser blocked clipboard access. Select and copy the reference below.");
}

export type SourceLocation={file:string;project_file?:string;line:number;end_line?:number;hash?:string};
export type ReferenceBlock={id:string;label?:string;source?:SourceLocation;markdown?:string;code?:string;text?:string};
type Passage={exact:string;prefix?:string;suffix?:string};
type MarkdownNode={type:string;value?:string;children?:MarkdownNode[];position?:{start:{offset?:number};end:{offset?:number}}};
export function reportReference(reportId:string,versionId:string,url:string,sourceRef?:string){
  return {schema:"cairn.report-reference/v1",ref:`report:${reportId}@${versionId}`,report_id:reportId,version_id:versionId,url,source_ref:sourceRef};
}

/** Map rendered prose back to source bytes, retaining Markdown between words. */
function passageExcerpt(markdown:string,passage:Passage):{start:number;end:number}|undefined {
  const tree=unified().use(remarkParse).use(remarkMath).use(remarkGfm).parse(markdown) as MarkdownNode;
  const characters:{text:string;start:number;end:number}[]=[];
  const maths:{start:number;end:number}[]=[];
  const visit=(node:MarkdownNode)=>{
    const start=node.position?.start.offset,end=node.position?.end.offset;
    if(node.type==='math' || node.type==='inlineMath'){
      if(start!==undefined && end!==undefined)maths.push({start,end});
      return; // The selection reader excludes both KaTeX renderings.
    }
    if(node.children){node.children.forEach(visit);return;}
    if(start===undefined || end===undefined || node.value===undefined)return;
    if(!['text','inlineCode','code'].includes(node.type))return;
    let cursor=start;
    for(const text of node.value){
      const found=markdown.indexOf(text,cursor);
      const position=found>=cursor && found<end ? found : cursor;
      characters.push({text,start:position,end:position+text.length});cursor=position+text.length;
    }
  };
  visit(tree);
  // DOM selection may collapse whitespace or introduce line breaks; normalized
  // character positions still point into the original source, not rendered text.
  const compact=characters.filter(character=>!(/\s/u.test(character.text)));
  const projected=compact.map(character=>character.text).join('');
  const exact=passage.exact.replace(/\s/gu,'');
  if(!exact)return;
  const prefix=(passage.prefix||'').replace(/\s/gu,'');
  const suffix=(passage.suffix||'').replace(/\s/gu,'');
  const matches:number[]=[];
  for(let index=projected.indexOf(exact);index>=0;index=projected.indexOf(exact,index+1))matches.push(index);
  const candidates=matches.length===1 ? matches : matches.filter(index=>
    (!prefix || projected.slice(0,index).endsWith(prefix)) && (!suffix || projected.slice(index+exact.length).startsWith(suffix)));
  if(candidates.length!==1)return;
  // JS string indexes count UTF-16 code units; retain that indexing for astral text.
  const offsets=compact.flatMap(character=>Array.from({length:character.text.length},()=>character));
  const start=offsets[candidates[0]].start;
  let end=offsets[candidates[0]+exact.length-1].end;
  // A selected mathematical clause has no visible-text offset for its final
  // KaTeX expression. Keep an immediately following expression in the quote.
  const trailingMath=maths.find(math=>math.start>=end && !markdown.slice(end,math.start).trim());
  if(trailingMath)end=trailingMath.end;
  return {start,end};
}

export function blockReference(_publication:Pick<ReturnType<typeof reportReference>,"url">,block:ReferenceBlock,passage?:Passage) {
  const source=block.source;
  if(!source?.file || !Number.isInteger(source.line) || source.line<1)throw new Error('This block has no source location.');
  const content=block.text ?? block.markdown ?? block.code ?? '';
  let excerpt=passage ? block.text !== undefined ? plainPassageExcerpt(content,passage) : passageExcerpt(content,passage) : undefined;
  if(passage && !excerpt)throw new Error("This selection cannot be located uniquely in the source. Use the block’s Copy source reference action.");
  if(!excerpt){
    // A block action identifies its first nonempty paragraph, never an entire
    // multi-paragraph chunk. Strip leading blank lines without losing line numbers.
    const start=content.search(/\S/u);
    if(start>=0){const stop=content.slice(start).search(/\n\s*\n/u);excerpt={start,end:stop<0 ? content.length : start+stop};}
  }
  const start=excerpt?.start ?? 0;
  // Frontmatter display text may fold several YAML lines. Its key's captured
  // location remains authoritative; rendered newlines cannot shift that source.
  const line=source.line+(block.text === undefined ? content.slice(0,start).match(/\n/g)?.length ?? 0 : 0);
  const quote=excerpt ? content.slice(start,excerpt.end).trim().replace(/\s+/gu,' ') : '';
  // Keep pasted references concise without JSON escaping LaTeX backslashes.
  const bounded=quote.length>300 ? `${quote.slice(0,297).trimEnd()}…` : quote;
  return `${source.project_file || source.file}:${line}${bounded ? ` "${bounded}"` : ''}`;
}

function plainPassageExcerpt(text:string, passage:Passage):{start:number;end:number}|undefined {
  if(!passage.exact)return;
  const candidates:number[]=[];
  for(let index=text.indexOf(passage.exact);index>=0;index=text.indexOf(passage.exact,index+1)) {
    if((!passage.prefix || text.slice(0,index).endsWith(passage.prefix)) && (!passage.suffix || text.slice(index+passage.exact.length).startsWith(passage.suffix))) candidates.push(index);
  }
  if(candidates.length!==1)return;
  return {start:candidates[0],end:candidates[0]+passage.exact.length};
}
/** Captured HTTP media URLs already pin the publication build. Never copy data URLs. */
export function mediaReference(item:{url:string;source?:{url?:string;block_id?:string}},position:{time?:number;clip?:{start:number;end:number};region?:{x:number;y:number;width:number;height:number}}):string {
  const url=new URL(item.url,item.source?.url);
  if(!["http:","https:"].includes(url.protocol)) {
    if(!item.source?.url)throw new Error("This media has no published reference.");
    const reportUrl=new URL(item.source.url);
    reportUrl.hash=item.source.block_id || "";
    return reportUrl.href;
  }
  const number=(value:number)=>String(Math.round(value*1000)/1000);
  const fragments:string[]=[];
  if(position.clip)fragments.push(`t=${number(position.clip.start)},${number(position.clip.end)}`);
  else if(position.time!==undefined&&Number.isFinite(position.time))fragments.push(`t=${number(position.time)}`);
  if(position.region){const r=position.region;fragments.push(`xywh=pixel:${[r.x,r.y,r.width,r.height].map(Math.round).join(",")}`);}
  url.hash=fragments.join("&");return url.href;
}
