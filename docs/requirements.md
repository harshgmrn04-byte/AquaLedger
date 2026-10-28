# First-release requirements (v4)

Managers create, preview, and publish auditable billing revisions; residents read only their own statements. Express verifies identity and loads society/flat authorization from private PostgreSQL tables. Published revisions stay immutable.

HSB 1.1.0 supplies historical, positive fixture **events**, with no validated zero-use or outage mask. These rows may support labeled historical analytics, not coverage-certified apartment billing. Stage 3 uses a separate **illustrative test fixture** for the billing walkthrough. There is no source invoice or physical main meter. Never combine invented fixture consumption with observed source rows.

Billing uses integer millilitres and integer minor currency units. The sum of statement charges must equal the invoice exactly; missing coverage, ambiguous meter mapping, inconsistent invoice components, stale preview, and cross-apartment access must block publication or access. JSON uses decimal strings for large integer quantities. Local Stage 1 acceptance is a verified source audit, repeatable sample import, private schema/role denial checks, frozen install, and green `npm run verify`. Later stage gates remain in v4.

Decision log: [HSB event/fallback decision](decisions/001-hsb-events-and-billing-fallback.md). Source field evidence: [HSB audit](data/HSB_AUDIT.md).
