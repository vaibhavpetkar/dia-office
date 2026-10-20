# Dia's Virtual Office

Inveon Technologies' virtual office, run by **Dia**. AI agents work in HR, Sales, Engineering and Marketing. You watch them live, and **nothing is hired or taken on without your approval**.

## What really happens

| Flow | Steps |
|---|---|
| **Sales** | Lead (form, cold-call log or CRM webhook) → Kabir captures it → Meera writes the requirement report → Sameer, the sales manager, reviews it → Dia prepares a recommendation and the client message → **you approve** → the client is emailed, a sale order and work order are created |
| **Engineering** | Neel writes a real build plan (stack, tasks, deploy) → Tara builds → you click *Testing → Deploying → Live* as the real work finishes |
| **Marketing** | When a project goes Live, Pooja plans a campaign and Isha drafts a case study and LinkedIn post (drafts for you to review) |
| **HR** | Candidate → Asha writes the interview and task → humans answer on a link, AI-agent candidates are interviewed automatically → Asha scores the answers → Vikram, the reporting manager, reviews → **you approve** → Rohan emails the offer and company policies → the new member appears in the office and billing starts |

Every AI call is recorded with its token count and cost. **AI spend** shows at the top, and AI pauses when it reaches `MONTHLY_AI_BUDGET_USD`.

## Run it on your computer (free)

```bash
cp .env.example .env            # set ADMIN_TOKEN to a long random string
docker compose up -d            # Postgres with pgvector
npm install
npm start                       # http://localhost:8080
```

Open the page, enter your `ADMIN_TOKEN` in **Director key**, and click **Unlock**. Then add a lead or a candidate.

`LLM_PROVIDER=mock` runs the whole office with canned answers and no AI cost. Use it to check that everything works.

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
| POST | `/api/approvals/:id` `{decision:"approve"\|"reject"}` | director key |
| POST | `/api/projects/:id/stage` `{stage}` | director key |
| POST | `/api/kb`, GET `/api/kb/search?q=` | director key |

## Deploying
Run it on one small server (EC2 or a VPS) behind nginx with HTTPS, using `npm start` under pm2 or systemd. Use RDS or the same server for Postgres. Keep `ADMIN_TOKEN` secret, and put the office behind HTTPS before using it with real candidates.

## Honest limits
- The AI plans, analyses, scores and writes drafts. Building and deploying real client software is still done by your developers (or Claude Code). The office tracks it when you move the stage.
- AI interview scores support a person's decision; they don't replace it. Keep a human approving every hire.
