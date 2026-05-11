/* useCases.ts — content source for /use-cases.
 *
 * Fifty-plus unique scenarios where the platform fits — AI coding agents,
 * multi-agent systems, vertical AI apps, browser automation, dev tooling,
 * indie AI SaaS, etc. Each case names which platform service(s) it would
 * use so the reader sees the path from "I have this problem" to "I curl
 * this URL".
 *
 * Source for the list: research pass against 2025–2026 agent ecosystem
 * articles, MCP server registries, agentic framework READMEs (LangGraph,
 * CrewAI, AutoGen), and conference talks. Each entry was filtered for:
 * (1) specific not vague, (2) current not historical, (3) actually
 * implementable with the platform's six services + deploy.
 *
 * Adding a case = one entry. Scenarios are intentionally abstract — no
 * real customer names, no production identifiers. */

export type Service = 'pg' | 'redis' | 'mongo' | 'nats' | 'minio' | 'webhook' | 'deploy'

export type Category =
  | 'A. AI coding agents'
  | 'B. Multi-agent systems'
  | 'C. Vertical AI apps'
  | 'D. Personal AI'
  | 'E. Browser & automation agents'
  | 'F. Developer tooling'
  | 'G. Internet-of-AI'
  | 'H. Indie & SaaS founders'
  | 'I. Hackathon & education'

export type UseCase = {
  title: string
  category: Category
  scenario: string
  services: Service[]
}

