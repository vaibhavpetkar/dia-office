// Email through Amazon SES. Without SES_FROM, emails are only logged in the office feed.
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { log } from "./events.js";

let ses;
export async function sendMail(fromAgent, to, subject, body) {
  if (!to) { await log(fromAgent, `drafted "${subject}" but the person has no email address.`, { subject, body }, false); return false; }
  if (!process.env.SES_FROM) {
    await log(fromAgent, `drafted email "${subject}" to ${to} (not sent: SES not configured).`, { subject, body }, false);
    return false;
  }
  ses ??= new SESv2Client({ region: process.env.AWS_REGION });
  const cc = process.env.HR_CC ? [process.env.HR_CC] : [];
  await ses.send(new SendEmailCommand({
    FromEmailAddress: process.env.SES_FROM,
    Destination: { ToAddresses: [to], CcAddresses: cc },
    Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: body } } } }
  }));
  await log(fromAgent, `emailed "${subject}" to ${to}.`, { subject, body }, false);
  return true;
}
