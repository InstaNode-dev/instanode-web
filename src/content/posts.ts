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
    title: 'Maya shipped on Sunday night',
    date: '2026-05-12',
    author: 'instanode.dev',
    excerpt:
      'A solo founder, six hours of laptop battery, a friend who asked for "the thing" by ' +
      'standup. Three curls and she went to bed. Plus four others who showed up the same week ' +
      'with different problems and the same shape of session.',
    body: `
# Maya shipped on Sunday night

It's 11:47 PM on a Sunday. Maya has six hours of laptop battery, a FastAPI app
she finished an hour ago, and a friend who asked to see "the thing" before
standup. Tabs open: Heroku pricing, Fly.io machine docs, a half-read Render
tutorial. None of them are loaded.

She types \`curl -X POST https://api.instanode.dev/db/new\` and her laptop,
somehow, replies with a working Postgres URL in 945 milliseconds.

This is the third tab Maya didn't have to read. The other four people in this
post had different problems but the same Sunday-night shape: a problem at the
front of their head, low tolerance for ceremony, and the next twenty minutes
to make the problem disappear.

## Maya's full night

Maya is shipping a tool called Bookbase. People upload a CSV of book titles
and get back tagged, summarized entries with embedding vectors attached so
the next "find me books like this one" query is fast. The work was the
modeling, the prompt design, the rate-limiting. The work was not supposed to
be the deploy.

Maya does not run Kubernetes. Maya does not want to.

At 11:50 she has the Postgres URL. She runs \`curl -X POST .../cache/new\`
for Redis — that's where she'll cache the tag dictionary so the LLM doesn't
have to re-derive labels on every request. Two URLs in her clipboard.

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

\`env_vars\` is a JSON map; whatever's in there lands in the deployed pod's
environment on the first build. Maya pastes the two connection URLs in. The
multipart upload completes in three seconds.

90 seconds of build later — there's a kaniko Job grinding away in the platform
cluster, but Maya doesn't have to know that — and the response includes:

\`\`\`
https://bookbase-7a3f.deployment.instanode.dev
\`\`\`

A working HTTPS URL on the deployment subdomain, with a valid Let's Encrypt
cert that cert-manager handled in the background.

Maya curls her own URL: \`{"ok":true,"books_indexed":0}\`. She uploads a sample
CSV. She refreshes. Twelve rows of tagged, summarized books come back.

She sends the URL to her friend at 12:14 AM and goes to bed.

## What that 90 seconds usually costs

Every alternative Maya didn't read is a tutorial. Heroku wants the Procfile.
Fly Machines wants \`flyctl launch\` and a config file. Railway and Render
want her to push to a Git remote. Each of them is a fine product. None of
them are obvious in the dark on a Sunday at midnight.

The instanode endpoints fit in muscle memory: \`/db/new\`, \`/cache/new\`,
\`/deploy/new\`. Maya read zero documentation this session. The platform
shapes itself around what she was going to type anyway.

When she wakes up tomorrow her resources will be marked anonymous and
expire at midnight Monday. If Bookbase has a user by then she'll click the
claim link in the response and pay $9/mo. If it doesn't, the URL goes away
and nothing was wasted.

## Four others, same Sunday-night shape

Maya is not unusual. Four other people showed up this week with different
problems and the same low-ceremony arrival.

### Cleo — a long-running coding agent that needed persistent memory

Cleo runs inside someone's terminal across days, handed tasks like "ship the
auth refactor by Friday." Her old memory was a flat \`memory.md\` file: broke
on corrupted writes, out of sync across terminal tabs, couldn't be queried.
She made one tool call to \`/db/new\` and a Postgres URL came back. Cleo's
schema is a \`memories\` table with a \`vector(1536)\` embedding column —
pgvector (Postgres's vector-similarity extension) ships pre-installed, so
similarity search is a single \`SELECT ... ORDER BY embedding <-> $query\`.
When the user asked about a decision two days later, Cleo answered correctly
and cited the original turn.

### Anders — RAG over a stack of legal PDFs

Anders is building Lawclerk, a tiny SaaS that answers questions from a
corpus of legal PDFs (RAG = retrieval-augmented generation: feed the LLM
relevant snippets from your own corpus instead of relying on its training
data). Pinecone rate-limited him at 11 PM, Weaviate was awkward to deploy,
Qdrant's auth setup beat him. Same \`/db/new\`, same default pgvector. He
created an HNSW index (the standard graph-based nearest-neighbor index;
\`CREATE INDEX ON docs USING hnsw\`), fed in 47,000 chunks, and watched the
99th-percentile latency stay under 80 ms. The whole vector layer was
Postgres, and he already knew Postgres.

### Priya — debugging a Stripe webhook

Priya at an established company. Their Stripe handler drops events
intermittently. \`stripe trigger\` won't fire the specific event she needs;
ngrok wants a paid plan for her account size. Two minutes of searching, then
\`curl -X POST .../webhook/new\` got her a public \`receive_url\`. She pasted
it into Stripe's test endpoint config. The next 14 payloads landed in the
platform's request log; she found the malformed field in the second one. The
fix shipped before standup.

### Reza and Tamika — hackathon, 24 hours, one demo

They met three hours into a hackathon and decided to build "Daily Standup
Bot." They had never collaborated on a deploy. Three curls in their group
chat at 3 AM — \`/db/new\`, \`/cache/new\`, \`/webhook/new\` — and within 10
minutes both had identical working backing services. They wrote the bot in
Python, shipped it with \`/deploy/new\`, demoed at 9 AM, won second place.
They didn't claim; the resources expired at noon the next day. They wrote
the names down to come back to it.

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
