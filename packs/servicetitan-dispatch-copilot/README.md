# ServiceTitan Dispatch & Capacity Copilot (DRAFT v0.3.0)

Four short morning reports, plus a 15-minute Unassigned-Job Aging Watch, for the Operations Manager of an HVAC, plumbing, or electrical shop. They help dispatch catch thin job details, fill open schedule time, see yesterday's numbers, start the morning knowing what happened overnight, and get a mid-day alert when jobs sit in Unassigned or are missing the skill and zone tags Dispatch Pro Auto Mode needs.

**Status: draft. It has not been tested against a live ServiceTitan account (or a live Gmail or Slack account).** Everything in this folder was checked against made-up sample data only. A 10-Day Founding Client Pilot is the planned way to prove it on your own data; nothing is for sale yet.

## What it does

1. **Booking QA & skill-tier routing.** Looks at jobs booked in the last 24 hours and flags the ones with thin details: no equipment age, no equipment type, residential vs commercial not recorded, or an address you have already visited. It also flags repair calls on old equipment (12 years by default) as possible replacement opportunities, and suggests which sales-capable tech is free at that time. It is a flagged list. It never moves a job.
2. **Open-capacity and unsold-estimate filler.** Finds open schedule windows in the next two days and pairs them with customers whose maintenance agreement is overdue (30+ days by default) and customers with an open estimate nobody has touched (7+ days by default). The result is a **callback queue for your dispatchers**. A person decides who to call. It does not text or email anyone.
3. **Morning Dispatch KPI digest.** Technician utilization, response time on emergency and same-day jobs, open capacity, and unworked estimates, for the previous day. If a number cannot be worked out from the data, you get a "Heads-up" line instead of a guess.
4. **After-hours handoff summary.** Overnight emergency calls (5:00 PM to 7:00 AM by default) in one brief for the morning shift, with the calls that still need action listed first.
5. **Unassigned-Job Aging Watch (v0.2, companion workflow).** A 15-minute read-only poll that flags jobs sitting in Unassigned past a configurable threshold (default 20 minutes; use 15–20 to match your shop), blank skill tags, missing zone assignments, and multi-tech / multi-day jobs that Dispatch Pro Auto Mode can silently drop or ping-pong. The alert goes to you only. Nothing is written back to the board.

6. **CSV-Fallback Mode (v0.3, companion workflow).** For ServiceTitan Starter and Essentials shops, which do not get a Customer-Built App Key. Export one Jobs/Dispatch report as CSV, send it in (webhook upload, email attachment, or watch folder), and get the same Morning Triage Digest and Aging Watch alert with no ServiceTitan API credentials. See "CSV-Fallback Mode" below.

The first four arrive together in one message to **you, the owner** (email and/or Slack), at 7:00 AM Central once you turn that workflow on. The Aging Watch is a separate workflow with its own disabled 15-minute Schedule, so you can turn it on independently.

## Who it is for

Operations Managers and owners of HVAC, plumbing, and electrical shops that run dispatch in ServiceTitan and want a daily read on scheduling gaps and follow-up, without building reports by hand. You need your own n8n (Cloud or self-hosted). Someone comfortable with n8n will want to help with setup.

## Safety defaults

- **Imported inactive.** Nothing runs until you switch it on, and every Schedule node is switched off (the 7:00 AM digest and the 15-minute Aging Watch each have their own).
- **Test mode on.** Every message is labeled **[TEST]**. The default source is built-in fictional data, so a first run touches nothing of yours.
- **Read-only / zero board write-back.** The ServiceTitan steps are GET requests only. No creating, changing, assigning, or deleting anything in ServiceTitan. The spreadsheet path only reads files. Your dispatcher stays 100% in control.
- **Draft-only callback queue.** It is an internal list.
- **Never contacts customers.** There is no text-message, Twilio, or customer-email step anywhere in the workflow. The only things it can send are one email to your owner address and one Slack post to your channel.
- **No guessed numbers.** Missing data shows up as a Heads-up.

## Setup in short

1. Import `workflow.n8n.json` (morning digest), `unassigned-aging-watch.json` (15-minute Aging Watch), and, for Starter / Essentials shops with no API key, `servicetitan-csv-fallback-triage.json` (CSV-Fallback Mode) into n8n.
2. Leave **source** on `test` and click Execute workflow on **Manual Test Run** in each file. Compare the digest to `sample_test_digest.md`, the aging alert to `sample_aging_alert.md`, and the CSV-Fallback output to `sample_csv_fallback_digest.md`.
3. Export your own reports from ServiceTitan as CSV (see below), set **source** to `csv`, and run again. Still [TEST].
4. Spot-check the numbers by hand against ServiceTitan.
5. Only after that, consider the live path and go-live (see "Hard stop").

## Config table

