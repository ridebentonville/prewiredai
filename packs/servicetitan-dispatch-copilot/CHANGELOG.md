# Changelog

## v0.2.0 (draft)

- Added a companion Unassigned-Job Aging Watch workflow (`unassigned-aging-watch.json`): a 15-minute read-only poll that flags jobs sitting in Unassigned past a configurable threshold (default 20 minutes), blank skill tags, missing zone assignments, and multi-tech / multi-day jobs that Dispatch Pro Auto Mode can silently drop or ping-pong.
- Owner-only Slack / email alert (with an SMS-length summary in the payload). Zero board write-back. Imported inactive, 15-minute Schedule disabled, testMode on, source defaults to `test`.
- GET-only ServiceTitan v2 path (paths unverified) and a CSV export fallback, including for Starter / Essentials shops.
- Fictional aging fixtures, a generated sample [TEST] alert, and expanded tests for thresholds, tag detection, Auto Mode exclusions, [TEST] labeling, and read-only enforcement.
- The original 7:00 AM digest workflow (`workflow.n8n.json`, 27 executable nodes) is unchanged.

## v0.1.0 (draft)

- First draft of the ServiceTitan Dispatch & Capacity Copilot.
- Four workflows: Booking QA & skill-tier routing, open-capacity & unsold-estimate callback queue, Morning Dispatch KPI digest, After-Hours handoff summary.
- 27 executable n8n nodes plus 7 sticky notes. Imported inactive, Schedule disabled, testMode on, source defaults to `test`.
- Read-only ServiceTitan v2 GET requests (paths unverified) and a CSV export fallback.
- Owner-only delivery (Gmail and/or Slack). No customer-facing send path.
- Fictional fixtures for a made-up HVAC / plumbing / electrical shop, a Node test harness, and a generated sample [TEST] digest.
- NOT tested against a live ServiceTitan, Gmail, or Slack account.
