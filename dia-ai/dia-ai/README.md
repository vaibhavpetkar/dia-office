# Dia AI — Smart Company API (starter)

AI CEO → Managers → Worker agents → Tools, built on AWS (Amazon Bedrock).

This version has the **CEO** and four managers working end to end: **Sales**, **Support**, **Creative** and **Communication**.
Every new department copies the pattern in `dia/sales.py`.

```
main.py            terminal chat with the CEO
dia/ceo.py         Level 1  AI CEO (plans + delegates, no direct tools)
dia/sales.py       Level 2  Sales Manager
                   Level 3  outreach_writer worker agent
                   Level 4  tools: list_leads, send_email (goes to approval queue)
dia/support.py     Level 2  Support Manager
                   Level 3  support_answer_writer worker agent
                   Level 4  tools: search_knowledge, create_ticket, escalate_to_human
dia/creative.py    Level 2  Creative Manager
                   Level 3  image_prompt_writer, content_writer worker agents
                   Level 4  tools: generate_image (Amazon Nova Canvas on Bedrock)
dia/communication.py Level 2  Communication Manager
                   Level 3  message_writer, meeting_notes_writer worker agents
                   Level 4  tools: check_calendar, schedule_meeting, send_message (approval)
approve.py         owner approval desk: list / approve / reject waiting actions
knowledge/         company docs the Support Manager answers from (replace faq.md)
dia/records.py     simple JSON storage in data/ (becomes DynamoDB later)
check_setup.py     checks your AWS login and Bedrock model access
selftest.py        offline test of all tools (no AWS needed)
setup.bat/setup.sh one-time setup for Windows / Mac-Linux
dia/approvals.py   risky actions wait here for the owner (data/approvals.json)
dia/models.py      which Bedrock model each level uses
```

## Run it on your computer

### 1. Install once
- **Python 3.11 or newer**: https://www.python.org/downloads/ (on Windows, tick **"Add Python to PATH"** during install)
- **AWS CLI v2**: https://aws.amazon.com/cli/

### 2. Set up the project (one command)
- **Windows:** double-click `setup.bat` (or run `setup.bat` in a terminal inside this folder)
- **Mac/Linux:** `bash setup.sh`

This creates `.venv`, installs everything, creates `.env`, and runs `selftest.py`.
All lines should say `[OK]`. This step needs no AWS.

### 3. Connect AWS
1. Log in from the terminal: `aws configure` (use the access key of an IAM user, not root).
2. Give that IAM user permission to call Claude. In IAM -> Users -> your user -> **Add permissions -> Create inline policy -> JSON**, paste:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {"Effect": "Allow", "Action": ["bedrock-mantle:CreateInference"], "Resource": "*"},
       {"Effect": "Allow", "Action": ["bedrock:InvokeModel", "bedrock:ListFoundationModels"], "Resource": "*"}
     ]
   }
   ```
   Name it `dia-ai-bedrock` and save.
3. In the AWS console (region **us-east-1**), open **Amazon Bedrock -> Model catalog** and make sure you have access to
   **Claude Opus 5.5**, **Claude Sonnet 5.5** and **Amazon Nova Canvas** (submit the Anthropic use-case form if asked).
4. `.env` (created by setup) already has the right IDs:
   ```
   DIA_CEO_MODEL_ID=anthropic.claude-opus-5-5
   DIA_WORKER_MODEL_ID=anthropic.claude-sonnet-5-5
   ```
   Note: these newer Claude models use Bedrock's Messages API endpoint (`bedrock-mantle`), so the IDs start with
   `anthropic.`, not `us.`. The `us.anthropic...` inference-profile IDs only work with the older Converse API.

### 4. Test
Activate the environment first (every new terminal):
- Windows: `.venv\Scripts\activate`
- Mac/Linux: `source .venv/bin/activate`

```bash
python check_setup.py     # every line should say [OK]
python main.py            # chat with the AI CEO
```

Try these one by one:
1. `Find our new leads and prepare a sales email for each one about our AI chatbot product.`
2. `A customer Asha asks how to reset her password, and Ravi wants a refund.`
3. `Make 2 launch images for our AI chatbot app and write a LinkedIn post.` (images go to `data/images/`)
4. `Book a 1-hour team meeting next Monday at 11:00 with ravi@example.com and asha@example.com about the launch.`
5. The whole company at once: `We launch our new AI chatbot next Monday. Make 2 launch images, write a
   LinkedIn post, book a 1-hour team meeting on Monday at 11:00 with ravi@example.com and
   asha@example.com, and prepare sales emails for our new leads.`

Then check what the AI wants to send:
```bash
python approve.py              # list waiting actions
python approve.py <id> yes     # approve (or: no)
```
Everything the AI creates is in the `data/` folder (tickets, calendar, approvals, images).
Delete `data/` any time to start fresh.

## Add the next manager

Copy `dia/support.py` to, for example, `dia/creative.py`, then:
1. Change the tools.
2. Change the manager prompt.
3. Add the manager to `tools=[...]` in `dia/ceo.py`.
