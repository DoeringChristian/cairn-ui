/**
 * An artifact's bytes as text, through the query cache. The hash names
 * immutable content, so a fetched text is never refetched, and a card can
 * prefetch the steps around its slider with the very query its panes read.
 */

import { api } from "../../api/client";
import { qk } from "../../api/query-keys";

export const artifactTextQuery = (hash: string) => ({
  queryKey: qk.artifactText(hash),
  queryFn: async (): Promise<string> => {
    const res = await fetch(api.artifactUrl(hash));
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.text();
  },
  staleTime: Infinity,
});
