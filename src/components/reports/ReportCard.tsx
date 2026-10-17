/** Prism2 report library card, linked to Cairn's immutable publication. */
import { ArrowUpRight, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { formatRelative } from "../../lib/format";
import { DeleteReportAction } from "./DeleteReportAction";

type Report = { id: string; name: string; updated_at: string; version_id?: string; version?: number };

export function ReportCard({ report, projectId }: { report: Report; projectId: string }) {
  return <article className="report-card" aria-labelledby={`report-title-${report.id}`}>
    <div className="report-card-top"><span className="document-icon" aria-hidden="true"><FileText size={24} /></span><div className="report-card-actions"><span className="report-published">Published{report.version !== undefined && <> · v{report.version}</>}</span><DeleteReportAction projectId={projectId} reportId={report.id} versionId={report.version_id} name={report.name} /></div></div>
    <p className="eyebrow">{projectId}</p>
    <h2 id={`report-title-${report.id}`}><Link className="report-card-link" to={`/p/${encodeURIComponent(projectId)}/reports/${report.id}`}>{report.name}</Link></h2>
    <p>Executable source with pinned evidence and versioned builds.</p>
    <div className="report-card-footer"><time dateTime={report.updated_at} title={new Date(report.updated_at).toLocaleString()}>Updated {formatRelative(report.updated_at)}</time><span>Open report <ArrowUpRight size={12} aria-hidden="true" /></span></div>
  </article>;
}
