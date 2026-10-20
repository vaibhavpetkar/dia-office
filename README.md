# Dia

Inveon Technologies' AI-run company. This repo holds two apps that are planned to be merged into one.

| Folder | What it is | Run it |
|---|---|---|
| [`dia-office/`](dia-office/README.md) | **The virtual office.** A live web page where AI agents in HR, Sales, Engineering and Marketing work through leads, hires and projects, and every big decision waits for your approval. Node + Postgres (pgvector). | `npm install`, `npm run setup`, `npm start` |
| [`dia-ai/`](dia-ai/README.md) | **The agent brain prototype.** An AI CEO that plans a goal and delegates to Sales, Support, Creative and Communication managers. Python + Strands Agents on Amazon Bedrock. Terminal only for now. | `setup.bat` (Windows) or `bash setup.sh` |

## Quick start on Windows (no Docker needed)

1. Install [Node.js 20+](https://nodejs.org).
2. Create a free Postgres database on [Neon](https://neon.tech) or [Supabase](https://supabase.com) and copy its connection string.
3. In PowerShell:
   ```powershell
   cd dia-office
   npm install
   npm run setup -- "postgres://USER:PASS@HOST/DB?sslmode=require"
   npm start
   ```
4. Open http://localhost:8080 and paste the director key that `npm run setup` printed.

The office runs in `mock` AI mode by default, which is free. The Python app in `dia-ai/` needs no database; its `selftest.py` runs offline without an AWS account.
