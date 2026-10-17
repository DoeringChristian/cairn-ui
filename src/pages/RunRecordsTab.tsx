import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, errorText } from "../api/client";
import { Select } from "../prism/Select";
import { ReportPlot } from "../components/reports/native/ReportPlot";

function RecordValue({value}: {value: unknown}) {
  if (value && typeof value === "object" && "$media" in value) {
    const media = (value as {$media: {hash: string; mime_type: string; object_type: string}}).$media;
    const url = api.artifactUrl(media.hash);
    return <a href={url} target="_blank" rel="noreferrer" className="text-accent">{media.mime_type.startsWith("image/") ? <img src={url} alt={media.object_type} className="max-h-24 max-w-40 rounded object-contain" loading="lazy" /> : `Open ${media.object_type}`}</a>;
  }
  if (value !== null && typeof value === "object") return <details><summary className="cursor-pointer text-fg-muted">{Array.isArray(value) ? `${value.length} items` : "Object"}</summary><pre className="max-w-sm overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(value, null, 2)}</pre></details>;
  return <span>{value === null ? "null" : String(value)}</span>;
}

export default function RunRecordsTab() {
  const {runId = ""} = useParams();
  const [cursor, setCursor] = useState(0), [back, setBack] = useState<number[]>([]);
  const [y, setY] = useState(""), [x, setX] = useState("step");
  const [field, setField] = useState(""), [operator, setOperator] = useState("eq"), [text, setText] = useState("");
  const [where, setWhere] = useState<Record<string, unknown> | undefined>();
  const fields = useQuery({queryKey:["record-fields",runId],queryFn:()=>api.runRecordFields(runId)});
  const rows = useQuery({queryKey:["records",runId,cursor,where],queryFn:()=>api.runRecords(runId,cursor,where)});
  const chart = useQuery({queryKey:["record-series",runId,y,x,where],queryFn:()=>api.runRecordSeries(runId,y,x,where),enabled:!!y});
  const columns = useMemo(()=>Array.from(new Set(rows.data?.items.flatMap(row=>Object.keys(row.values)) || [])),[rows.data]);
  const numeric = fields.data?.fields.filter(field=>field.types.includes("number")) || [];
  const figure = useMemo(()=>({data:[{type:"scatter",mode:"lines+markers",x:chart.data?.points.map(p=>p.x)||[],y:chart.data?.points.map(p=>p.y)||[]}],layout:{margin:{l:55,r:20,t:30,b:50},paper_bgcolor:"#fffef9",plot_bgcolor:"#fffef9",font:{color:"#202621"},colorway:["#176b5b"],xaxis:{title:{text:x||"Observation"}},yaxis:{title:{text:y}}}}),[chart.data,x,y]);
  const apply = () => {
    let value: unknown = text;
    try {value=JSON.parse(text);} catch {/* Unquoted text is a string. */}
    setWhere(field ? {[field]:{[operator]:operator==="exists" ? text !== "false" : value}} : undefined);
    setCursor(0);setBack([]);
  };
  return <section className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Y field<Select label="Y field" value={y} onChange={setY} options={[{value:"",label:"Table only"},...numeric.map(f=>({value:f.path,label:f.path}))]}/></label>
      <label className="text-sm">X field<Select label="X field" value={x} onChange={setX} options={[{value:"step",label:"Step, or observation order"},{value:"",label:"Observation order"},...numeric.filter(f=>f.path!=="/step").map(f=>({value:f.path,label:f.path}))]}/></label>
      <button className="btn ml-auto" onClick={()=>{void rows.refetch();void fields.refetch();if(y)void chart.refetch();}}>Refresh</button>
    </div>
    <form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();apply();}}>
      <label className="text-sm">Filter field<input className="input block mt-1" list="record-fields" value={field} onChange={e=>setField(e.target.value)} placeholder="Any field path" /></label>
      <datalist id="record-fields">{fields.data?.fields.map(f=><option key={f.path} value={f.path}/>)}</datalist>
      <Select label="Filter operator" value={operator} onChange={setOperator} options={[["eq","equals"],["ne","does not equal"],["gt","greater than"],["gte","at least"],["lt","less than"],["lte","at most"],["contains","contains"],["exists","exists"]].map(([value,label])=>({value,label}))}/>
      <input aria-label="Filter value" className="input" value={text} onChange={e=>setText(e.target.value)} placeholder="Value" />
      <button className="btn" type="submit">Apply</button>{where && <button className="btn" type="button" onClick={()=>{setWhere(undefined);setCursor(0);setBack([]);}}>Clear</button>}
    </form>
    {fields.isError && <p role="alert">{errorText(fields.error)}</p>}
    {rows.isError && <p role="alert">{errorText(rows.error)}</p>}
    {chart.isError && <p role="alert">{errorText(chart.error)}</p>}
    {y && chart.data && <><ReportPlot figure={figure} title={y}/>{chart.data.truncated && <p className="text-sm text-fg-muted">Chart reached the scan limit; narrow the filter to inspect more specific data.</p>}</>}
    <div className="max-w-full overflow-x-auto rounded border border-border">
      <table className="w-full text-left text-sm"><thead className="bg-bg-elevated"><tr><th className="p-3">Observation</th>{columns.map(key=><th className="p-3" key={key}>{key}</th>)}</tr></thead><tbody>{rows.data?.items.map(row=><tr className="border-t border-border" key={row.event_id}><td className="p-3 align-top text-fg-muted" title={row.timestamp}>{row.event_id}</td>{columns.map(key=><td className="p-3 align-top max-w-sm break-words" key={key}>{Object.prototype.hasOwnProperty.call(row.values,key) ? <RecordValue value={row.values[key]}/> : <span className="text-fg-muted">—</span>}</td>)}</tr>)}</tbody></table>
      {rows.isLoading && <p className="p-4 text-fg-muted">Loading records…</p>}{rows.data?.items.length===0 && <p className="p-4 text-fg-muted">No matching records.</p>}
    </div>
    <div className="flex items-center gap-3 text-sm"><button className="btn" disabled={!back.length} onClick={()=>{setCursor(back[back.length-1]);setBack(back.slice(0,-1));}}>Previous</button><button className="btn" disabled={rows.data?.next_cursor==null} onClick={()=>{setBack([...back,cursor]);setCursor(rows.data!.next_cursor!);}}>Next</button><span className="text-fg-muted">{rows.data?.items.length||0} records on this page</span></div>
  </section>;
}
