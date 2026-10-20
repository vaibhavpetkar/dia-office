# Put Dia's office on AWS

This runs the office on one small EC2 server with Docker, HTTPS from Caddy, Postgres on Amazon RDS (or Neon), Claude through Amazon Bedrock and email through Amazon SES. The server uses an IAM role, so no AWS keys are stored in `.env`.

Region: `ap-south-1` (Mumbai) is closest to Pune. Check that the Claude models you want are offered there in the Bedrock console; if not, use the region Bedrock shows them in for `AWS_REGION` and keep the server in Mumbai.

## 1. Database

Pick one:

- **Amazon RDS for PostgreSQL 16** (`db.t4g.micro` is enough to start). In the same VPC as the server, not publicly accessible, security group allows port 5432 only from the server's security group. pgvector is built in; the office runs `CREATE EXTENSION vector` itself. Connection string: `postgres://USER:PASS@ENDPOINT:5432/dia?sslmode=require`.
- **Neon or Supabase** (free tier): copy their connection string. Nothing else to set up.

Turn on automated backups (RDS) or point-in-time restore (Neon).

## 2. IAM role for the server

Create a role for EC2 with this policy, and attach it to the instance:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["bedrock:InvokeModel"], "Resource": "*" },
    { "Effect": "Allow", "Action": ["ses:SendEmail"], "Resource": "*" }
  ]
}
```

Leave `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` empty in `.env`; the AWS SDK picks up the role.

## 3. Server

1. Launch **EC2 t3.small** (or t4g.small), Amazon Linux 2023 or Ubuntu 24.04, 20 GB disk, with the role from step 2.
2. Security group: allow 80 and 443 from anywhere, and 22 only from your IP (or use Session Manager instead of SSH).
3. Point a domain at it, for example `office.inveon.in` → the instance's Elastic IP.
4. Install Docker and Git, then:

```bash
git clone https://github.com/vaibhavpetkar/dia-office.git && cd dia-office/dia-office
npm run setup -- "postgres://USER:PASS@HOST:5432/dia?sslmode=require"   # or: docker run --rm -v $PWD:/app -w /app node:20-alpine node scripts/setup.js "postgres://..."
```

5. Edit `.env`:

```
PUBLIC_URL=https://office.inveon.in
LLM_PROVIDER=bedrock
AWS_REGION=ap-south-1
BEDROCK_FAST_MODEL_ID=<Haiku inference profile ID from the Bedrock console>
BEDROCK_SMART_MODEL_ID=<Sonnet inference profile ID>
EMBED_DIM=1024
MONTHLY_AI_BUDGET_USD=25
SES_FROM=dia@inveon.in
GITHUB_TOKEN=<fine-grained token: contents + pull requests on this repo only>   # optional, for Dia's code-fix pull requests
```

Set `EMBED_DIM=1024` before the first start when you use Titan embeddings.

6. Build and start the office:

```bash
docker build -t dia-office .
docker run -d --name dia-office --restart unless-stopped --env-file .env -p 127.0.0.1:8080:8080 -v $PWD/fixes:/app/fixes dia-office
docker logs -f dia-office          # shows the director key hint and "open on"
```

7. HTTPS with Caddy (gets and renews the certificate itself). `/etc/caddy/Caddyfile`:

```
office.inveon.in {
  reverse_proxy 127.0.0.1:8080
}
```

The live updates use WebSockets on `/ws`; Caddy passes them through without extra settings. With nginx instead, add `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`.

Open `https://office.inveon.in`, paste `ADMIN_TOKEN` from `.env` and press Unlock.

## 4. Email (SES)

Verify the domain `inveon.in` in SES (add the DKIM records it shows), then request production access so you can email clients and candidates who haven't verified their address. Until then SES only sends to verified addresses; the office logs every email it drafts either way.

## 5. Updating

```bash
cd dia-office && git pull && cd dia-office
docker build -t dia-office . && docker rm -f dia-office
docker run -d --name dia-office --restart unless-stopped --env-file .env -p 127.0.0.1:8080:8080 -v $PWD/fixes:/app/fixes dia-office
```

Database changes in `src/migrations/` run on start. Work that was half-way when you restarted is picked up by Dia's self-check within a few minutes.

## 6. Keep an eye on it

- `docker ps` shows the container as healthy when the database is reachable (the image has a health check on `/api/health`).
- Ask Dia "check yourself" in the chat, or press the chip, for a plain-English health report.
- AI spend is on the top bar and in Records → AI spend; AI pauses at `MONTHLY_AI_BUDGET_USD`.
- Set a monthly AWS Budget alert in the Billing console as a backstop.

## What this costs

Small: one t3.small, one db.t4g.micro (or free Neon), a few GB of storage, and Bedrock tokens. Mock mode and Ollama cost nothing in AI. Check current prices on the AWS pricing pages for your region before you start; Bedrock is billed per token and is capped by `MONTHLY_AI_BUDGET_USD`.
