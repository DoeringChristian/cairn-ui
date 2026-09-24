// ---------------------------------------------------------------------------
// Template storage: one localStorage list per project, mirrored to a server
// table. Comparison templates and report templates are the same data under
// different storage keys and endpoints — see `createTemplateStore`.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { loadJson, saveJson } from "../storage";
import { newId } from "../reports/ids";
import type { ComparisonTemplateCard } from "../comparisons/template-cards";

export type TemplateCard = ComparisonTemplateCard;

export interface Template {
  id: string;
  name: string;
  createdAt: string;
  cards: TemplateCard[];
  /** Server-side ID (set after first save to server). */
  serverId?: string;
}

/** The server endpoints one template kind is stored under. */
export interface TemplateServer {
  list: (projectId: string) => Promise<Array<{ id: string; name: string; created_at: string }>>;
  get: (projectId: string, id: string) => Promise<{ payload: Record<string, unknown> }>;
  create: (projectId: string, name: string, payload: Record<string, unknown>) => Promise<{ id: string }>;
  update: (projectId: string, id: string, body: { name: string; payload: Record<string, unknown> }) => Promise<unknown>;
  remove: (projectId: string, id: string) => Promise<unknown>;
}

export interface TemplateStore {
  load: (projectId: string) => Template[];
  save: (projectId: string, list: Template[]) => void;
  create: (projectId: string, name: string, cards: TemplateCard[]) => Template;
  remove: (projectId: string, templateId: string) => void;
  /** Merge server-only templates into localStorage and push local-only ones up. */
  syncFromServer: (projectId: string) => Promise<void>;
  /** A project's templates, kept current across components and tabs. */
  useTemplates: (projectId: string) => { templates: Template[]; refresh: () => void };
}

function isTemplateCard(x: unknown): x is TemplateCard {
  if (!x || typeof x !== "object") return false;
  const c = x as Partial<TemplateCard>;
  return typeof c.type === "string" && c.type.length > 0 && Array.isArray(c.keys);
}

function isTemplate(x: unknown): x is Template {
  if (!x || typeof x !== "object") return false;
  const t = x as Partial<Template>;
  return typeof t.id === "string" && typeof t.name === "string" && Array.isArray(t.cards);
}

export function createTemplateStore(
  storageKey: (projectId: string) => string,
  server: TemplateServer,
): TemplateStore {
  const changed = new EventTarget();

  function load(projectId: string): Template[] {
    const parsed = loadJson<unknown[]>(localStorage, storageKey(projectId));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTemplate).map((t) => ({ ...t, cards: t.cards.filter(isTemplateCard) }));
  }

  function save(projectId: string, list: Template[]): void {
    saveJson(localStorage, storageKey(projectId), list);
    changed.dispatchEvent(new CustomEvent("change", { detail: projectId }));
  }

  /** Save one template to the server (fire-and-forget). */
  function push(projectId: string, tmpl: Template): void {
    const payload = { cards: tmpl.cards };
    if (tmpl.serverId) {
      server.update(projectId, tmpl.serverId, { name: tmpl.name, payload }).catch(() => {});
      return;
    }
    server.create(projectId, tmpl.name, payload)
      .then((res) => {
        // Record the server id without notifying — nothing visible changed.
        const updated = load(projectId).map((t) => (t.id === tmpl.id ? { ...t, serverId: res.id } : t));
        saveJson(localStorage, storageKey(projectId), updated);
      })
      .catch(() => {});
  }

  function create(projectId: string, name: string, cards: TemplateCard[]): Template {
    const tmpl: Template = {
      id: newId(),
      name: name || "Untitled template",
      createdAt: new Date().toISOString(),
      cards,
    };
    save(projectId, [...load(projectId), tmpl]);
    push(projectId, tmpl);
    return tmpl;
  }

  function remove(projectId: string, templateId: string): void {
    const list = load(projectId);
    const tmpl = list.find((t) => t.id === templateId);
    if (tmpl?.serverId) server.remove(projectId, tmpl.serverId).catch(() => {});
    save(projectId, list.filter((t) => t.id !== templateId));
  }

  async function syncFromServer(projectId: string): Promise<void> {
    try {
      const serverList = await server.list(projectId);
      const local = load(projectId);
      const localServerIds = new Set(local.map((t) => t.serverId).filter(Boolean));
      let added = false;

      for (const st of serverList) {
        if (localServerIds.has(st.id)) continue;
        try {
          const { payload } = await server.get(projectId, st.id);
          const cards = Array.isArray(payload.cards) ? payload.cards.filter(isTemplateCard) : [];
          local.push({ id: newId(), serverId: st.id, name: st.name, createdAt: st.created_at, cards });
          added = true;
        } catch { /* skip failed fetches */ }
      }

      for (const t of local) {
        if (!t.serverId) push(projectId, t);
      }

      if (added) save(projectId, local);
    } catch {
      // Server unavailable — work offline from localStorage.
    }
  }

  function useTemplates(projectId: string): { templates: Template[]; refresh: () => void } {
    const [templates, setTemplates] = useState<Template[]>(() => load(projectId));

    const refresh = useCallback(() => {
      setTemplates(load(projectId));
    }, [projectId]);

    useEffect(() => { refresh(); }, [refresh]);

    // Pull from the server whenever the project changes.
    useEffect(() => {
      if (!projectId) return;
      syncFromServer(projectId).then(refresh);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId]);

    // Same tab: another component created or deleted a template.
    useEffect(() => {
      const handler = (e: Event) => {
        if ((e as CustomEvent).detail === projectId) setTemplates(load(projectId));
      };
      changed.addEventListener("change", handler);
      return () => changed.removeEventListener("change", handler);
    }, [projectId]);

    // Other tabs: StorageEvent fires when another tab writes the list.
    useEffect(() => {
      const key = storageKey(projectId);
      const onStorage = (e: StorageEvent) => {
        if (e.key === key) setTemplates(load(projectId));
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    }, [projectId]);

    return { templates, refresh };
  }

  return { load, save, create, remove, syncFromServer, useTemplates };
}
