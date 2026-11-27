# Housecall Pro CSV-First Morning Ops Copilot (DRAFT v0.1.0)

One short weekday-morning digest for the owner or office manager of an HVAC, plumbing, electrical, or other home-service shop that runs on Housecall Pro. It pulls three queues you would otherwise hunt for across separate lists into one message: jobs that are unscheduled, late, or waiting on an office action; finished jobs that still need an invoice (or whose invoice was never sent), plus past-due invoices; and high-value estimates still waiting on an answer after the shop's configured follow-up cutoff.

**Status: draft. It has not been tested against a live Housecall Pro account (or a live Gmail or Slack account).** Everything in this folder was checked against made-up sample data only ("Cedar Creek Plumbing & Air", a fictional plumbing and HVAC shop). Nothing is for sale yet.

## Why it is CSV-first

Housecall Pro's Open API and webhooks are officially available **only on the MAX plan** (roughly $299-$329/month at [standard pricing](https://www.housecallpro.com/pricing/)). A pack built on them would shut out shops on Basic and Essentials. So this pack reads **CSV exports** instead:

- A Basic or Essentials shop can use it with **zero plan upgrade**.
- It never connects to Housecall Pro: no API key, no OAuth, no webhook, and no HTTP Request node at all.
- A Housecall Pro admin can export Jobs and Customers to CSV (the file is emailed to the admin by notifications@housecallpro.com). That manual export is the verified part. Help article: https://help.housecallpro.com/en/articles/6797101-how-to-import-export-jobs-and-customers
- **Not verified:** which plans can run that export, whether Invoices and Estimates lists can be exported as CSV on your plan, and whether Housecall Pro can schedule CSV reports. This pack does not claim scheduled native CSV reports. You can feed it any CSV that has the columns below, from whatever export your account offers.

## What it does

1. **Unscheduled, late, and needs-office-action jobs.** Jobs whose status means unscheduled, jobs whose status means the office must act, and open jobs (scheduled or in progress) whose scheduled end has passed. Late is **computed from the dates**, not read from a status, because a "Late" status is not known to exist. With no end time, a job whose start was on an earlier shop-local day counts as late. Nothing is rescheduled.
2. **Ready to invoice and past-due invoices.** Finished jobs with no invoice, or an invoice that exists but was never sent (oldest first, with a dollar total when the data has one), and invoices past their due date (largest outstanding balance first).
3. **Stalled high-value estimates.** Estimates that were **actually sent** and are still awaiting a response after the cutoff you set, ranked by dollar value. This is a list for a **person to call or write to**. It never sends another reminder.

The schedule runs at 7:00 AM Central on weekdays when enabled. An inbound CSV upload runs when it arrives. Each run produces one digest for the configured owner destinations.

## Who it is for

Owners and office managers who schedule and invoice in Housecall Pro and want one morning read of what is slipping. You need your own n8n (Cloud or self-hosted). Someone comfortable with n8n will want to help with setup. It is a different pack from the ServiceTitan and Jobber packs in this catalog, which cover those platforms.

## Safety defaults

- **Imported inactive.** Nothing runs until you switch it on, and every Schedule, webhook, and Gmail trigger is switched off.
- **Test mode on.** Every message is labeled **[TEST]**. The default source is built-in fictional data, so a first run touches nothing of yours.
- **Zero write-back.** There is no Housecall Pro connection and no HTTP step. The CSV path only reads files.
- **Never contacts customers.** No SMS, Twilio, customer-email, review-request, On-My-Way, or reminder step exists. The only things it can send are one email to your owner address and one Slack post to your channel.
- **Owner-only.** The email address and Slack channel come from the Config node, never from a row in a file you upload. Slack text is escaped (`&`, `<`, `>`), stripped of control characters, and posted with Markdown, @-mention linking, and link unfurls turned off.
- **No guessed numbers.** Missing data shows up as a Heads-up.

## Setup in short

