// ---------------------------------------------------------------------------
// Report templates — the same template cards as comparison templates (a
// card's type plus the metric keys it displays), stored under their own
// localStorage key and server table.
// ---------------------------------------------------------------------------

import { api } from "../../api/client";
import { storageKeys } from "../storage";
import { createTemplateStore, type Template, type TemplateCard } from "../templates/store";

export type ReportTemplate = Template;
export type ReportTemplateCard = TemplateCard;

export const {
  create: createReportTemplate,
  remove: deleteReportTemplate,
  useTemplates: useReportTemplates,
} = createTemplateStore(storageKeys.reportTemplates, {
  list: async (projectId) => (await api.reportTemplates(projectId)).report_templates,
  get: api.reportTemplate,
  create: api.createServerReportTemplate,
  update: api.updateServerReportTemplate,
  remove: api.deleteServerReportTemplate,
});
