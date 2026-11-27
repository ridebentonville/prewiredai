# Changelog

## v0.3.0 (draft)

- Added **CSV-Fallback Mode** for ServiceTitan Starter and Essentials shops, which do not get Customer-Built App Keys: a new companion workflow, `servicetitan-csv-fallback-triage.json` (19 executable nodes, 6 sticky notes, built by `build_csv_fallback_workflow.cjs`). One exported Jobs/Dispatch CSV runs the same Morning Triage Digest and Unassigned Aging Watch logic with no ServiceTitan API credentials, via email attachment (inbound Gmail trigger), watch folder, or webhook / form upload. Imported inactive; schedule, webhook, and email triggers disabled; testMode on; owner-only delivery; placeholder credentials only.
- Added a column mapper to `dispatch_logic.cjs` (`normalizeJobsExport`, `canonicalizeRows`, `datasetFromCsvFiles`). It maps human ServiceTitan report headers (`Job #`, `Scheduled Start`, `Required Skill` / `Tag`, `Zone`, `Technician`, `Created On`, ...) onto the internal job schema, ignoring case, punctuation, and space / underscore / hyphen differences. Required columns are Job #, Status, and Scheduled Start; missing ones give a plain-language Heads-up that lists the headers seen.
- Dates such as `3/10/2026 9:50 AM` are read as shop-local time (DST-aware). Malformed rows are skipped or blanked and counted; repeated job rows are merged; empty and header-only files give a Heads-up, not a crash. A technician list is derived from the Technician column when no technicians file is present. Missing optional reports (capacity, memberships, estimates, calls) stay Heads-up lines, never invented numbers.
- The existing digest and Aging Watch workflows now accept the same human headers in their CSV path (rebuilt; fixture snake_case headers and all existing outputs are unchanged). `splitIds`, `uniqueIds`, and `mapAgingJob` moved into shared sections. The KPI list no longer prints `()` for a technician with no trade.
- Added `fixtures/sample-servicetitan-export.csv` (fictional shop, 16 jobs), `fixtures/sample_export_reference_time.txt`, and a generated `sample_csv_fallback_digest.md`.
- Expanded `mock_servicetitan_test.cjs` (header aliases, dates, malformed / empty / missing-column input, snake_case regression, aging thresholds from the sample, the new workflow's safety and end-to-end runs).
- After review: an unterminated CSV quote is reported as an error so a partial file cannot look complete; a batch with more than one Jobs export uses only the last snapshot so an older Completed row cannot hide a current Unassigned job; an empty watch folder still produces a Heads-up.
- Still NOT tested against a live ServiceTitan, Gmail, or Slack account.

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