1. Import `workflow.n8n.json` into n8n.
2. Leave **source** on `test` and click Execute workflow on **Manual Test Run**. Compare the digest output to `sample_morning_digest.md`. The destination placeholders block sending.
3. Export your own Jobs (and, if your account allows, Invoices and Estimates) as CSV, drop them in `csvFolder`, set **source** to `csv`, set `estimateStalledDays` if you are testing Estimates, and run again. Still [TEST].
4. Spot-check the numbers by hand against Housecall Pro.
5. Only after that, consider go-live (see "Hard stop").

## Config table

All settings live in the **Config** node.

| Field | Default | What it means |
| --- | --- | --- |
| `businessName` | Your Business Name | Shown in the message heading. |
| `timezone` | America/Chicago | Used for "today" and dates without an offset. Change the n8n workflow timezone separately to move the weekday 7:00 AM schedule. |
| `source` | `test` | `test` = built-in fictional data. `csv` = read your exported files. Any other value falls back to `test` with a Heads-up (there is no live Housecall Pro source). |
| `testMode` | on | Labels messages [TEST]. `test` source always forces it on. |
| `delivery` | `email` | `email`, `slack`, `both`, or `none`. Owner only. |
| `ownerEmail` | owner@example.com | Your address. The placeholder is blocked from sending. |
| `ownerSlackChannel` | blank | The ID of your private Slack channel. Slack delivery is skipped until an ID is set. |
| `csvFolder` | /home/node/.n8n-files/hcp-exports | Folder holding your CSV exports (csv source). File names do not matter. n8n only reads files inside its allowed folder. |
| `asOfOverride` | blank | Optional ISO time to run an older export as if it were that moment. Blank means now. |
| `pastDueMinDays` | 1 | An invoice is listed when today is at least this many days after its due date. Due today is excluded. Values below one day use one day. |
| `estimateStalledDays` | blank (sample uses 14) | Minimum whole shop-local calendar days since sending, inclusive. Set it above the last follow-up your shop sends on its own. Blank skips the estimate queue. |
| `estimateMinValue` | 1000 | An estimate is listed only if it is worth at least this much (inclusive). |
| `maxItemsPerSection` | 10 | Longest list shown per section. |

The thresholds are starting points, not industry standards.

## Which estimates count as stalled

Only estimates whose status is awaiting-response style (Sent, Awaiting response, Pending approval, Viewed, Open) **and** that have a real **sent date** are considered. Drafts and unsent estimates, accepted, declined, expired, and canceled estimates are ignored. An estimate is listed when it is worth at least `estimateMinValue` and was sent at least `estimateStalledDays` days ago. The list is ranked by dollar value (ties: older first). An estimate with no total or no send date is skipped and counted in a Heads-up; a created date cannot show how long the customer has had it.

## CSV intake

Any one report is enough. Each file is recognized by its columns, not its name. A report you do not send becomes a Heads-up line, never a guess.

**Required columns** (a file missing one is rejected with a plain-language Heads-up that names what is missing and lists the headers it saw):

| Report | Needed | Accepted headers (examples) |
| --- | --- | --- |
| Jobs | Job # | `Job #`, `Job Number`, `Job No`, `Job ID` |
| Jobs | Status | `Job status`, `Status` |
| Invoices | Invoice # | `Invoice #`, `Invoice Number`, `Invoice No` |
| Invoices | Status | `Invoice status`, `Status` |
| Invoices | Due date | `Due date`, `Due`, `Due On` |
| Invoices | Balance | `Amount due`, `Balance`, `Balance Due`, `Outstanding` |
| Estimates | Estimate # | `Estimate #`, `Estimate Number`, `Estimate No` |
| Estimates | Status | `Estimate status`, `Status` |
| Estimates | Total | `Total`, `Estimate Total`, `Amount` |
| Estimates | Sent date | `Sent date`, `Date Sent`, `Sent` |

