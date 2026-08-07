# Automation Demos

Automation workflows built with **n8n** and custom **Node.js**, each solving a
real problem a small business actually has — and built to survive contact with
real customers, not just a happy-path screenshot.

Every workflow here is importable as-is. The custom logic lives in `code/src/`
as plain, dependency-free Node.js, is covered by tests, and is injected into
the workflow by a build script — so the logic can be read and tested outside
n8n instead of being buried in a Code node.

## Demos

| # | Demo | What it does | Status |
|---|------|--------------|--------|
| 01 | **[WhatsApp Agent](demos/01-whatsapp-agent/README.md)** | A WhatsApp agent for a real estate agency: understands text *and* voice notes, searches the catalogue and replies with photos, books viewings against a real Google Calendar, answers FAQs, and escalates to a human when it shouldn't guess. The agency runs it from a Google Sheet. | ✅ **Complete** |
| 02 | [E-commerce Pipeline](demos/02-ecommerce-pipeline/README.md) | Order processing: inventory checks, payment/shipping sync, customer notifications | 🚧 Scaffold |
| 03 | [Content Automation](demos/03-content-automation/README.md) | Scheduled content generation and multi-platform publishing | 🚧 Scaffold |
| 04 | [Reporting Pipeline](demos/04-reporting-pipeline/README.md) | Multi-source data aggregation and automated report delivery | 🚧 Scaffold |

---

## Demo 01 — WhatsApp Agent

Real estate agencies answer the same handful of questions over WhatsApp all
day: *"¿tenés departamentos de 2 dormitorios en Nueva Córdoba?"*, *"¿qué
requisitos piden?"*, *"¿lo puedo ver el jueves?"*. That eats the sales team's
day, and leads go cold outside business hours.

**40 nodes, 19 of them custom Node.js, 299 tests.** Verified end to end against
the live Meta WhatsApp Cloud API, a real Google Calendar and a real
spreadsheet — not mocks.

### What it does

- **Understands voice notes.** Half the enquiries an agency gets are audio.
  Meta's webhook carries a media ID, so the workflow trades it for a download
  URL and hands the bytes to Gemini alongside the prompt: **one call** returns
  the transcript, the intent *and* the extracted entities. No separate
  speech-to-text service.
- **Answers with photos.** Property results arrive the way an agency sends
  them — a short message saying what was found, then one image per listing with
  its details as the caption.
- **Books viewings in a real calendar.** It queries `freeBusy` before booking:
  if the slot is taken, the customer gets the nearest free times of that same
  day instead of a double booking. With an email, Google sends the invitation.
- **Remembers the conversation.** Per phone number, for 30 minutes — including
  *what the agent showed*, which is what makes *"me interesa el de Las Flores"*
  resolve to a listing instead of a shrug.
- **Knows when to stop.** Anything ambiguous, contractual or low-confidence is
  escalated to a human with the full lead context, instead of guessed at.

### The agency runs it, not the developer

The catalogue, the business details and the FAQ answers live in **the client's
own Google Sheet** — three tabs, edited by someone who has never seen n8n.
Adding a listing is adding a row. Changing the opening hours changes both what
the agent *says* and which bookings it *accepts*, because both read the same
cell.

Auth is a service account, so onboarding a client is *"share this spreadsheet
with this email address"* — no consent screen, no Google Cloud project of their
own, no token expiring every seven days.

### Built to fail well

Every external call can fail, and each one has a decided answer:

| When this fails | What the customer gets |
|---|---|
| The LLM is down or rate-limited | A human is notified, and the alert says *why* in plain Spanish rather than pasting an API error |
| Google Sheets is unreachable, or a tab is empty | The catalogue bundled in the workflow, and a log line saying so — an outdated catalogue beats telling a customer the agency has no properties |
| The calendar can't be read | The booking proceeds; refusing over an unreadable agenda is worse than an occasional overlap |
| The calendar event can't be created | The visit is still recorded, and the reply never promises an invitation that isn't coming |
| A photo URL doesn't serve an image | The listing appears in the text instead of vanishing |

Most of these exist because they *happened* during development, against the
real APIs. The commit history is written to explain why each decision is what
it is.

---

## How the code is organised

n8n's Code node runs sandboxed and cannot `require()` local files, so custom
logic has to live inside `workflow.json`. Keeping two copies in sync by hand
guarantees they drift, so:

```
code/
├── src/      the source of truth — plain Node.js, no dependencies
├── test/     node:test, run in two timezones
└── scripts/  build-workflow.js injects src/ into the workflow's Code nodes
```

`workflow.json` is committed already built, so importing it needs no build
step. `npm run check:workflow` fails if the committed workflow is stale.

The tests run **twice — once in the machine's timezone and once in UTC** —
because scheduling bugs are the kind that pass locally and fail on a server.

## Tech stack

- **[n8n](https://n8n.io/)** — orchestration: triggers, integrations, branching
- **Node.js** — the logic that native nodes can't express, with zero runtime dependencies
- **LLM APIs** — Gemini by default (free tier), swappable to Anthropic or Groq
  with one environment variable; demo 01 is provider-agnostic by design
- **Meta WhatsApp Cloud API**, **Google Calendar**, **Google Sheets**

## Where to run it

Any n8n instance works — n8n Cloud, `npx n8n` locally, or self-hosted.
[`deploy/`](deploy/README.md) has a Docker Compose setup (n8n + Postgres +
Caddy) that serves every demo from one instance over HTTPS on your own domain,
with certificates handled automatically.

A stable public URL stops being optional once webhooks are involved: several
demos register their URL with a third party (Meta, Stripe, …), and those
services keep calling whatever was registered — so a tunnel URL that changes
between restarts means silently dead triggers.

## Importing a workflow

1. **Create the credentials first.** Each demo's README lists them with their
   exact names; `workflow.json` references them by name, so n8n links them
   automatically on import and the workflow is ready to run.
2. **Workflows → Import from File** → the demo's `workflow.json`.
3. Copy the demo's `.env.example` to `.env` and set the values on your n8n
   instance (n8n does not read `.env` files itself — the variables have to
   reach the process).
4. **Publish** the workflow. Note that importing always deactivates it.

Each demo's README has the full setup, including third-party accounts.

## License

Released under the [MIT License](LICENSE).
