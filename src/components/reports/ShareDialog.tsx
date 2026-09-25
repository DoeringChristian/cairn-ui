/**
 * Share a report by link: create one (with an expiry), copy it, and list or
 * revoke the report's links.
 *
 * A link's secret is shown once, right after it is created — the server
 * keeps only its hash, so a lost link cannot be shown again (create another
 * and revoke the old one). Whoever opens a link sees this report and its runs,
 * read-only, until it expires or is revoked. Links need auth: on a
 * `--no-auth` server anyone who can reach it can already read the report.
 */

import { useState } from "react";
import { copyText } from "../../lib/clipboard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useSession } from "../../api/hooks";
import { qk } from "../../api/query-keys";
import type { ReportShare, ReportShareCreated } from "../../api/types";
import { formatRelative } from "../../lib/format";
import Dialog, { DialogBody } from "../ui/Dialog";
import { Segmented, type SegmentedOption } from "../settings/palette";

type Expiry = "1" | "7" | "30" | "90" | "365";

const EXPIRY_OPTIONS: ReadonlyArray<SegmentedOption<Expiry>> = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
];

const STATUS_CLASS: Record<ReportShare["status"], string> = {
  active: "text-status-completed",
  expired: "text-fg-subtle",
  revoked: "text-status-failed",
};

interface Props {
  projectId: string;
  reportId: string;
  open: boolean;
  onClose: () => void;
}

export default function ShareDialog({ projectId, reportId, open, onClose }: Props) {
  const session = useSession();
  const authEnabled = session.data?.auth_enabled !== false;
  const queryClient = useQueryClient();
  const [expiry, setExpiry] = useState<Expiry>("30");
  const [created, setCreated] = useState<ReportShareCreated | null>(null);
  const [copied, setCopied] = useState(false);

  const shares = useQuery({
    queryKey: qk.reportShares(projectId, reportId),
    queryFn: () => api.reportShares(projectId, reportId),
    enabled: open && authEnabled,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.reportShares(projectId, reportId) });

  const create = useMutation({
    mutationFn: () => {
      const expiresAt = new Date(Date.now() + Number(expiry) * 86_400_000).toISOString();
      return api.createReportShare(projectId, reportId, expiresAt);
    },
    onSuccess: (res) => {
      setCreated(res);
      setCopied(false);
      void refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (shareId: string) => api.revokeReportShare(projectId, reportId, shareId),
    onSuccess: (_res, shareId) => {
      if (created?.id === shareId) setCreated(null);
      void refresh();
    },
  });

  const link = created ? `${window.location.origin}${created.url}` : "";
  const copy = () => {
    void copyText(link).then(setCopied);
  };
  const close = () => {
    // The secret is shown once; closing forgets it.
    setCreated(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} title="Share report" size="2xl">
      <DialogBody>
        {!authEnabled ? (
          <p className="text-sm text-fg-muted">
            Share links need auth. This server runs with <span className="mono">--no-auth</span>, so
            anyone who can reach it can already read this report.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-fg-muted">
              Anyone with the link sees this report and its runs, read-only: they can explore the cards,
              but not edit, comment, or open other runs.
            </p>

            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1">
                <Segmented label="Expires after" value={expiry} onChange={setExpiry} options={EXPIRY_OPTIONS} />
              </div>
              <button
                type="button"
                className="btn text-xs"
                disabled={create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? "Creating…" : "Create link"}
              </button>
            </div>
            {create.isError && (
              <p className="text-xs text-status-failed">Could not create a link: {String(create.error)}</p>
            )}

            {created && (
              <div className="rounded border border-accent/40 bg-accent/10 p-3">
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={link}
                    onFocus={(e) => e.currentTarget.select()}
                    className="input mono min-w-0 flex-1 text-xs"
                    aria-label="Share link"
                  />
                  <button type="button" className="btn text-xs" onClick={copy}>
                    <i className={`fa-solid ${copied ? "fa-check" : "fa-copy"}`} aria-hidden="true" />{" "}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-fg-muted">
                  Copy it now: the link is shown only once. Expires{" "}
                  {new Date(created.expires_at).toLocaleString()}.
                </p>
              </div>
            )}

            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-subtle">Links</h3>
              {shares.isLoading ? (
                <p className="text-xs text-fg-muted">Loading…</p>
              ) : shares.isError ? (
                <p className="text-xs text-status-failed">Could not list links: {String(shares.error)}</p>
              ) : (shares.data?.shares.length ?? 0) === 0 ? (
                <p className="text-xs text-fg-muted">No links yet.</p>
              ) : (
                <ul className="divide-y divide-border-subtle rounded border border-border-subtle">
                  {shares.data!.shares.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                      <span className={`w-14 font-medium ${STATUS_CLASS[s.status]}`}>{s.status}</span>
                      <span className="text-fg-muted" title={s.created_at}>
                        created {formatRelative(s.created_at)}
                        {s.created_by ? ` by ${s.created_by}` : ""}
                      </span>
                      <span className="text-fg-muted" title={s.expires_at}>
                        {s.status === "revoked"
                          ? `revoked ${formatRelative(s.revoked_at!)}`
                          : `${s.status === "expired" ? "expired" : "expires"} ${new Date(s.expires_at).toLocaleDateString()}`}
                      </span>
                      {s.status === "active" && (
                        <button
                          type="button"
                          className="btn ml-auto text-xs hover:text-status-failed"
                          disabled={revoke.isPending}
                          onClick={() => revoke.mutate(s.id)}
                        >
                          Revoke
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogBody>
    </Dialog>
  );
}