All settings live in the **Config** node.

| Field | Default | What it means |
| --- | --- | --- |
| `businessName` | Your Business Name | Shown in the message heading. |
| `timezone` | America/Chicago | Used for "yesterday", "after hours", and times shown. |
| `source` | `test` | `test` = built-in fictional data. `csv` = read your exported files. `servicetitan` = live read-only GETs. Any other value falls back to `test`. |
| `testMode` | on | Labels messages [TEST]. `test` source always forces it on. |
| `delivery` | `email` | `email`, `slack`, `both`, or `none`. Owner only. |
| `ownerEmail` | owner@example.com | Your address. The placeholder is blocked from sending. |
| `ownerSlackChannel` | #dispatch-owner-only | A private channel only you can read. |
| `stApiBase` | https://api.servicetitan.io | Live path only. |
| `stTenantId` | PASTE_TENANT_ID_HERE | Live path only. Paste-here placeholder. |
| `stAppKey` | PASTE_APP_KEY_HERE | Live path only. Paste-here placeholder. |
| `csvFolder` | /home/node/.n8n-files/dispatch-exports | Folder holding your six CSV files (csv source). n8n only reads files inside its allowed folder. |
| `asOfOverride` | blank | Optional ISO time to run an older export as if it were that moment. Blank means now. |
| `digestHour` | 7 | For reference. The Schedule node sets the real time. |
| `bookingLookbackHours` | 24 | How far back "newly booked" looks. |
| `replacementAgeYears` | 12 | Repair calls on equipment this old are flagged as possible replacements. |
| `repeatWindowDays` | 180 | How far back a prior visit counts as a "repeat address". |
| `membershipOverdueDays` | 30 | A maintenance agreement this many days past its due date goes into the callback queue. |
| `estimateStaleDays` | 7 | An open estimate with no activity this long is "unworked". |
| `capacityLookaheadDays` | 2 | How many days ahead to look for open windows. |
| `afterHoursStartHour` | 17 | After-hours window starts at this hour (17 = 5 PM) and ends when the digest runs. |
| `maxItemsPerSection` | 10 | Longest list shown per section. |
| `historyDays` | 90 | How much job and estimate history the live path asks for. |
| `agingThresholdMinutes` | 20 | Aging Watch only. How many minutes a job may sit in Unassigned before it is flagged. Use 15–20 to match your shop. |

The Aging Watch has its own Config node with the shared fields above plus `agingThresholdMinutes`. It does not include the digest-only thresholds (replacement age, membership overdue, and so on).

The thresholds are starting points, not industry standards. Set them to match how your shop works.

## CSV-Fallback Mode (Starter and Essentials, no API key)

ServiceTitan's Starter and Essentials tiers do not get Customer-Built App Keys, so there is no API to call. `servicetitan-csv-fallback-triage.json` runs the **same** Morning Triage Digest and Unassigned Aging Watch logic from one exported Jobs/Dispatch CSV. It never calls ServiceTitan, and it sends only to the owner. It is a draft and has not been tested against a live ServiceTitan, Gmail, or Slack account.

**Try it in about 2 minutes.** Import the file, leave `source` = `test`, click Execute workflow on Manual Test Run. You get a [TEST] digest and a [TEST] aging alert built from `fixtures/sample-servicetitan-export.csv`, a made-up Jobs/Dispatch export from a fictional shop ("Summit Mechanical"). Compare with `sample_csv_fallback_digest.md`.

**Export.** In ServiceTitan, run your Jobs or Dispatch report with the columns below and export it to CSV (comma-separated, header row first). Column names vary by shop, so the importer matches headers loosely.

**Required columns** (the file is rejected with a plain-language Heads-up naming what is missing, and listing the headers it did see):

| Needed | Accepted headers (examples) |
| --- | --- |
| Job id | `Job #`, `Job Number`, `Job No`, `Job ID` |
| Status | `Job Status`, `Status` |
| Scheduled start | `Scheduled Start`, `Appointment Start`, `Start`, or `Start Date` + `Start Time` |

**Optional columns** (more columns means fewer Heads-up lines and better flags):

| Field | Accepted headers (examples) |
| --- | --- |
| Scheduled end | `Scheduled End`, `End`, `Appointment End` |
| Business unit | `Business Unit`, `Business Unit Name`, `BU` |
| Job type | `Job Type`, `Type`, `Type of Job` |
| Skill | `Required Skill`, `Skill`, `Tag`, `Required Tag`, `Job Tag` |
| Zone | `Zone`, `Dispatch Zone`, `Zone Name` |
| Technician | `Technician`, `Tech`, `Assigned Technician`, `Technician Name` (several names in one cell, separated by commas, count as a multi-tech job), or `Technician ID` |
| Customer, phone, type | `Customer`, `Customer Name`; `Customer Phone`, `Phone`; `Customer Type` |
| Created | `Created On`, `Booked On`, `Date Created`, `Booked At` |
| Unassigned since | `Unassigned Since`, `Unassigned On` (blank means the clock starts at Created On) |
| Priority, address, summary | `Priority`; `Address`, `Location`, `Service Location`; `Summary`, `Job Summary` |
| Multi-day | `Multi-Day`, `Multi Day` (a job whose start and end fall on different days is also treated as multi-day) |
| Equipment, arrival | `Equipment Type`, `Equipment Age`, `Arrived At`, `Actual Minutes` |

