# Automation Demos

A portfolio of automation workflows built with **n8n** and custom **Node.js**
code, created to demonstrate the kind of automation services offered on
Fiverr / Upwork.

Each demo targets a real, common business problem — customer messaging,
order processing, content publishing, and reporting — and combines a
visual n8n workflow with custom Node.js code for the logic that goes beyond
what off-the-shelf nodes can do (API integrations, data transforms, LLM
calls, etc.).

## Demos

| # | Demo | Problem it solves | Status |
|---|------|--------------------|--------|
| 01 | [WhatsApp Agent](demos/01-whatsapp-agent/README.md) | AI-assisted WhatsApp agent for a real estate agency: classifies incoming messages, searches the property catalogue, books viewings, and escalates to a human | ✅ Complete |
| 02 | [E-commerce Pipeline](demos/02-ecommerce-pipeline/README.md) | End-to-end order processing: inventory checks, payment/shipping sync, and customer notifications | 🚧 Scaffold |
| 03 | [Content Automation](demos/03-content-automation/README.md) | Scheduled content generation and multi-platform publishing pipeline | 🚧 Scaffold |
| 04 | [Reporting Pipeline](demos/04-reporting-pipeline/README.md) | Scheduled multi-source data aggregation and automated report delivery | 🚧 Scaffold |

## Tech Stack

- **[n8n](https://n8n.io/)** — workflow orchestration (triggers, integrations, branching logic)
- **Node.js** — custom logic where native n8n nodes aren't enough (API clients, data transforms, LLM calls)
- **LLM APIs** (e.g. Claude) — used in demos that require natural-language understanding or generation
- Third-party APIs relevant to each demo (WhatsApp Business, e-commerce platforms, social platforms, etc.) — see each demo's README for specifics

## Repository Structure

```
automation-demos/
├── README.md              # this file
├── LICENSE
├── .gitignore
└── demos/
    └── NN-demo-name/
        ├── README.md       # problem, flow diagram, requirements, how to run
        ├── workflow.json   # exportable/importable n8n workflow
        ├── .env.example    # environment variables used by the demo
        └── code/           # custom Node.js logic
            ├── src/        # source of truth for the code inside the workflow
            ├── test/       # tests (node:test, no dependencies)
            └── scripts/    # build script that injects src/ into workflow.json
```

n8n's Code node runs sandboxed and cannot `require()` local files, so the
custom logic has to live inside `workflow.json`. To avoid keeping two copies
in sync by hand, `code/src/` is the single source of truth and a build script
injects it into the workflow between markers. Each `workflow.json` is
committed already built, so importing it needs no build step.

## How to Import a Workflow into n8n

1. Open your n8n instance and go to **Workflows**.
2. Click **Import from File** (or **Import from URL**, if hosting the file remotely).
3. Select the `workflow.json` file from the demo you want to run.
4. Copy the demo's `.env.example` to `.env` and fill in the required credentials/API keys.
5. Configure the matching credentials inside n8n (Settings → Credentials) as referenced by the workflow's nodes.
6. If the demo includes custom Node.js code, run `npm install` inside its `code/` folder and follow the setup steps in that demo's README.
7. Activate the workflow.

## License

Released under the [MIT License](LICENSE).
