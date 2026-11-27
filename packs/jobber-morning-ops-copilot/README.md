# Jobber Morning Ops Triage Copilot (DRAFT v0.1.0)

One short weekday-morning digest for the owner or office manager of a lawn, landscaping, cleaning, pest, handyman, pressure washing, HVAC, plumbing, or electrical shop that runs on Jobber. It pulls three queues you would otherwise hunt for across separate reports into one message: jobs that are unscheduled, late, or need action; finished jobs that still need an invoice, plus past-due invoices; and high-value quotes still waiting on an answer after the shop's configured follow-up cutoff.

**Status: draft. It has not been tested against a live Jobber account (or a live Gmail or Slack account).** Everything in this folder was checked against made-up sample data only. Nothing is for sale yet.

**This is a different pack from Jobber Connector.** Jobber Connector (a separate pack in this catalog) drafts customer follow-ups for you to approve. This pack drafts nothing for customers. It is a read-only morning digest for you.

## What it does

1. **Unscheduled, Late, and Action Required jobs.** One list of the jobs Jobber marks with those statuses, plus jobs that have a visit with no date (in Jobber's GraphQL an unscheduled visit has `startAt` and `endAt` both null) and Active or Upcoming jobs with no scheduled visit. Late jobs show how long ago the visit was due to end. Nothing is rescheduled.
2. **Requires Invoicing and past-due invoices.** Finished jobs still waiting for an invoice (oldest first, with a dollar total when the data has one) and invoices past their due date (largest outstanding balance first).
3. **Stalled high-value quotes.** Quotes still *awaiting a response* after the cutoff you set beyond the last enabled Jobber follow-up, ranked by dollar value. This is a list for a **person to call or write to**. It never sends another reminder.
4. **CSV-Fallback for every Jobber plan.** Export your Jobs, Invoices, and Quotes reports from Jobber, send them in (webhook upload, email attachment, or watch folder), and get the same digest. No OAuth, no App Review. This is the recommended way to start.

The schedule runs at 7:00 AM Central on weekdays when enabled. An inbound CSV upload runs when it arrives. Each run produces a digest for the configured owner destinations.

## Who it is for

Owners and office managers who schedule and invoice in Jobber and want one morning read of what is slipping, without building reports by hand. You need your own n8n (Cloud or self-hosted). Someone comfortable with n8n will want to help with setup.

## Safety defaults

- **Imported inactive.** Nothing runs until you switch it on, and every Schedule, webhook, and Gmail trigger is switched off.
- **Test mode on.** Every message is labeled **[TEST]**. The default source is built-in fictional data, so a first run touches nothing of yours.
- **Zero write-back.** The live path sends GraphQL **queries** only. GraphQL travels over HTTP POST, so the HTTP nodes show method POST, but there is no `mutation` anywhere: nothing is created, changed, scheduled, or deleted in Jobber. The CSV path only reads files.
- **Never contacts customers.** No SMS, Twilio, customer-email, review-request, On-My-Way, or reminder step exists in either workflow. The only things it can send are one email to your owner address and one Slack post to your channel.
- **Owner-only.** The email address and Slack channel come from the Config node, never from a row in a file you upload.
- **No guessed numbers.** Missing data shows up as a Heads-up.

## Setup in short

1. Import `jobber-csv-fallback-triage.json` (recommended first) and, if you later want the live path, `workflow.n8n.json` into n8n.
2. Leave **source** on `test` and click Execute workflow on **Manual Test Run**. Compare the digest output to `sample_morning_digest.md`. The destination placeholders block sending.
3. Export your own Jobs, Invoices, and Quotes reports from Jobber as CSV (see below), drop them in `csvFolder`, set **source** to `csv`, set the quote cutoff if you are testing Quotes, and run again. Still [TEST].
4. Spot-check the numbers by hand against Jobber.
5. Only after that, consider the live path and go-live (see "Hard stop").

## Config table

All settings live in the **Config** node.

| Field | Default | What it means |
| --- | --- | --- |
| `businessName` | Your Business Name | Shown in the message heading. |
| `timezone` | America/Chicago | Used for "today" and dates without an offset. Change the n8n workflow timezone separately to move the weekday 7:00 AM schedule. |
| `source` | `test` | `test` = built-in fictional data. `csv` = read your exported files. `jobber` = live read-only GraphQL queries (live workflow only). Any other value falls back to `test`. |
| `testMode` | on | Labels messages [TEST]. `test` source always forces it on. |
| `delivery` | `email` | `email`, `slack`, `both`, or `none`. Owner only. |
| `ownerEmail` | owner@example.com | Your address. The placeholder is blocked from sending. |
| `ownerSlackChannel` | blank | The ID of your private Slack channel. Slack delivery is skipped until an ID is set. |
| `jobberGraphqlVersion` | PASTE_API_VERSION_HERE | Live workflow only. Value for the `X-JOBBER-GRAPHQL-VERSION` header. Paste-here placeholder. |
| `csvFolder` | /home/node/.n8n-files/jobber-exports | Folder holding your CSV exports (csv source). File names do not matter. n8n only reads files inside its allowed folder. |
| `asOfOverride` | blank | Optional ISO time to run an older export as if it were that moment. Blank means now. |
| `pastDueMinDays` | 1 | An invoice is listed when today is at least this many days after its due date. Due today is excluded. Values below one day use a one-day minimum. |
| `quoteStalledDays` | blank (sample uses 14) | Minimum whole shop-local calendar days since sending, inclusive. Set it higher than the last enabled Jobber follow-up delay. Leave blank to skip the real quote queue. |
| `quoteMinValue` | 1000 | A quote is listed only if it is worth at least this much (inclusive). |
| `maxItemsPerSection` | 10 | Longest list shown per section. |

The thresholds are starting points, not industry standards. Set them to match how your shop works.

## Which quotes count as stalled

Only quotes whose status is **Awaiting response** are considered. Drafts, Approved, Declined, Converted, Archived, and **Changes Requested** (the customer already replied) are ignored. A quote is listed when it is worth at least `quoteMinValue` **and** was sent at least `quoteStalledDays` days ago. The list is ranked by dollar value (ties: older first). A quote with no total or no send date is skipped and counted in a Heads-up. A draft or creation date cannot establish how long the customer has had the quote. For a shop without native follow-ups, enter the minimum number of days you want to wait before manual outreach.

## CSV-Fallback (every Jobber plan, no OAuth)

Jobber's Insights reports are on all plans (some columns need a higher plan) and many can be emailed as CSV. Jobber's Report Scheduler app can email a report on a schedule. `jobber-csv-fallback-triage.json` runs the same digest from those files. It never calls Jobber, and it sends only to the owner.

**Try it in about 2 minutes.** Import the file, leave `source` = `test`, click Execute workflow on Manual Test Run. You get a [TEST] digest built from `fixtures/sample-jobber-export-*.csv`, made-up exports from a fictional shop ("Bluestem Home Services").

**Any one report is enough.** Each file is recognized by its columns, not its name. A report you do not send becomes a Heads-up line, never a guess.

**Required columns** (a file missing one is rejected with a plain-language Heads-up that names what is missing and lists the headers it did see):

| Report | Needed | Accepted headers (examples) |
| --- | --- | --- |
| Jobs | Job # | `Job #`, `Job Number`, `Job No`, `Job ID` |
| Jobs | Status | `Status`, `Job Status` |
| Invoices | Invoice # | `Invoice #`, `Invoice Number`, `Invoice No` |
| Invoices | Due date | `Due date`, `Due`, `Due On` |
| Invoices | Status | `Status`, `Invoice Status` |
| Invoices | Balance | `Balance ($)`, `Balance`, `Balance Due`, `Outstanding`, `Amount Due` |
| Quotes | Quote # | `Quote #`, `Quote Number`, `Quote No` |
| Quotes | Status | `Status`, `Quote Status` |
| Quotes | Total | `Total ($)`, `Total`, `Quote Total`, `Amount` |
| Quotes | Send date | `Sent date`, `Sent`, `Date Sent` |

**Optional columns:** Jobs: `Client name`, `Title`, `Property`, `Schedule start date`, `Schedule end date`, `Created date`, `Closed date`, `Total ($)`, `Assigned to`. Invoices: `Client name`, `Total ($)`, `Issued date`, `Job #`. Quotes: `Client name`, `Title`.

Matching ignores capitalization, extra spaces, punctuation (`#` and `Number` are the same), and whether words are separated by spaces, underscores, or hyphens.

**Header names are partly verified.** The column names above (`Job #`, `Client name`, `Schedule start date`, `Closed date`, `Total ($)`, `Invoice #`, `Issued date`, `Due date`, `Balance ($)`, `Sent date`, `Drafted date`, and so on) are the names listed on Jobber's help-center pages for the One-off jobs, Invoices, and Quotes reports. The **literal header text of a real CSV export was not checked** against a live account, and a few aliases (for example `Assigned to`, `Property`, `Outstanding`) are common-variant guesses. If your export uses something else, the Heads-up lists the headers it saw so you can tell me, or rename the column.

**Dates and time zones.** Dates like `3/10/2026 9:50 AM`, `2026-03-10 09:50`, `Mar 10, 2026`, or a bare date are read as **shop-local** time in your `timezone`. ISO dates with an offset or `Z` are kept as they are. Impossible dates such as `2026-02-30` or `2/29/2026` are rejected and counted in a Heads-up; they are never rolled over to the next month. Daylight saving policy:

- A time that does not exist (spring-forward gap, for example 2:30 AM on 2026-03-08 in Chicago) is moved **forward** by the gap (to 3:30 AM CDT) and counted in a Heads-up.
- A time that happens twice (fall-back, for example 1:30 AM on 2026-11-01) is read as the **first** occurrence (daylight time) and counted in a Heads-up.
- Due dates and "today" are whole shop-local days, so an invoice due today is not past due at 11:30 PM that day.

**Messy files.** A row with no id, or a "Total" footer row, is skipped and counted. An unreadable date or dollar amount is left blank and counted. Repeated Job # rows (one per visit) are merged. An empty file and a header-only file each give a Heads-up, not a crash. Malformed quoting, duplicate headers, and rows wider than the header reject the entire file. Record-specific status columns take priority, and competing values produce a Heads-up. Send a single current snapshot per report type. Multiple snapshots of one type are skipped with a Heads-up. Conflicting invoice or quote numbers within a report are omitted.

**Three ways to get the CSV in** (each trigger is disabled on import):

1. **Email attachment.** The Gmail trigger reads an incoming message with a CSV attached. Edit its query so only one sender you trust matches (`from:PASTE_ALLOWED_SENDER_HERE` is a placeholder that matches nothing). It only reads. It does not reply or forward.
2. **Watch folder.** Drop the files in `csvFolder` and run Manual Test Run (with `source` = `csv`) or the 7:00 AM schedule.
3. **Webhook / form upload.** POST the file(s) as multipart field `data` to the webhook URL. Keep it behind the header-auth credential.

An upload that arrives by email or webhook is always treated as `csv` and still labeled [TEST] until you turn test mode off.

## Live path: Jobber GraphQL + OAuth 2.0 (read-only, UNVERIFIED)

`workflow.n8n.json` can read live with `source` = `jobber`. It makes three GraphQL **queries** (jobs with visits, invoices, quotes), first page only (up to 50 per connection), to `https://api.getjobber.com/api/graphql` with an n8n OAuth2 (authorization code) credential and the `X-JOBBER-GRAPHQL-VERSION` header. n8n handles the OAuth token; the workflow never writes to Jobber. Jobber's docs describe the endpoint, OAuth 2.0 (authorization code), the required headers, and that an unscheduled visit has both `startAt` and `endAt` null. A Draft app can connect to up to 5 paying Jobber accounts until Jobber approves it, so a one-shop pilot can stay in Draft, and a product for many shops needs App Review. Whether a Core-tier account can authorize a Draft app is not confirmed in Jobber's docs.

**Schema status.** The original implementation received HTTP 403 from the Developer Center. The review could read the [public Developer Center overview](https://developer.getjobber.com/docs/) and cross-check core object fields, including `Quote.sentAt`, which represents when the quote was last sent. The complete queries remain **unverified against a live account and a selected API version**.

| Area | Reviewed against public docs | Still to validate |
| --- | --- | --- |
| Connection | GraphQL POST endpoint, authorization code, required version header, Draft account limit | Selected API version, required scopes, refresh behavior, and Core-tier Draft consent |
| Jobs | Job number, status field, title, dates, total, client name, visit fields, null visit dates | Root and nested connection arguments and response shape, job enum values |
| Invoices | Invoice number, status field, issued and due date fields, amounts object, client name | Invoice enum values, `amounts.total` and `amounts.invoiceBalance`, due-date offset behavior |
| Quotes | Quote number, status field, `sentAt`, title, amounts object, client name | Quote enum values, `amounts.total`, root connection and paging |

If Jobber rejects a query because a field name differs, the workflow records a Heads-up ("Jobber returned an error for ...") and skips that part instead of crashing. n8n parameters in both workflow files (node types and versions, the OAuth2 generic-credential setup, the Gmail trigger options, the Read/Write Files glob) were written from memory of the n8n editor and have been checked as JSON and with simulated Code nodes. Some parameters were cross-checked against upstream n8n source. Import and execution in a running n8n instance are still unverified.

## Hard stop before go-live

Do not turn test mode off or switch any Schedule, Webhook, or Email trigger on until all of these are true:

1. A clean [TEST] run on the sample data.
2. A clean [TEST] run on **your own** CSV exports, with several numbers checked by hand against Jobber.
3. Confirm the configured email and private Slack channel are owner-only. For the quote queue, set the cutoff after the last native follow-up configured in Jobber.
4. The owner has signed off, in writing.

## What it will not do

These are deliberate Deletes, not gaps. Jobber (and its marketplace) already cover them, or they are not read-only:

- Text, call, or email a customer.
- Send automated quote or invoice reminders (Jobber's own follow-ups already do this).
- Send review requests or On-My-Way texts.
- Lock, reorder, or write back routes or schedules, or move a visit. It never writes to Jobber.
- Act as a receptionist or chat bot, sync QuickBooks Online, or replace Zapier.
- Invent a number, a metric, or a result.
- Promise more booked jobs, more revenue, or time saved. No results have been measured.
- Give legal, tax, or accounting advice.

## Draft internal price (not approved for the site)

Recommended draft: a fixed install at $799, with an optional $149/month retainer for light monitoring and threshold tuning. **This is an internal draft only and is not approved for the website.** The public site shows "Pricing coming soon" until the owner sets list prices.

## Files in this folder

| File | Purpose |
| --- | --- |
| `workflow.n8n.json` | The importable 7:00 AM Jobber digest (21 executable nodes, 7 sticky notes). Live read-only GraphQL path, CSV path, and built-in sample. Saved inactive. |
| `jobber-csv-fallback-triage.json` | The importable CSV-Fallback workflow for any Jobber plan (18 executable nodes, 6 sticky notes). No HTTP Request node. Saved inactive; schedule, webhook, and email triggers disabled. |
| `jobber_logic.cjs` | The logic behind the Code nodes in both workflows (CSV mapper, dates, GraphQL normalizer, the three queues, the digest). |
| `build_lib.cjs`, `build_workflow.cjs`, `build_csv_fallback_workflow.cjs` | Rebuild the two workflow files from the logic and the fixtures. |
| `fixtures/sample-jobber-export-jobs.csv`, `-invoices.csv`, `-quotes.csv` | A fictional lawn, HVAC, and plumbing shop ("Bluestem Home Services") with Jobber-style headers. 32 rows across the three reports. |
| `fixtures/sample-jobber-graphql.json` | A mock of three GraphQL responses covering the same cases (fictional; field names unverified). |
| `fixtures/reference_time.txt` | The fixed shop-local "now" for the samples (Tue 2026-03-10, 7:00 AM Central). |
| `sample_morning_digest.md` | The [TEST] digest the CSV-Fallback workflow produces from the samples. Regenerated by the test. |
| `mock_jobber_test.cjs` | Test harness. Needs Node 18+. No network. |
| `CHANGELOG.md` | Version history. |

## Checking the pack

```bash
node packs/jobber-morning-ops-copilot/build_workflow.cjs               # only after editing the logic or fixtures
node packs/jobber-morning-ops-copilot/build_csv_fallback_workflow.cjs  # only after editing the logic or fixtures
node packs/jobber-morning-ops-copilot/mock_jobber_test.cjs
```

The test checks that both workflows are inactive and read-only, that every schedule, webhook, and email trigger is disabled, that nothing can message a customer, that every Jobber request is a single GraphQL query with no mutation, that recipients come only from Config, and that no secrets are present. It covers the CSV mapper (header aliases, malformed, empty, header-only, and missing-column files), dates, time zones, invalid calendar dates and the daylight-saving policy, past-due and stalled-quote boundaries, GraphQL normalization (including null `startAt` visits), digest wording and [TEST] labeling, and runs the Code nodes pulled out of each workflow JSON end to end. It rewrites `sample_morning_digest.md` and exits 0 only if everything passes.

## License and credit

The pack ships with this site's MIT license. The site is based on Ryan Fitzgerald's devportfolio (MIT).