**Optional columns:** Jobs: `Customer name`, `Job description`, `Service address`, `Scheduled start`, `Scheduled end`, `Created date`, `Completed date`, `Job total`, `Assigned employees`, `Invoice #`, `Invoice status`. Invoices: `Customer name`, `Total`, `Invoice date`, `Job #`. Estimates: `Customer name`, `Description`, `Created date`.

Matching ignores capitalization, extra spaces, punctuation (`#` and `Number` are the same), and whether words are separated by spaces, underscores, or hyphens.

**How "needs an invoice" is decided.** For each finished job, the pack checks its Invoice status and any Invoices rows linked by Job # or Invoice #. A recognized sent or paid status takes precedence over a draft or missing-invoice signal. A recognized Draft or Not sent status indicates an unsent invoice. An explicit Not invoiced status can indicate no invoice. Blank or unknown invoice status, a number alone, and absence from an invoice list do not establish that an invoice is missing. Jobs that cannot be checked get a Heads-up. Unsent invoices with no matching job also get a Heads-up.

### Unverified headers and statuses

The literal header text and status values of real Housecall Pro exports were **not checked against a live account**. Treat everything below as unverified:

- All header aliases above, including the Invoices and Estimates ones. Only the existence of a manual Jobs and Customers export is verified.
- Job statuses: Unscheduled / Needs scheduling; Scheduled; In progress; Complete (also Complete rated / unrated); Canceled (also User / Pro canceled); and office-action statuses (Needs attention, Action required, Needs office action, On hold, Waiting on office, Needs follow-up). The office-action list is a best guess; whether Housecall Pro has such a status is unconfirmed.
- Invoice statuses: Paid, Draft / Unsent, Void, Past due / Overdue, and Sent / Open / Unpaid / Partially paid.
- Estimate statuses: Sent / Awaiting response / Pending approval / Viewed; Draft; Approved / Accepted; Declined; Expired.
- Whether Jobs exports carry invoice columns.

A status not in these lists is counted in a Heads-up and never guessed into a queue. If a real export uses something else, the Heads-up lists the headers it saw so you can tell me or rename the column. The aliases live in `hcp_logic.cjs`.

**Dates and time zones.** Dates like `3/10/2026 9:50 AM`, `2026-03-10 09:50`, `Mar 10, 2026`, or a bare date are read as **shop-local** time in your `timezone`. ISO dates with an offset or `Z` are kept as they are. Impossible dates such as `2026-02-30` or `2/29/2026` are rejected, left blank, and counted in a Heads-up; they are never rolled over. Daylight saving policy:

- A time that does not exist (spring-forward gap, for example 2:30 AM on 2026-03-08 in Chicago) is moved **forward** by the gap (to 3:30 AM CDT) and counted in a Heads-up.
- A time that happens twice (fall-back, for example 1:30 AM on 2026-11-01) is read as the **first** occurrence (daylight time) and counted in a Heads-up.
- Due dates and "today" are whole shop-local days, so an invoice due today is not past due at 11:30 PM that day.

**Messy files.** A row with no id, or a "Total" footer row, is skipped and counted. An unreadable date or dollar amount is left blank and counted. Repeated Job # rows (one per visit) are merged. An empty file and a header-only file each give a Heads-up, not a crash. Malformed or **unterminated quotes**, duplicate headers, and rows with a different column count than the header reject the entire file, so a partial file can never look complete. Send a single current snapshot per report type: several of one type are all skipped with a Heads-up. Conflicting invoice or estimate numbers are omitted. Text from cells is flattened to one line so a cell cannot forge a digest line.

**Three ways to get the CSV in** (each trigger is disabled on import):

1. **Email attachment.** The Gmail trigger reads an incoming message with a CSV attached. Edit its query so only one sender you trust matches (`from:PASTE_ALLOWED_SENDER_HERE` is a placeholder that matches nothing). It only reads. It does not reply or forward.
2. **Watch folder.** Drop the files in `csvFolder` and run Manual Test Run (with `source` = `csv`) or the 7:00 AM schedule.
3. **Webhook / form upload.** POST the file(s) as multipart field `data` to the webhook URL. Keep it behind the header-auth credential.

