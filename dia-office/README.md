# Dia's Virtual Office

Inveon Technologies' virtual office, run by **Dia**. AI agents work in HR, Sales, Engineering and Marketing. You watch them live, and **nothing is hired or taken on without your approval**.

## What really happens

| Flow | Steps |
|---|---|
| **Sales** | Lead (form, cold-call log or CRM webhook) → Kabir captures it → Meera writes the requirement report → Sameer, the sales manager, reviews it → Dia prepares a recommendation and the client message → **you approve** → the client is emailed, a sale order and work order are created |
| **Engineering** | Neel writes a real build plan (stack, tasks, deploy) → Tara builds → you click *Testing → Deploying → Live* as the real work finishes |
| **Marketing** | When a project goes Live, Pooja plans a campaign and Isha drafts a case study and LinkedIn post (drafts for you to review) |
| **Support** | A ticket (form, help-desk webhook or "ticket from Acme: …" in chat) → Kavya reads company knowledge and drafts a reply → **you approve** → the client is emailed. Bugs are flagged to Tara |
| **Finance** | When you approve a project, Arjun drafts a 50% advance invoice with 18% GST; at go-live he drafts the balance → **you approve** each before it is emailed → mark it paid when money arrives. The *Profit* tab shows this month's cash in, team billing and AI spend |
| **Goals** | Give Dia several jobs in one message ("add lead X needs Y; ticket from Z: … then check yourself") and she lines up one button per team, plus *Do all* |
| **HR** | Candidate → Asha writes the interview and task → humans answer on a link, AI-agent candidates are interviewed automatically → Asha scores the answers → Vikram, the reporting manager, reviews → **you approve** → Rohan emails the offer and company policies → the new member appears in the office and billing starts |

Every AI call is recorded with its token count and cost. **AI spend** shows at the top, and AI pauses when it reaches `MONTHLY_AI_BUDGET_USD`.

## Run it on your computer (free)

You need **Node 20 or newer** and a **Postgres database with pgvector**. Docker is the easiest way to get the database, but it is not required.

```bash
npm install
npm run setup            # creates .env with a random ADMIN_TOKEN and prints it
npm start                # http://localhost:8080
```

Open the page, paste the printed key into **Director key**, and click **Unlock**. Then add a lead or a candidate.

If the database isn't reachable, the page shows a setup screen that says what went wrong and how to fix it. Fix `DATABASE_URL` in `.env` and press **Try again**. You don't need to restart.

### Get a database

