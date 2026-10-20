-- Testing department: each time a project reaches Testing, QA makes a test run.
-- Automated checks run against the project's preview URL; the manual checklist is ticked by a person.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS preview_url TEXT;

CREATE TABLE IF NOT EXISTS test_runs (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT,                                 -- what the automated checks ran against (null = no preview yet)
  status TEXT NOT NULL DEFAULT 'running',   -- running | awaiting_signoff | passed | failed | stopped
  cases JSONB,                              -- Sneha's test cases and Playwright script
  automated JSONB,                          -- [{name, result: pass|fail|warn, detail}]
  manual JSONB,                             -- Aditya's checklist: [{area, check, device, result, note}]
  bugs JSONB NOT NULL DEFAULT '[]',         -- [{source, severity, title, detail}]
  verdict TEXT,                             -- ready | not_ready
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS test_runs_project ON test_runs (project_id);