An upload that arrives by email or webhook is always treated as `csv` and still labeled [TEST] until you turn test mode off.

## Optional MAX API / webhook extension

**Not implemented in v0.1.0.** Housecall Pro's Open API and webhooks are MAX-only (official docs: https://docs.housecallpro.com/ , https://help.housecallpro.com/en/articles/8505035-api-overview , https://help.housecallpro.com/en/articles/5683520-how-to-enable-webhooks). A later, read-only add-on for shops that are already on MAX could feed the same digest without a manual export. Endpoint paths, field names, status values, and plan behavior are **unverified** until a live test, and nothing in this folder calls them. It would stay read-only: no write-back, no customer messages.

## Hard stop before go-live

Do not turn test mode off or switch any Schedule, Webhook, or Email trigger on until all of these are true:

1. A clean [TEST] run on the sample data.
2. A clean [TEST] run on **your own** CSV exports, with several numbers checked by hand against Housecall Pro.
3. The configured email and private Slack channel are confirmed owner-only, and the estimate cutoff is set after the last follow-up your shop sends on its own.
4. The owner has signed off, in writing.

## What it will not do

These are deliberate Deletes, not gaps:

- Text, call, or email a customer.
- Send automated estimate or invoice reminders, or review requests or On-My-Way texts.
- Write anything back to Housecall Pro (jobs, schedules, invoices, estimates).
- Act as a receptionist or chat bot, sync QuickBooks, or replace Zapier.
- Invent a number, a metric, or a result.
- Promise more booked jobs, more revenue, or time saved. No results have been measured.
- Give legal, tax, or accounting advice.

## Draft internal price (not approved for the site)

Recommended draft: a fixed install at $799, with an optional $149/month retainer for light monitoring and threshold tuning. **This is an internal draft only and is not approved for the website.** The public site shows "Pricing coming soon" until the owner sets list prices.

## Files in this folder

| File | Purpose |
| --- | --- |
| `workflow.n8n.json` | The importable CSV-first workflow (18 executable nodes, 6 sticky notes). No HTTP Request node. Saved inactive; schedule, webhook, and email triggers disabled. |
| `hcp_logic.cjs` | The logic behind the Code nodes (CSV mapper, dates, the three queues, the digest). |
| `build_lib.cjs`, `build_workflow.cjs` | Rebuild the workflow file from the logic and the fixtures. |
| `fixtures/sample-hcp-export-jobs.csv`, `-invoices.csv`, `-estimates.csv` | A fictional plumbing and HVAC shop ("Cedar Creek Plumbing & Air") with Housecall Pro-style headers. 42 data rows across the three exports. |
| `fixtures/reference_time.txt` | The fixed shop-local "now" for the samples (Tue 2026-06-09, 7:00 AM Central). |
| `sample_morning_digest.md` | The [TEST] digest the workflow produces from the samples. Regenerated by the test. |
| `mock_hcp_test.cjs` | Test harness. Needs Node 18+. No network. |
| `CHANGELOG.md` | Version history. |

## Checking the pack

```bash
node packs/housecall-pro-morning-ops-copilot/build_workflow.cjs   # only after editing the logic or fixtures
node packs/housecall-pro-morning-ops-copilot/mock_hcp_test.cjs
```

The test checks that the workflow is inactive and read-only, that every schedule, webhook, and email trigger is disabled, that there is no HTTP node and nothing can message a customer, that recipients come only from Config, and that no secrets are present. It covers the CSV mapper (header aliases, malformed, empty, header-only, missing-column, and competing files), dates, time zones, invalid calendar dates and the daylight-saving policy, past-due and stalled-estimate boundaries, digest wording and [TEST] labeling, the site copy, and runs the Code nodes pulled out of the workflow JSON end to end. It rewrites `sample_morning_digest.md` and exits 0 only if everything passes.

## License and credit

The pack ships with this site's MIT license. The site is based on Ryan Fitzgerald's devportfolio (MIT).
