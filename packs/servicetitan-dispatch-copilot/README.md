# ServiceTitan Dispatch & Capacity Copilot (DRAFT v0.1.0)

Four short reports for the Operations Manager of an HVAC, plumbing, or electrical shop. They help dispatch catch thin job details, fill open schedule time, see yesterday's numbers, and start the morning knowing what happened overnight.

**Status: draft. It has not been tested against a live ServiceTitan account (or a live Gmail or Slack account).** Everything in this folder was checked against made-up sample data only. A 10-Day Founding Client Pilot is the planned way to prove it on your own data; nothing is for sale yet.

## What it does

1. **Booking QA & skill-tier routing.** Looks at jobs booked in the last 24 hours and flags the ones with thin details: no equipment age, no equipment type, residential vs commercial not recorded, or an address you have already visited. It also flags repair calls on old equipment (12 years by default) as possible replacement opportunities, and suggests which sales-capable tech is free at that time. It is a flagged list. It never moves a job.
2. **Open-capacity and unsold-estimate filler.** Finds open schedule windows in the next two days and pairs them with customers whose maintenance agreement is overdue (30+ days by default) and customers with an open estimate nobody has touched (7+ days by default). The result is a **callback queue for your dispatchers**. A person decides who to call. It does not text or email anyone.
3. **Morning Dispatch KPI digest.** Technician utilization, response time on emergency and same-day jobs, open capacity, and unworked estimates, for the previous day. If a number cannot be worked out from the data, you get a "Heads-up" line instead of a guess.
4. **After-hours handoff summary.** Overnight emergency calls (5:00 PM to 7:00 AM by default) in one brief for the morning shift, with the calls that still need action listed first.

All four arrive together in one message to **you, the owner** (email and/or Slack), at 7:00 AM Central once you turn it on.

## Who it is for

Operations Managers and owners of HVAC, plumbing, and electrical shops that run dispatch in ServiceTitan and want a daily read on scheduling gaps and follow-up, without building reports by hand. You need your own n8n (Cloud or self-hosted). Someone comfortable with n8n will want to help with setup.

## Safety defaults

- **Imported inactive.** Nothing runs until you switch it on, and the Schedule node is switched off.
- **Test mode on.** Every message is labeled **[TEST]**. The default source is built-in fictional data, so a first run touches nothing of yours.
- **Read-only.** The ServiceTitan steps are GET requests only. No creating, changing, or deleting anything in ServiceTitan. The spreadsheet path only reads files.
- **Draft-only callback queue.** It is an internal list.
- **Never contacts customers.** There is no text-message, Twilio, or customer-email step anywhere in the workflow. The only things it can send are one email to your owner address and one Slack post to your channel.
- **No guessed numbers.** Missing data shows up as a Heads-up.

## Setup in short

1. Import `workflow.n8n.json` into n8n.
2. Leave **source** on `test` and click Execute workflow on **Manual Test Run**. Compare the result to `sample_test_digest.md`.
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

The thresholds are starting points, not industry standards. Set them to match how your shop works.

## CSV export fallback vs ServiceTitan v2

**CSV export (recommended first).** Export reports from ServiceTitan yourself and save them as six files in `csvFolder`: `technicians.csv`, `jobs.csv`, `capacity.csv`, `memberships.csv`, `estimates.csv`, `calls.csv`. The `fixtures/` folder shows the exact column names. This path reads files only. You may need to rename columns in your export to match.

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

Do not turn test mode off or switch the Schedule on until all of these are true:

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
| `workflow.n8n.json` | The importable n8n workflow (27 executable nodes, 7 sticky notes). Saved inactive. |
| `fixtures/` | Fictional sample data: a made-up shop, "Cedar Ridge Mechanical", with HVAC, plumbing, and electrical techs and customers. |
| `sample_test_digest.md` | The [TEST] digest the workflow produces from the fixtures. Regenerated by the test. |
| `mock_servicetitan_test.cjs` | Test harness. Needs Node 18+. No network. |
| `dispatch_logic.cjs` | The logic behind the Code nodes. |
| `build_workflow.cjs` | Rebuilds `workflow.n8n.json` from the logic and fixtures. |
| `CHANGELOG.md` | Version history. |

## Checking the pack

```bash
node packs/servicetitan-dispatch-copilot/build_workflow.cjs        # only after editing the logic or fixtures
node packs/servicetitan-dispatch-copilot/mock_servicetitan_test.cjs
```

The test checks that the workflow is inactive and read-only, that the schedule is disabled, that nothing can message a customer, and that no secrets are present. It then runs the Code nodes pulled from the workflow JSON against the fixtures, asserts the expected flags and numbers, and rewrites `sample_test_digest.md`. It exits 0 only if everything passes.

## License and credit

The pack ships with this site's MIT license. The site is based on Ryan Fitzgerald's devportfolio (MIT).
