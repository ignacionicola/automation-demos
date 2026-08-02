# Deploying n8n

A production Docker setup that hosts every demo in this repo on a single n8n
instance, reachable over HTTPS on your own domain.

Running n8n from a laptop with a tunnel (`ngrok`) is fine while developing, but
it isn't something you hand to a client: the machine has to stay on, and free
tunnel URLs are not guaranteed to survive a restart. That matters more than it
sounds — several demos register **webhooks** with third-party services (Meta,
Stripe, …), and those services keep calling whatever URL was registered at the
time. A URL that changes means silently dead webhooks.

## What you get

| Service | Role |
|---|---|
| **n8n** | The workflow engine. Pinned to `2.8.4` — the version the demos were verified against. |
| **Postgres** | n8n's database. The default (SQLite) doesn't survive real concurrent use. |
| **Caddy** | HTTPS termination. Obtains and renews Let's Encrypt certificates on its own. |

Only Caddy is exposed to the internet; n8n and Postgres are reachable only from
inside the Compose network.

## Requirements

- A **Linux server** with a public IP. The demos are light — the smallest tier
  at Hetzner / DigitalOcean / Vultr (~1 vCPU, 2 GB RAM) is enough.
- A **domain or subdomain** you control, with an `A` record pointing at that
  server's IP. Let's Encrypt validates over HTTP, so DNS must resolve *before*
  the first start.
- **Docker** with the Compose plugin. Install it with the official convenience
  script if the server doesn't have it:

  ```bash
  curl -fsSL https://get.docker.com | sh
  ```

## Setup

```bash
git clone https://github.com/ignacionicola/automation-demos.git
cd automation-demos/deploy

cp .env.example .env
```

Fill in `.env`. Two values must be generated, not invented:

```bash
openssl rand -base64 32   # POSTGRES_PASSWORD
openssl rand -hex 32      # N8N_ENCRYPTION_KEY
```

> **Keep `N8N_ENCRYPTION_KEY` safe.** It's what n8n encrypts stored credentials
> with. If it ever changes, n8n can no longer decrypt the credentials it
> already has and every one of them has to be re-entered by hand. Back it up
> alongside the database.

Then start everything:

```bash
docker compose up -d
```

The first start pulls the images and runs n8n's database migrations, which
takes a couple of minutes. Follow along with:

```bash
docker compose logs -f n8n
```

It's ready when the log says `Editor is now accessible via`. Open
`https://your-domain` and create the owner account.

From there, import the workflows and configure credentials as described in each
demo's README — for example
[demo 01](../demos/01-whatsapp-agent/README.md#3-n8n-credentials).

## Day-to-day

```bash
docker compose ps                 # what's running
docker compose logs -f n8n        # follow n8n's logs
docker compose restart n8n        # restart just n8n
docker compose down               # stop everything (volumes are kept)
docker compose up -d              # start again
```

### Updating n8n

Change the image tag in `docker-compose.yml`, then:

```bash
docker compose pull n8n
docker compose up -d n8n
```

n8n migrates its own database on start. Migrations are one-way — take a backup
first, and read the release notes for breaking changes before jumping a major
version.

### Backups

Everything that matters lives in the Postgres volume, plus the encryption key
in `.env`. A dump of both is a complete backup:

```bash
docker compose exec -T postgres pg_dump -U n8n n8n > n8n-$(date +%F).sql
```

Restoring into a fresh instance requires the **same** `N8N_ENCRYPTION_KEY` —
otherwise the credentials in that dump can't be decrypted.

## Troubleshooting

**Caddy can't get a certificate.** Almost always DNS or a firewall. Confirm the
domain resolves to this server (`dig +short your-domain`) and that ports 80 and
443 are open — Let's Encrypt validates over port 80 even though the result is
served on 443. Check with `docker compose logs caddy`.

**n8n restarts in a loop.** Check `docker compose logs n8n`. The usual cause is
Postgres credentials that don't match between the `postgres` and `n8n` services
— both read the same variables from `.env`, so a value edited after the volume
was first created won't match what Postgres actually has. Either restore the
original password or recreate the database volume (`docker compose down -v`,
which **deletes all data**).

**Credentials all show as invalid after a redeploy.** `N8N_ENCRYPTION_KEY`
changed. Restore the previous value; there's no way to recover them otherwise.

**Webhooks stopped firing after moving servers.** The URL registered with the
third party still points at the old host. Re-activate the affected workflows so
they re-register — for the WhatsApp trigger, see the
[demo 01 notes](../demos/01-whatsapp-agent/README.md#1-meta-whatsapp-cloud-api-setup).
