CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  dept TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'ai',          -- ai | human
  monthly_cost INT NOT NULL DEFAULT 0,      -- INR
  look JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'Idle',
  tasks_done INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  company TEXT NOT NULL,
  contact TEXT,
  email TEXT,
  need TEXT NOT NULL,
  budget INT,                               -- INR
  source TEXT,
  score INT,
  temperature TEXT,
  report JSONB,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL,
  dept TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'human',
  resume TEXT,
  monthly_cost INT NOT NULL DEFAULT 0,
  token TEXT UNIQUE NOT NULL,
  questions JSONB,
  answers JSONB,
  evaluation JSONB,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approvals (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,                       -- project | hire
  ref_id INT NOT NULL,
  title TEXT NOT NULL,
  body JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  lead_id INT REFERENCES leads(id),
  company TEXT NOT NULL,
  need TEXT NOT NULL,
  value INT,
  so TEXT, wo TEXT,
  stage TEXT NOT NULL DEFAULT 'Won',
  plan JSONB, marketing JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity (
  id SERIAL PRIMARY KEY,
  agent_id TEXT,
  text TEXT NOT NULL,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector({{EMBED_DIM}})
);

CREATE TABLE IF NOT EXISTS llm_usage (
  id SERIAL PRIMARY KEY,
  agent_id TEXT,
  model TEXT,
  input_tokens INT, output_tokens INT,
  cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
