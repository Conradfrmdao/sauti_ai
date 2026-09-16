import assert from "node:assert/strict";

import {
  awaitsCitizenResolution,
  canInstitutionTransition,
  isOpenTicketStatus,
  isTicketStatus,
} from "../lib/sauti1/ticket-lifecycle";

assert.equal(canInstitutionTransition("routed", "acknowledged"), true);
assert.equal(canInstitutionTransition("assigned", "in_progress"), true);
assert.equal(canInstitutionTransition("reopened", "resolution_proposed"), true);
assert.equal(canInstitutionTransition("routed", "resolution_proposed"), false);
assert.equal(canInstitutionTransition("resolution_proposed", "closed"), false);
assert.equal(canInstitutionTransition("closed", "in_progress"), false);
assert.equal(awaitsCitizenResolution("resolution_proposed"), true);
assert.equal(awaitsCitizenResolution("in_progress"), false);
assert.equal(isOpenTicketStatus("reopened"), true);
assert.equal(isOpenTicketStatus("closed"), false);
assert.equal(isOpenTicketStatus("cancelled"), false);
assert.equal(isTicketStatus("needs_review"), true);
assert.equal(isTicketStatus("resolved"), false);

console.log("Ticket lifecycle checks passed.");
