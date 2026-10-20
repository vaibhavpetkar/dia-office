// Finance: Arjun raises GST invoices for won projects (50% advance on approval, balance at go-live).
// Amounts are plain arithmetic, never the AI. Sending an invoice waits for the director's approval.
import { q, one } from "../db.js";
import { monthSpendUSD } from "../llm.js";
import { status, idle, log, handoff, refresh } from "../events.js";
import { requestApproval, onDecision } from "./approvals.js";
import { sendMail } from "../mail.js";

export const GST_RATE = 0.18;
const inr = n => "₹" + Number(n || 0).toLocaleString("en-IN");
const err = (status, message) => Object.assign(new Error(message), { status });

export function amounts(subtotal) {
  const s = Math.round(Number(subtotal) || 0), gst = Math.round(s * GST_RATE);
  return { subtotal: s, gst, total: s + gst };
}

// part: "advance" (50% when the project is approved) or "balance" (the rest when it goes live).
export async function draftInvoice(projectId, part) {
  const p = await one("SELECT p.*, l.email FROM projects p LEFT JOIN leads l ON l.id = p.lead_id WHERE p.id=$1", [projectId]);
  if (!p?.value) return null;
  const label = part === "advance" ? "50% advance" : "Balance on go-live";
  if (await one("SELECT 1 FROM invoices WHERE project_id=$1 AND label=$2 AND status <> 'cancelled'", [p.id, label])) return null;
  const billed = await one("SELECT COALESCE(sum(subtotal),0)::bigint AS s FROM invoices WHERE project_id=$1 AND status <> 'cancelled'", [p.id]);
  const sub = part === "advance" ? Math.round(p.value / 2) : Number(p.value) - Number(billed.s);
  if (sub <= 0) return null;
  await status("arjun", `Raising ${label.toLowerCase()} invoice for ${p.company}`);
  const a = amounts(sub);
  const inv = await one(`INSERT INTO invoices (number, project_id, company, email, label, subtotal, gst, total, due_date)
    VALUES ('INV-' || nextval('invoice_no'), $1, $2, $3, $4, $5, $6, $7, CURRENT_DATE + 15) RETURNING *`,
    [p.id, p.company, p.email, label, a.subtotal, a.gst, a.total]);
  await log("arjun", `drafted ${inv.number} for ${p.company}: ${label}, ${inr(a.subtotal)} + 18% GST = ${inr(a.total)}.`);
  await idle("arjun");
  await handoff("arjun", "dia", inv.number);
  await requestApproval("invoice", inv.id, `Send ${inv.number} to ${p.company}?`, {
    number: inv.number, company: p.company, email: p.email, label, so: p.so,
    subtotal: a.subtotal, gst: a.gst, total: a.total, due_date: inv.due_date });
  refresh("records");
  return inv;
}

const invoiceText = inv => `Hello,\n\nPlease find invoice ${inv.number} for ${inv.label.toLowerCase()} below.\n\n` +
  `Amount: ${inr(inv.subtotal)}\nGST (18%): ${inr(inv.gst)}\nTotal due: ${inr(inv.total)}\nDue by: ${new Date(inv.due_date).toDateString()}\n\n` +
  `Thank you for your business.\n\nArjun, Accounts\n${process.env.COMPANY_NAME || "Inveon Technologies"}`;

onDecision("invoice", async (a, approved) => {
  const inv = await one("SELECT * FROM invoices WHERE id=$1", [a.ref_id]);
  if (!inv) return;
  if (!approved) {
    await q("UPDATE invoices SET status='cancelled' WHERE id=$1", [inv.id]);
    return log("arjun", `cancelled ${inv.number} as you asked.`, null, false);
  }
  await sendMail("arjun", inv.email, `Invoice ${inv.number} from ${process.env.COMPANY_NAME || "Inveon Technologies"}`, invoiceText(inv));
  await q("UPDATE invoices SET status='sent', sent_at=now() WHERE id=$1", [inv.id]);
  refresh("records"); refresh("stats");
});

export async function markPaid(id) {
  const inv = await one("UPDATE invoices SET status='paid', paid_at=now() WHERE id=$1 AND status='sent' RETURNING *", [id]);
  if (!inv) throw err(409, "Only a sent invoice can be marked paid.");
  await log("arjun", `recorded payment of ${inr(inv.total)} for ${inv.number} from ${inv.company}.`);
  refresh("records"); refresh("stats");
  return inv;
}

// This month's simple profit and loss, in INR. Revenue is money received (paid invoices, before GST).
export async function profitAndLoss() {
  const usdInr = parseFloat(process.env.USD_INR || "84");
  const [m, all, payroll, ai] = await Promise.all([
    one(`SELECT COALESCE(sum(subtotal) FILTER (WHERE status='paid'),0)::bigint AS received,
           COALESCE(sum(subtotal) FILTER (WHERE status IN ('sent','paid')),0)::bigint AS invoiced
         FROM invoices WHERE created_at >= date_trunc('month', now()) OR paid_at >= date_trunc('month', now())`),
    one(`SELECT COALESCE(sum(total) FILTER (WHERE status='sent'),0)::bigint AS outstanding,
           COALESCE(sum(total) FILTER (WHERE status='sent' AND due_date < CURRENT_DATE),0)::bigint AS overdue,
           COALESCE(sum(gst) FILTER (WHERE status='paid' AND paid_at >= date_trunc('month', now())),0)::bigint AS gst_collected
         FROM invoices`),
    one("SELECT COALESCE(sum(monthly_cost),0)::bigint AS n FROM agents"),
    monthSpendUSD()
  ]);
  const aiInr = Math.round(ai * usdInr), costs = Number(payroll.n) + aiInr;
  return { month: new Date().toLocaleString("en-IN", { month: "long", year: "numeric" }),
    received: Number(m.received), invoiced: Number(m.invoiced), outstanding: Number(all.outstanding), overdue: Number(all.overdue),
    gst_collected: Number(all.gst_collected), payroll: Number(payroll.n), ai_spend: aiInr, usd_inr: usdInr,
    costs, profit: Number(m.received) - costs };
}
