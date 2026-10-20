-- Support desk and finance: client tickets and GST invoices.
CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  project_id INT REFERENCES projects(id) ON DELETE SET NULL,
  customer TEXT NOT NULL,
  email TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  category TEXT,                            -- bug | question | change_request | billing | other
  priority TEXT,                            -- high | normal | low
  reply JSONB,                              -- Kavya's draft and the sources she used
  status TEXT NOT NULL DEFAULT 'new',       -- new | awaiting_approval | answered | needs_you | closed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ
);

CREATE SEQUENCE IF NOT EXISTS invoice_no START 1001;
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  project_id INT REFERENCES projects(id) ON DELETE SET NULL,
  company TEXT NOT NULL,
  email TEXT,
  label TEXT NOT NULL,                      -- e.g. "50% advance"
  subtotal BIGINT NOT NULL,                 -- INR, before GST
  gst BIGINT NOT NULL,
  total BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',     -- draft | sent | paid | cancelled
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS invoices_project ON invoices (project_id);
