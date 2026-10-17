// An invisible starter preserves an editable Markdown cell without publishing
// instructions as report content.
export const EMPTY_REPORT_CELL = "<!-- cairn:empty-report -->";
export const NEW_REPORT_SOURCE = `---\ntitle: NewReport\n---\n\n${EMPTY_REPORT_CELL}\n`;

export function createDraftRequest<T>(
  create: (project: string, slug: string, files: Record<string, string>) => Promise<T>,
  uniqueId: () => string = () => crypto.randomUUID(),
) {
  const requests = new Map<string, Promise<T>>();
  return (project: string): Promise<T> => {
    const existing = requests.get(project);
    if (existing) return existing;
    const task = Promise.resolve().then(() =>
      create(project, `new-report-${uniqueId().replace(/-/g, "").slice(0, 20)}`, {"report.qmd": NEW_REPORT_SOURCE}),
    ).catch(error => {
      requests.delete(project);
      throw error;
    });
    requests.set(project, task);
    return task;
  };
}
