/* posts.ts — blog content as data.
 *
 * Source of truth for /blog index and /blog/:slug detail. Adding a post = one
 * entry in this file. No CMS, no build step. The marketing-site domain owns
 * its narrative; engineers should be able to ship a post by editing one TS
 * file and pressing merge.
 *
 * Security note: post bodies render through the markdown helper in BlogPostPage.
 * Do NOT include secrets, internal cluster hostnames, or production team IDs
 * here — anything that lands in a post ships to the public site. */

export type Post = {
  slug: string
  title: string
  date: string // ISO YYYY-MM-DD
  author: string
  excerpt: string
  body: string // simple markdown — # headings, paragraphs, code fences, lists
}

export const POSTS: Post[] = [
  {
    slug: 'five-people-who-built-something-this-week',
    title: 'Five people who built something on instanode.dev this week',
    date: '2026-05-12',
    author: 'instanode.dev',
    excerpt:
      'An AI agent that needed memory. A founder shipping her MVP at 1 AM. A solo hacker ' +
      'wiring up RAG over PDFs. A staff engineer cleaning up Stripe webhooks. Five real ' +
      'shapes of "I want to build something" — and what they all curled.',
    body: `
# Five people who built something on instanode.dev this week

Every product page lists features. Features are not why people show up. People
show up with a problem at the front of their head and they want it gone in the
next twenty minutes.

This post is about five of them. The names are made up; the shape of each
session is real — pulled from anonymized funnel data and support threads from
this week.

## 1. Cleo, an AI coding agent — needs memory across sessions

Cleo is a long-running agent. She's a coding companion running inside someone's
terminal, handed long-horizon tasks like "ship the auth refactor and the
billing migration by Friday." Across days she has to remember what she tried,
what worked, what the human pushed back on.

The way Cleo used to do this was a flat \`memory.md\` file in the user's home
directory. It worked. It also got out of sync the moment the user opened a
second terminal, broke on a corrupted write, and could not be queried
("what did we decide about Stripe two days ago?").

Cleo's owner gave her one tool call. She used it:

\`\`\`
POST https://api.instanode.dev/db/new
\`\`\`

945 milliseconds later: a real Postgres URL. Cleo created a \`memories\` table,
indexed on \`embedding\` (pgvector ships with the platform), and started
writing one row per decision. She read back via similarity search.

When the user asked about Stripe two days later, Cleo answered correctly,
cited the original message, and didn't lose the thread when the laptop slept.

**What she'd have struggled with elsewhere**: setting up the database
required no signup, no API key, no Docker on the user's machine. The whole
thing was inside Cleo's existing tool budget.

## 2. Maya, a solo founder — shipping her MVP at 1 AM

Maya is shipping a product called Bookbase, a tiny tool that lets people
upload a CSV of book titles and get back tagged, summarized, embedded entries.
She started writing the backend on Sunday afternoon. By Sunday night she had
a working FastAPI app on her laptop. She wanted it live before Monday morning
because she promised a friend a demo.

Maya does not run Kubernetes. Maya does not want to.

She wrote a Dockerfile, ran her code through provisioning + deploy:

\`\`\`
# 1. Postgres for books + embeddings, Redis for tag cache
curl -X POST https://api.instanode.dev/db/new
curl -X POST https://api.instanode.dev/cache/new

# 2. Tar the app, ship it
tar -czf app.tar.gz .
curl -X POST https://api.instanode.dev/deploy/new \\
  -H "Authorization: Bearer $JWT" \\
  -F "tarball=@app.tar.gz" \\
  -F 'env_vars={"DATABASE_URL":"...","REDIS_URL":"..."}'
\`\`\`

90 seconds of build, then a working HTTPS URL on
\`*.deployment.instanode.dev\` with a Let's Encrypt cert.

Maya's full path from "code on laptop" to "URL I can send my friend" was
three curls. She went to bed.

**What she'd have struggled with elsewhere**: every alternative is a tutorial
(Heroku-like, Fly machines, Railway, render). Maya read zero documentation
this session. The endpoints are obvious enough that she could guess them.

## 3. Anders, an indie hacker — wiring RAG over a stack of PDFs

Anders is building Lawclerk, a tiny SaaS that answers questions from a
corpus of legal PDFs. He had the LLM part working in a Jupyter notebook.
What he was missing was the vector store and a way to keep retrieval fast
even when the corpus grew past 10 GB.

Pinecone has a free tier but his account got rate-limited. He tried Weaviate
locally — fine on his laptop, awkward to deploy. He bounced off Qdrant's
auth setup at 11 PM.

The Postgres he got from instanode.dev has pgvector pre-installed. One
table, one HNSW index, one \`CREATE EXTENSION\` not needed:

\`\`\`
CREATE TABLE docs (
  id bigserial PRIMARY KEY,
  embedding vector(1536),
  text text
);
CREATE INDEX ON docs USING hnsw (embedding vector_cosine_ops);
\`\`\`

He fed in 47,000 chunks. Query times stayed under 80 ms at p99 with default
settings. The whole vector layer cost him zero ceremony — it was just
Postgres, and he knew Postgres.

When he wanted to move from anonymous (24h TTL) to permanent, one /claim
call attached the database to his hobby tier ($9/mo). The connection URL
didn't change. His running app didn't blink.

**What he'd have struggled with elsewhere**: every dedicated vector store
adds a SaaS to keep alive. Adding pgvector to a managed Postgres is a
config flag, but most managed providers either don't expose it or charge
extra. The default-on pgvector quietly removed an entire decision.

## 4. Priya, a staff engineer — debugging a third-party webhook

Priya works at an established company. Today she's tracking down a bug:
their Stripe webhook handler occasionally drops an event. She is 90% sure
it's a payload-shape mismatch, but she can't reproduce locally because
\`stripe trigger\` doesn't fire the exact event she needs and ngrok requires
a paid plan for her account size.

She wanted a public URL that received whatever was POSTed and stored every
request verbatim. Two minutes of searching gave her some options that
required an account, then this:

\`\`\`
curl -X POST https://api.instanode.dev/webhook/new
\`\`\`

She got a \`receive_url\` back and pasted it into Stripe as a test endpoint.
The next 14 webhook payloads landed in the platform's \`/webhook/:token/requests\`
log, queryable by curl. She found the malformed field in the second one. The
fix shipped before standup.

**What she'd have struggled with elsewhere**: anonymous webhook receivers
are most often hostile to enterprise security (paid plan, signup, email
verification). The one-curl endpoint was a tool she could justify on a
30-minute timer.

## 5. Two students at a hackathon — 24 hours, one demo

Reza and Tamika met three hours into a hackathon. They wanted to build
"Daily Standup Bot," an internal Slack tool that summarizes what each
person committed to GitHub yesterday and posts it to a channel.

They had until 9 AM the next morning. They are good engineers. They had
never collaborated on a deploy.

\`\`\`
curl -X POST https://api.instanode.dev/db/new       # commit log + summaries
curl -X POST https://api.instanode.dev/cache/new    # rate limit per user
curl -X POST https://api.instanode.dev/webhook/new  # GitHub webhook ingest
\`\`\`

Three curls in their group chat at 3 AM. Within 10 minutes both had the
same set of working backing services. They wrote the bot in Python. They
deployed it with \`/deploy/new\` and a Dockerfile. By 6 AM they had a demo
running against the hackathon Slack workspace. They went to bed for two hours.

They didn't claim. The resources expired at noon the next day. They
didn't care — the bot existed long enough to win second place. They wrote
the names down to come back to it.

**What they'd have struggled with elsewhere**: every "set up a backend"
choice cost them an hour of yak-shaving they didn't have. The 24-hour TTL
matched the shape of a hackathon perfectly.

## What ties them together

These five people don't have much in common. A 24/7 coding agent and a
sleep-deprived hackathon team are not the same customer.

What they share is the moment they show up: **eyes glued to the problem
they want to disappear**. Anything between them and "the thing is alive
on the internet" is friction. Anything that survives that gap is a story
they tell their friends.

Five different starting points, five different problems, one shape of
solution: curl, build, ship, optionally claim.

If you're somewhere in this list — or in a sixth shape we haven't
documented yet — the curl works right now. No signup.
`
  },
  {
    slug: 'why-anonymous-is-the-trial',
    title: 'Why anonymous is the trial',
    date: '2026-05-09',
    author: 'instanode.dev',
    excerpt:
      'Most platforms run a 14-day free trial. We run a 24-hour anonymous tier. Here is why ' +
      'that flip is the most important pricing decision we made.',
    body: `
# Why anonymous is the trial

Most platforms run a 14-day trial. After the trial expires the user has to enter
a credit card, navigate three onboarding screens, and confirm an email. Friction
is the point — it filters out people who would not pay.

We do the opposite. The first 24 hours are entirely anonymous: no signup, no
card, just a curl. After 24 hours the resource expires unless you claim it.
Claiming costs money from day one.

## What we believe

A developer who runs \`curl -X POST https://api.instanode.dev/db/new\` and gets a
working Postgres URL back in under a second has already done the only test that
matters. The decision to pay isn't "is this product good enough to justify a
trial" — it's "is keeping this specific running thing worth $9/mo".

## The numbers

Anonymous → claimed conversion is currently around 4% in beta. Trial-conversion
benchmarks for B2B SaaS hover at 14–18%, so on the surface our number looks
worse. But our anonymous funnel includes traffic that would never have signed
up for a trial in the first place — agents poking the API to see if it works,
people copy-pasting from a blog post, demos. The denominator is bigger.

What we watch instead is "claimed → kept past 7 days" — that's 89% so far.
Once an agent or a human shipped something on instanode.dev, they tend to
keep it.

## What this enables

- Claude Code can provision a postgres in a tool call without asking the user
  for permission first
- A blog post that says "just curl this URL" actually works for the reader
- The platform documentation can demo every feature live, not in a sandbox

That third one is what unlocked the docs you're reading now. The code
snippets here aren't mock requests — they hit production.
`
  },
  {
    slug: 'shipping-with-strict-discipline',
    title: 'Strict-discipline shipping: change → live test → PR → merge',
    date: '2026-05-11',
    author: 'instanode.dev',
    excerpt:
      'A retrospective on shipping 16 friction fixes in a single session, including the one ' +
      'where unit tests passed but the live cluster told a different story.',
    body: `
# Strict-discipline shipping

Most teams ship code by writing it, running the unit tests, opening the PR,
and merging on green CI. We tried something stricter for the last sprint:

1. Write the change
2. Build a container image and roll it out to the live cluster
3. Run real curls against the live cluster — assert the new behavior end-to-end
4. THEN open the PR and merge

It is more work. It found bugs that unit tests missed. Three examples:

## The MinIO build context

We tried to lift the kaniko build-context cap past 1 MiB by switching from k8s
Secrets to s3:// URLs. Unit tests passed. The Job spec contained
\`--context=s3://...\` exactly as expected.

Live cluster, the kaniko Job failed. AWS SDK v2 (which kaniko v1.23 ships with)
resolves S3 endpoints in vhost style by default. Our \`S3_FORCE_PATH_STYLE\`
env var was an SDK v1 knob that the new SDK silently ignored. The bucket name
"instant-build-contexts" was being resolved as a non-existent DNS subdomain.

We never would have caught this from \`go test\`. The live verification
demanded an init-container that curl-fetches from a presigned URL — kaniko sees
only a local tar file.

## The env validator that wasn't

\`POST /db/new?env=Prod\` (uppercase, illegal) returned 201 with
\`env="production"\` in the response. The validation regex was correct. The
helper function returned an error. Two unit tests asserted the regex.

The handler still bypassed it.

\`respondError\` was calling \`c.Status(status).JSON(...)\` which returns nil
on a successful body write. The caller's \`if err != nil\` check was
therefore false on the happy path. Execution continued past the gate and
provisioning succeeded with an empty env, defaulted by NormalizeEnv to
"production".

Centralized fix: \`respondError\` now returns an \`ErrResponseWritten\`
sentinel; the ErrorHandlers detect it and avoid overwriting. Twenty-plus
multi-return validators got their teeth back in one commit.

## What we keep

After the sprint we kept the discipline. The friction is real — we spent
extra minutes per PR rolling out builds and running curls. We also stopped
shipping silent bugs.
`
  },
  {
    slug: 'why-pool-makes-curl-instant',
    title: 'How /db/new dropped from 17s to under a second',
    date: '2026-05-10',
    author: 'instanode.dev',
    excerpt:
      'Pre-warming dedicated Postgres pods, dropping the PVC for the anonymous tier, and ' +
      'caching base images on every node. Three small moves, one big speed-up.',
    body: `
# How /db/new dropped from 17s to under a second

For an AI agent making a curl call, the difference between a 200ms response
and a 17s response is the difference between "I'll just use this" and "I'll
write my own".

Anonymous Postgres provisioning used to take 17 seconds end-to-end. Today it
takes about 950 milliseconds. Three changes, in order of impact:

## 1. Warm pool

Every 30 seconds, a background manager checks the \`pool_items\` table and
makes sure there are at least N ready dedicated Postgres pods (N is
configurable). When \`/db/new\` is called, it pulls a token off the pool,
renames the namespace's customer-pointing user, and returns the connection URL.
The actual \`pg_init\`, namespace creation, and pod startup happened minutes
ago.

That's the difference between cooking when an order arrives and pre-cooking.
The pool item swap is one Redis CAS plus one SQL UPDATE. Sub-second.

## 2. Drop the PVC for anonymous

Anonymous data is 24-hour TTL by definition. Persistent storage adds 5–10s of
DOKS block-storage attach time on cold provision. Anonymous-tier pods now use
\`emptyDir\` — the data lives in pod-local tmpfs and disappears on restart.
That's fine because anyone who wants their data to survive is going to claim
the resource anyway.

This change alone removed about 8 seconds from a cold-path provision.

## 3. Image-puller DaemonSet

The kaniko / Postgres / Redis / Mongo / NATS images were being pulled by every
node on first use. That's another 5–15 seconds gone the first time a node
provisions a specific service type.

A tiny DaemonSet runs an init-container per image that does \`/bin/true\` after
the image is pulled — the pull itself warms containerd's cache. The DaemonSet
runs on every node, including future ones added to the pool. New nodes are
warm before any customer hits them.

## What we learned

Most of our latency was infrastructure ceremony, not the work the customer
actually cares about. The pool decoupled customer time from provisioning time
entirely. The emptyDir change traded durability we didn't need for speed we
did. The image puller eliminated a one-time-per-node tax that hit at the worst
possible moment.

Combined, they make the platform feel instant. That is the entire pitch.
`
  }
]