Matching ignores capitalization, extra spaces, punctuation (`#` and `Number` are the same), and whether words are separated by spaces, underscores, or hyphens. The original snake_case fixture headers (`job_id`, `scheduled_start`, ...) still work. The importer prefers `Job Status` over `Status` and reports conflicting job IDs or statuses. A complete scheduled or appointment timestamp takes priority over a split date and time. Dates like `3/10/2026 9:50 AM` or `2026-03-10 09:50` use your configured timezone. Invalid calendar dates and nonexistent spring-forward times are left blank with a Heads-up. An ambiguous fall-back time uses the earlier occurrence and logs a Heads-up. A valid ISO timestamp with an explicit offset selects its own occurrence.

For a job with multiple technicians, Booking QA checks every assignment. Job-level on-site minutes on those jobs are excluded from per-technician utilization and the affected technicians are excluded from the team utilization figure.

**What a single Jobs export gives you.** The Aging Watch uses the status, aging clock, and dispatch columns present in the export. The Morning Digest runs partially: Booking QA, the report-day job counts, and response time (when Arrived At is present) work. Technician names are taken from the Technician column. Capacity, memberships, estimates, calls, and technician shift hours are not in a jobs export, so each missing piece becomes a "Heads-up" line. Nothing is estimated or invented. If you also export any of those reports (same CSV rules, same header matching), drop them in alongside the jobs file and they are used. File names do not matter; each file is recognized by its columns.

**Messy rows.** A row with no job id is skipped. A footer or subtotal row (no status and no start) is skipped. An unreadable date is left blank. Several rows for the same job number (one per technician or appointment) are merged, with technicians combined. Every one of these is counted in a Heads-up. An empty or header-only file produces a Heads-up. Malformed quoting and rows wider than their header reject the report. Use exactly one Jobs/Dispatch snapshot per batch.

**Three ways to get the CSV in** (each trigger is disabled on import):

1. **Email attachment.** The Gmail trigger reads an incoming message with a CSV attached. Edit its query so only one sender you trust matches (`from:PASTE_ALLOWED_SENDER_HERE` is a placeholder that matches nothing). It only reads. It does not reply or forward.
2. **Watch folder.** Drop the file in `csvFolder` and run Manual Test Run (with `source` = `csv`) or the 7:00 AM schedule. n8n only reads files inside its allowed folder.
3. **Webhook / form upload.** POST the file as multipart field `data` to the webhook URL, from a form, a script, or an automation tool. Keep it behind the header-auth credential.

An upload that arrives by email or webhook is always treated as `csv` and still labeled [TEST] until you turn test mode off. Both messages (the digest and the aging alert) go only to `ownerEmail` / `ownerSlackChannel`.

## Advanced: six-file CSV set and ServiceTitan v2

**Six-file CSV set (still supported).** For the original `source` = `csv` path in `workflow.n8n.json` and `unassigned-aging-watch.json`, save `technicians.csv`, `jobs.csv`, `capacity.csv`, `memberships.csv`, `estimates.csv`, and `calls.csv` in `csvFolder`. Those two workflows now also accept the human ServiceTitan headers above in their jobs file; the fixture column names still work. For the Aging Watch, export a job report as `aging_jobs.csv` (or `jobs.csv` with the extra `skill`, `zone`, `tech_ids`, `unassigned_since`, and `multi_day` columns shown in `fixtures/aging_jobs.csv`). The `fixtures/` folder shows the snake_case column names. This path reads files only.

**ServiceTitan v2 (live, read-only, unverified).** Set `source` to `servicetitan`, attach an n8n OAuth2 (client credentials) credential, and paste your tenant ID and app key into Config. The workflow makes these GET requests, all under `{stApiBase}/{module}/v2/tenant/{tenantId}/`:

| Purpose | Path (relative to the tenant) |
| --- | --- |
| Jobs | `jpm/v2/.../jobs` |
| Appointments | `jpm/v2/.../appointments` |
| Appointment assignments | `dispatch/v2/.../appointment-assignments` |
| Technicians | `settings/v2/.../technicians` |
| Technician shifts | `dispatch/v2/.../technician-shifts` |
| Estimates | `sales/v2/.../estimates` |
| Recurring service events (membership due dates) | `memberships/v2/.../recurring-service-events` |
| Calls | `telecom/v3/.../calls` |

