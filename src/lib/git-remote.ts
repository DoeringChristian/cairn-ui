/** Browser URL for a git remote, or null when it isn't web-browsable.
 *
 * https remotes link as-is (minus a trailing ``.git``); ``git@host:owner/repo``
 * and ``ssh://git@host/owner/repo`` map to ``https://host/owner/repo`` for the
 * well-known forges (GitHub, GitLab, Bitbucket). */
const FORGES = ["github.com", "gitlab.com", "bitbucket.org"];

export function remoteHref(remote: string | null | undefined): string | null {
  if (!remote) return null;
  const strip = (s: string) => s.replace(/\.git$/, "").replace(/\/$/, "");
  if (/^https?:\/\//.test(remote)) return strip(remote);
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(remote);
  const ssh = /^ssh:\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/(.+)$/.exec(remote);
  const m = scp ?? ssh;
  if (!m || !FORGES.includes(m[1])) return null;
  return `https://${m[1]}/${strip(m[2])}`;
}