| Option | Steps |
|---|---|
| **Free cloud database (no Docker, works on Windows)** | Create a free project on [Neon](https://neon.tech) or [Supabase](https://supabase.com). Both include pgvector. Copy the connection string and run `npm run setup -- "postgres://USER:PASS@HOST/DB?sslmode=require"` |
| **Docker** | `docker compose up -d`. The default `DATABASE_URL` already points at it. |
| **Postgres on Linux or WSL** | `sudo apt install postgresql-16-pgvector`, then create user and database `dia` with password `dia`. |

On Windows, run the commands in PowerShell. `npm run setup` takes the place of `cp .env.example .env`.

`LLM_PROVIDER=mock` runs the whole office with canned answers and no AI cost. Mock answers are repeatable: the same lead or candidate always gets the same score, so you can demo a flow twice and get the same result.

### Free local AI (Ollama)
```bash
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```
Set `LLM_PROVIDER=ollama` and `EMBED_DIM=768`.

### Claude on Amazon Bedrock (production)
1. Bedrock access approved (use-case form submitted as root/admin).
2. In `.env`: `LLM_PROVIDER=bedrock`, `AWS_REGION`, keys, and the **inference profile IDs** for Haiku (`BEDROCK_FAST_MODEL_ID`) and Sonnet (`BEDROCK_SMART_MODEL_ID`) copied from the Bedrock model catalog.
3. For embeddings with Titan v2, set `EMBED_DIM=1024` **before the first run**. If you change it later, drop the `kb_chunks` table and re-add your documents.
4. IAM permissions: `bedrock:InvokeModel` (and `ses:SendEmail` if you send email).

Haiku handles routine steps. Sonnet is used only for Dia's decisions, interview scoring and build plans.

## Teach Dia about your company (RAG)

Add policies, past proposals, price lists and hiring criteria. Agents read them before answering.

```bash
curl -X POST localhost:8080/api/kb -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"title":"Leave policy","content":"18 paid leaves a year. Working hours 10am–7pm IST."}'
```

## Email (Amazon SES)
Set `SES_FROM` to a verified sender. While SES is in sandbox mode, recipients must be verified too. Without `SES_FROM`, emails only show as drafts in the activity feed.

## Connect a CRM
Point a HubSpot, Zoho or website-form webhook at `POST /api/webhooks/lead` with the header `Authorization: Bearer <ADMIN_TOKEN>` and a body like `{ "company", "contact", "email", "need", "budget", "source" }`.

## API

| Method | Path | Who |
|---|---|---|
| GET | `/api/state` | anyone who can open the page |
| POST | `/api/leads`, `/api/webhooks/lead` | director key |
| POST | `/api/candidates` | director key |
| GET/POST | `/api/interview/:token` | the candidate (secret link) |
| POST | `/api/tickets`, `/api/webhooks/ticket` `{customer, email, subject, message}`, `/api/tickets/:id/close` | director key |
| POST | `/api/invoices/:id/paid` | director key |
| GET | `/api/records/{leads,candidates,projects,decisions,spend,tickets,invoices,finance}` | director key |
| POST | `/api/dia/chat`, `/api/dia/selfcheck`, `/api/dia/repair` | director key |
| POST | `/api/approvals/:id` `{decision:"approve"\|"reject"}` | director key |
| POST | `/api/projects/:id/stage` `{stage}` | director key |
| POST | `/api/kb`, GET `/api/kb`, GET `/api/kb/search?q=` | director key |
| GET | `/api/health`, POST `/api/health/retry` | anyone (setup status only, no data) |

## Tests

`npm test` starts the office in mock mode against a throwaway database and runs every flow end to end (lead to promoted project, AI hire, interview link, knowledge base, chat goals, self-check, support tickets, GST invoices). It **wipes** the database in `TEST_DATABASE_URL` (default `postgres://dia:dia@localhost:5432/dia_test`), so point it at an empty test database only. GitHub Actions runs the same tests on every pull request.

## Database changes

SQL files in `src/migrations/` run once each, in order, on startup. To change the database, add a new numbered file such as `004_add_x.sql`; never edit one that already ran.

## Privacy

Anyone who opens the page sees the office floor and counts. Client names, decisions, money and the activity feed are only sent after the director key is entered, over the API and the live updates. Interview links expire after 14 days, and wrong director keys are rate-limited.

## Deploying

`docker build -t dia-office .` builds one small image (health check included). To run the database and the office together on one machine: `docker compose --profile app up -d --build`.

For AWS (EC2 + RDS or Neon + Bedrock + SES, HTTPS with Caddy), follow **[docs/DEPLOY-AWS.md](docs/DEPLOY-AWS.md)** step by step. Keep `ADMIN_TOKEN` secret and use HTTPS before real clients or candidates see the office.

## Honest limits
- The AI plans, analyses, scores and writes drafts. Building and deploying real client software is still done by your developers (or Claude Code). The office tracks it when you move the stage.
- AI interview scores support a person's decision; they don't replace it. Keep a human approving every hire.
- There is one director key. Separate logins and roles for several people are not built yet.
- Dia's face in the chat is her portrait with blinking, breathing and mouth movement layered on top; the 3D Dia on the floor is a stylised model dressed to match. A photoreal 3D head would need a dedicated avatar service.
- Floor 2 departments start empty: their desks fill as you hire into them. The diners in the canteen are decoration.
- The Python agents in `dia-ai/` are a separate prototype; the office does not call them.