**Unverified.** These paths, query parameter names, and the field mapping come from public documentation and memory. They have not been checked against a real tenant. Specifically:

- Customer names, phone numbers, business-unit names, equipment type and age, and customer type are not read by this draft. They need extra lookups. Booking QA will therefore flag them as missing on the live path.
- ServiceTitan's Dispatch capacity query is a POST request, so this pack does not use it. Open windows are worked out as shift time minus booked appointments instead.
- Only the first page (200 records) of each endpoint is read, and you get a Heads-up when more exists.
- n8n requests the access token for the OAuth2 credential. The workflow itself never POSTs to ServiceTitan.

## Hard stop before go-live

Do not turn test mode off or switch any Schedule, Webhook, or Email trigger on until all of these are true:

1. A clean [TEST] run on the sample data.
2. A clean [TEST] run on **your own** CSV export, with several numbers checked by hand against ServiceTitan.
3. `ownerEmail` and `ownerSlackChannel` confirmed as owner-only.
4. The owner has signed off, in writing.

## What it will not do

- Text, call, or email a customer.
- Create, change, assign, or delete anything in ServiceTitan.
- Reassign a job or book a callback. It only suggests.
- Invent a number, a metric, or a result.
- Promise more booked jobs, more revenue, or time saved. No results have been measured.
- Give legal, tax, or accounting advice.

## Files in this folder

| File | Purpose |
| --- | --- |
| `workflow.n8n.json` | The importable 7:00 AM digest workflow (27 executable nodes, 7 sticky notes). Saved inactive. |
| `unassigned-aging-watch.json` | The importable 15-minute Unassigned-Job Aging Watch (20 executable nodes, 7 sticky notes). Saved inactive. |
| `servicetitan-csv-fallback-triage.json` | The importable CSV-Fallback Mode workflow for Starter / Essentials shops (19 executable nodes, 6 sticky notes). Saved inactive; schedule, webhook, and email triggers disabled. |
| `fixtures/` | Fictional sample data: a made-up shop, "Cedar Ridge Mechanical", with HVAC, plumbing, and electrical techs and customers, plus aging-watch jobs. |
| `fixtures/sample-servicetitan-export.csv` | A fictional Jobs/Dispatch export ("Summit Mechanical") with human ServiceTitan headers, for CSV-Fallback Mode. `fixtures/sample_export_reference_time.txt` fixes its "now". |
| `sample_csv_fallback_digest.md` | The [TEST] digest and [TEST] aging alert the CSV-Fallback workflow produces from the sample export. Regenerated by the test. |
| `sample_test_digest.md` | The [TEST] digest the morning workflow produces from the fixtures. Regenerated by the test. |
| `sample_aging_alert.md` | The [TEST] aging alert the companion workflow produces from the aging fixtures. Regenerated by the test. |
| `mock_servicetitan_test.cjs` | Test harness. Needs Node 18+. No network. |
| `dispatch_logic.cjs` | The logic behind the Code nodes in all three workflows. |
| `build_workflow.cjs` | Rebuilds `workflow.n8n.json` from the logic and fixtures. |
| `build_aging_workflow.cjs` | Rebuilds `unassigned-aging-watch.json` from the logic and aging fixtures. |
| `build_csv_fallback_workflow.cjs` | Rebuilds `servicetitan-csv-fallback-triage.json` from the logic and the sample export. |
| `CHANGELOG.md` | Version history. |

## Checking the pack

```bash
node packs/servicetitan-dispatch-copilot/build_workflow.cjs        # only after editing the digest logic or fixtures
node packs/servicetitan-dispatch-copilot/build_aging_workflow.cjs  # only after editing the aging logic or fixtures
node packs/servicetitan-dispatch-copilot/build_csv_fallback_workflow.cjs  # only after editing the CSV mapper or sample export
node packs/servicetitan-dispatch-copilot/mock_servicetitan_test.cjs
```

The test checks that all three workflows are inactive and read-only, that all three schedules (and the CSV-fallback inbound webhook and Gmail trigger) are disabled, that nothing can message a customer, and that no secrets are present. It then runs the Code nodes pulled from each workflow JSON against the fixtures, asserts the expected flags and numbers (including aging thresholds, blank skill/zone detection, multi-tech/multi-day exclusions, and [TEST] labeling), covers the CSV column mapper (header aliases, dates, malformed and empty files, missing required columns), and rewrites `sample_test_digest.md`, `sample_aging_alert.md`, and `sample_csv_fallback_digest.md`. It exits 0 only if everything passes.

## License and credit

The pack ships with this site's MIT license. The site is based on Ryan Fitzgerald's devportfolio (MIT).