export const USE_CASES: UseCase[] = [
  // ─── A. AI coding agents ──────────────────────────────────────────
  {
    title: 'Coding-agent cross-session memory',
    category: 'A. AI coding agents',
    scenario:
      'A terminal-resident coding agent persists architectural decisions across days so it can recall "what we tried Tuesday" via pgvector similarity search.',
    services: ['pg'],
  },
  {
    title: 'Ephemeral test database for a risky migration',
    category: 'A. AI coding agents',
    scenario:
      'A coding agent provisions a throwaway Postgres in under a second, dry-runs a destructive migration, inspects the result, then discards the database — no production blast radius.',
    services: ['pg'],
  },
  {
    title: 'Repo-wide code dependency graph',
    category: 'A. AI coding agents',
    scenario:
      'An agent indexes a polyrepo into a blast-radius graph so it can answer "what breaks if I rename this function" before editing.',
    services: ['pg'],
  },
  {
    title: 'PR-review bot triggered by webhooks',
    category: 'A. AI coding agents',
    scenario:
      'A code-review agent receives PR webhooks from GitHub, posts inline comments, and re-reviews on each push while caching diffs between runs.',
    services: ['webhook', 'redis'],
  },
  {
    title: 'Sandboxed test runner per task',
    category: 'A. AI coding agents',
    scenario:
      'A coding agent spins up a throwaway container per task to run the user\'s test suite in isolation, tears it down on success or failure.',
    services: ['deploy'],
  },
  {
    title: 'Tool-call rate-limit and budget cache',
    category: 'A. AI coding agents',
    scenario:
      'A coding agent caches LLM token budgets and rate-limit windows in Redis so parallel sub-agents don\'t burn quota fighting each other.',
    services: ['redis'],
  },
  {
    title: 'Conversation transcript archive',
    category: 'A. AI coding agents',
    scenario:
      'Coding sessions are persisted as JSONL transcripts for replay, fine-tuning, and "what did we try last sprint" search across the team.',
    services: ['minio'],
  },
  {
    title: 'Multi-repo shared scratchpad',
    category: 'A. AI coding agents',
    scenario:
      'Multiple agents working across separate repos coordinate via a shared scratchpad document store keyed by feature branch.',
    services: ['mongo'],
  },

  // ─── B. Multi-agent systems ────────────────────────────────────────
  {
    title: 'LangGraph state checkpoints',
    category: 'B. Multi-agent systems',
    scenario:
      'A LangGraph workflow checkpoints node state to Postgres so a crashed run resumes mid-graph instead of restarting from scratch.',
    services: ['pg'],
  },
  {
    title: 'CrewAI message bus fan-out',
    category: 'B. Multi-agent systems',
    scenario:
      'A crew of planner / retriever / critic agents publishes tasks on NATS subjects so any worker pod can pull and reply.',
    services: ['nats'],
  },
  {
    title: 'AutoGen group-chat history',
    category: 'B. Multi-agent systems',
    scenario:
      'An AutoGen multi-agent chat stores per-conversation message logs in Mongo for audit and replay across days.',
    services: ['mongo'],
  },
  {
    title: 'Shared episodic memory store',
    category: 'B. Multi-agent systems',
    scenario:
      'A planner and a researcher agent read and write the same episodic memory table so each agent sees the other\'s findings.',
    services: ['pg'],
  },
  {
    title: 'Durable agent task queue',
    category: 'B. Multi-agent systems',
    scenario:
      'A supervisor agent enqueues sub-tasks on a durable queue; failed jobs re-emerge with exponential backoff.',
    services: ['nats'],
  },
  {
    title: 'Cross-framework A2A gateway',
    category: 'B. Multi-agent systems',
    scenario:
      'A gateway service translates A2A-protocol messages between a LangGraph crew and a CrewAI crew over pub/sub.',
    services: ['nats', 'pg'],
  },
  {
    title: 'Live agent status broadcast',
    category: 'B. Multi-agent systems',
    scenario:
      'Worker agents broadcast heartbeats on a status subject so a dashboard shows which agent is stuck mid-tool-call.',
    services: ['nats', 'redis'],
  },

  // ─── C. Vertical AI apps ───────────────────────────────────────────
  {
    title: 'Clinical-scribe note storage',
    category: 'C. Vertical AI apps',
    scenario:
      'A medical scribe agent transcribes doctor-patient visits and stores structured SOAP notes per encounter with auditable history.',
    services: ['pg', 'minio'],
  },
  {
    title: 'Personal-injury demand letters',
    category: 'C. Vertical AI apps',
    scenario:
      'A legal agent drafts demand letters from case files, stores prior versions, and emits webhooks to the firm\'s case-management system.',
    services: ['pg', 'webhook'],
  },
  {
    title: 'AML transaction monitor',
    category: 'C. Vertical AI apps',
    scenario:
      'A finance agent ingests transaction streams, flags suspicious patterns, and persists compliance decisions with full reasoning trace.',
    services: ['pg', 'nats'],
  },
  {
    title: 'Adaptive-tutoring student model',
    category: 'C. Vertical AI apps',
    scenario:
      'A tutor agent tracks per-student concept mastery, picks the next problem, and adjusts difficulty based on response patterns.',
    services: ['pg'],
  },
  {
    title: 'Contract redline cache',
    category: 'C. Vertical AI apps',
    scenario:
      'A contract-review agent caches clause embeddings so re-running redlines on a 200-page MSA is instant on the second pass.',
    services: ['pg', 'redis'],
  },
  {
    title: 'EHR appointment webhook fan-in',
    category: 'C. Vertical AI apps',
    scenario:
      'A medical-intake agent receives appointment-created webhooks from multiple EHR vendors and unifies them into one queue.',
    services: ['webhook', 'nats'],
  },

  // ─── D. Personal AI / second brain ────────────────────────────────
  {
    title: 'Obsidian-vault embedding sync',
    category: 'D. Personal AI',
    scenario:
      'A personal research agent embeds Obsidian notes nightly into pgvector and answers questions across years of writing.',
    services: ['pg'],
  },
  {
    title: 'Cross-device chat history',
    category: 'D. Personal AI',
    scenario:
      'A personal assistant stores conversation history in Mongo so the same agent picks up context on phone, laptop, and watch.',
    services: ['mongo'],
  },
  {
    title: 'Daily-journal episodic memory',
    category: 'D. Personal AI',
    scenario:
      'An assistant logs each day as a structured journal entry and retrieves "what was I working on Monday?" with sub-second latency.',
    services: ['pg', 'redis'],
  },
  {
    title: 'arXiv-and-RSS research feed',
    category: 'D. Personal AI',
    scenario:
      'A research agent receives webhook pings from arXiv and RSS bridges, dedupes via Redis, and stores PDFs for later retrieval.',
    services: ['webhook', 'redis', 'minio'],
  },
  {
    title: 'Voice-memo capture pipeline',
    category: 'D. Personal AI',
    scenario:
      'A second-brain agent receives uploaded voice memos, transcribes them, and files transcripts plus audio for semantic search.',
    services: ['minio', 'pg'],
  },
  {
    title: 'CRM for one person',
    category: 'D. Personal AI',
    scenario:
      'A personal CRM agent remembers names, birthdays, and last-conversation summaries indexed per contact.',
    services: ['pg'],
  },

  // ─── E. Browser / automation agents ───────────────────────────────
  {
    title: 'Browser-session cookie store',
    category: 'E. Browser & automation agents',
    scenario:
      'A browser agent persists login cookies and session state per target site so it doesn\'t re-auth on every run.',
    services: ['redis'],
  },
  {
    title: 'Scraped product-price history',
    category: 'E. Browser & automation agents',
    scenario:
      'A shopping-watcher agent scrapes prices hourly and stores time-series rows for "alert me when it drops 20%".',
    services: ['pg'],
  },
  {
    title: 'Screenshot evidence archive',
    category: 'E. Browser & automation agents',
    scenario:
      'A QA agent captures before/after screenshots on every test run and stores them keyed by run-id for diff review.',
    services: ['minio'],
  },
  {
    title: 'Browser job queue with retries',
    category: 'E. Browser & automation agents',
    scenario:
      'A fleet of Playwright workers pulls navigation tasks from a queue, marks them done, and retries on captcha.',
    services: ['nats'],
  },
  {
    title: 'Form-fill state machine',
    category: 'E. Browser & automation agents',
    scenario:
      'A long-running form-completion agent persists field-by-field progress so a captcha pause doesn\'t lose 30 minutes of work.',
    services: ['mongo'],
  },
  {
    title: 'Accessibility-tree selector cache',
    category: 'E. Browser & automation agents',
    scenario:
      'A scraping agent caches a11y-tree snapshots in Redis so repeat selectors resolve in single-digit milliseconds.',
    services: ['redis'],
  },

  // ─── F. Developer tooling ─────────────────────────────────────────
  {
    title: 'Full dev backend in one curl',
    category: 'F. Developer tooling',
    scenario:
      'An AI agent or developer provisions Postgres + Redis + MongoDB anonymously to develop against — no Docker, no cloud account, no installer — and tears it down when done.',
    services: ['pg', 'redis', 'mongo'],
  },
  {
    title: 'Pre-commit skill-scanner webhook',
    category: 'F. Developer tooling',
    scenario:
      'An MCP skill security scanner receives pre-commit webhooks, scans agent skills against a ruleset, and blocks the push on critical findings.',
    services: ['webhook'],
  },
  {
    title: 'SARIF scan-result store',
    category: 'F. Developer tooling',
    scenario:
      'A security scanner posts SARIF results into Postgres so trend dashboards show drift over weeks of commits.',
    services: ['pg'],
  },
  {
    title: 'Deploy-status MCP server',
    category: 'F. Developer tooling',
    scenario:
      'An MCP server tracks live deploy status across environments and pushes updates to a chat agent over pub/sub.',
    services: ['nats', 'redis'],
  },
  {
    title: 'CI flake-tracker',
    category: 'F. Developer tooling',
    scenario:
      'A CI bot ingests test-run webhooks, fingerprints failures, and surfaces "this test is flaky 30% of runs".',
    services: ['webhook', 'pg'],
  },
  {
    title: 'High-volume PR-review pipeline',
    category: 'F. Developer tooling',
    scenario:
      'An automated reviewer handles thousands of MRs/day, queues each review job, and stores comment artifacts per run.',
    services: ['nats', 'minio'],
  },
  {
    title: 'On-call incident-response agent',
    category: 'F. Developer tooling',
    scenario:
      'An on-call agent listens for alert webhooks, executes a runbook, and posts the action log back into the incident ticket.',
    services: ['webhook', 'pg'],
  },

  // ─── G. Internet-of-AI / A2A ──────────────────────────────────────
  {
    title: 'A2A agent-card registry',
    category: 'G. Internet-of-AI',
    scenario:
      'A marketplace stores Agent Cards (skills, tags, pricing) and serves discovery queries to client agents.',
    services: ['pg'],
  },
  {
    title: 'x402 micropayment ledger',
    category: 'G. Internet-of-AI',
    scenario:
      'An agent-payment hub records x402 micropayments between agents and reconciles balances per principal.',
    services: ['pg'],
  },
  {
    title: 'Agent reputation log',
    category: 'G. Internet-of-AI',
    scenario:
      'Buyer agents leave ratings on seller agents after each tool call; reputation scores aggregate hourly.',
    services: ['pg', 'redis'],
  },
  {
    title: 'AP2 mandate audit trail',
    category: 'G. Internet-of-AI',
    scenario:
      'An agentic-commerce gateway stores signed user mandates ("buy X up to $Y") for later dispute resolution.',
    services: ['pg', 'minio'],
  },
  {
    title: 'Cross-agent shared inbox',
    category: 'G. Internet-of-AI',
    scenario:
      'Two agents negotiate over a shared subject; messages persist in JetStream so neither needs to be online simultaneously.',
    services: ['nats'],
  },
  {
    title: 'Agent-marketplace preview thumbnails',
    category: 'G. Internet-of-AI',
    scenario:
      'An agent marketplace stores screenshot previews of each listed agent\'s UI for human browsing.',
    services: ['minio'],
  },

  // ─── H. Indie / SaaS founders ────────────────────────────────────
  {
    title: 'One-afternoon MVP backend',
    category: 'H. Indie & SaaS founders',
    scenario:
      'A solo founder spins up Postgres + Redis from a curl call in their Claude Code session and ships a paid product by evening.',
    services: ['pg', 'redis', 'deploy'],
  },
  {
    title: 'Pre-launch waitlist store',
    category: 'H. Indie & SaaS founders',
    scenario:
      'A landing page captures emails via a webhook receiver and stores them with UTM context for nurture campaigns.',
    services: ['webhook', 'pg'],
  },
  {
    title: 'Stripe-event entitlements',
    category: 'H. Indie & SaaS founders',
    scenario:
      'A SaaS receives Stripe webhooks, updates user plan tier, and invalidates a Redis entitlement cache atomically.',
    services: ['webhook', 'redis', 'pg'],
  },
  {
    title: 'Solo-founder analytics warehouse',
    category: 'H. Indie & SaaS founders',
    scenario:
      'A founder pipes product events into Postgres and runs SQL queries via an MCP-Postgres tool from chat.',
    services: ['pg'],
  },
  {
    title: 'Side-project container deploy',
    category: 'H. Indie & SaaS founders',
    scenario:
      'An indie hacker ships a Dockerized app to a subdomain with one HTTP call — no DevOps account, no Helm chart, no IaC.',
    services: ['deploy'],
  },

  // ─── I. Hackathon / education ─────────────────────────────────────
  {
    title: '24-hour hackathon backend',
    category: 'I. Hackathon & education',
    scenario:
      'A team provisions Postgres + Mongo + MinIO anonymously, ships their demo, and lets the stack expire 24 hours after judging.',
    services: ['pg', 'mongo', 'minio'],
  },
  {
    title: 'Classroom-per-student sandbox',
    category: 'I. Hackathon & education',
    scenario:
      'A CS professor provisions one ephemeral Postgres per student for a SQL assignment, dropped after grading.',
    services: ['pg'],
  },
  {
    title: 'Agent-resilience chaos lab',
    category: 'I. Hackathon & education',
    scenario:
      'A research hackathon tests how agents behave when their database, cache, and message bus randomly fail mid-task.',
    services: ['pg', 'redis', 'nats'],
  },
]
