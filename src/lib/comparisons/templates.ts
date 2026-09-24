// ---------------------------------------------------------------------------
// Comparison templates — a card layout saved from one comparison and
// re-applied to other runs (see apply-template.ts).
// ---------------------------------------------------------------------------

import { api } from "../../api/client";
import { storageKeys } from "../storage";
import { createTemplateStore, type Template } from "../templates/store";

export type ComparisonTemplate = Template;

export const {
  create: createTemplate,
  remove: deleteTemplate,
  useTemplates,
} = createTemplateStore(storageKeys.comparisonTemplates, {
  list: async (projectId) => (await api.comparisonTemplates(projectId)).comparison_templates,
  get: api.comparisonTemplate,
  create: api.createServerComparisonTemplate,
  update: api.updateServerComparisonTemplate,
  remove: api.deleteServerComparisonTemplate,
});
