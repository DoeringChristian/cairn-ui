/**
 * Every card type has a settings panel: the gear of any card — including an
 * empty one (components/card-kit/EmptyCard.tsx) or a single value — opens
 * its type's settings through TypeSettingsPanel. Run: `npm run test:unit`.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { CARD_TYPES } from "./card-spec.ts";
import { SETTINGS_PANELS } from "./settings-panels.ts";

test("every card type has a settings panel", () => {
  const missing = CARD_TYPES.filter((t) => typeof SETTINGS_PANELS[t] !== "function");
  assert.deepEqual(missing, []);
});
