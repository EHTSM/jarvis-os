"use strict";
/**
 * agents/crm.cjs — re-export of the real, single-source-of-truth CRM store.
 *
 * agents/business/crmAgent.cjs, marketingAgent.cjs, and growthAgent.cjs all
 * depend on "../crm.cjs" for getLeads/saveLead/updateLead, but this file
 * never existed anywhere in the repo — making all three unable to even
 * require() successfully. backend/services/crmService.js is the real CRM
 * backing store (data/leads.json), already used by backend/routes/crm.js
 * and the registered "crm" runtime capability
 * (agents/runtime/bootstrapRuntime.cjs) — this file does not duplicate
 * that storage or logic, only re-exports it under the path these three
 * agents already expect.
 */

module.exports = require("../backend/services/crmService.js");
