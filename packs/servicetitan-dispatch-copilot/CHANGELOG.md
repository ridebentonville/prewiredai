# Changelog

## v0.1.0 (draft)

- First draft of the ServiceTitan Dispatch & Capacity Copilot.
- Four workflows: Booking QA & skill-tier routing, open-capacity & unsold-estimate callback queue, Morning Dispatch KPI digest, After-Hours handoff summary.
- 27 executable n8n nodes plus 7 sticky notes. Imported inactive, Schedule disabled, testMode on, source defaults to `test`.
- Read-only ServiceTitan v2 GET requests (paths unverified) and a CSV export fallback.
- Owner-only delivery (Gmail and/or Slack). No customer-facing send path.
- Fictional fixtures for a made-up HVAC / plumbing / electrical shop, a Node test harness, and a generated sample [TEST] digest.
- NOT tested against a live ServiceTitan, Gmail, or Slack account.
