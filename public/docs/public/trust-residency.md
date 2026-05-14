# Data Residency and Trust

This page tells you where your data lives, how durable it is, what compliance posture instanode.dev has today, and what we do not yet support. It is written to be useful during a security review. If you need something that is not on this page, email `security@instanode.dev` or `privacy@instanode.dev` and we will answer.

This page is kept current. The date at the bottom of this document is the last time we reviewed it end-to-end.

---

## Where your data lives

Today, all production infrastructure runs in a single US-east region. Compute runs on redundant US-east managed infrastructure. Object storage runs in `nyc3` on DigitalOcean Spaces. Every customer database — Postgres, Redis, MongoDB — and every object-storage bucket you provision through instanode.dev is co-located in that same region.

There is no customer-pick region selector today. If your data needs to live outside US-east for legal, compliance, or latency reasons, instanode.dev is not yet the right platform for you. See the roadmap below.

---

## What regions we offer today

| Region | Status | Available on |
|---|---|---|
| US-east | Live | All tiers |
| EU-west (eu-west-1) | On roadmap, no committed date | Team tier only |
| India (ap-south-1) | On roadmap, no committed date | Team tier only |

If a future region would unblock you, write to [enterprise@instanode.dev](mailto:enterprise@instanode.dev) and tell us which region and roughly when you would need it. We use that signal to prioritize.

---

## Durability

### Object storage

Object storage is backed by DigitalOcean Spaces, which is an S3-compatible service. DigitalOcean publishes an object durability target of 99.999999999% (eleven nines) with in-region replication. We do not currently replicate object data across regions.

Anonymous-tier object data is auto-deleted at 24 hours via an object-store lifecycle rule, not just via our application logic — so the deletion is enforced at the storage layer.

### Postgres, Redis, MongoDB, vector databases

Customer databases are backed up via snapshot. Snapshot retention by tier:

| Tier | Snapshot retention |
|---|---|
| Anonymous | None — resources are deleted at 24h |
| Hobby | 7 days |
| Pro | 30 days |
| Team | 90 days |

Customer-initiated restore from a snapshot is rolling out for Pro and Team tiers. Until that surface is live, restore is operator-assisted — open a ticket at `support@instanode.dev` with the resource ID and target timestamp.

### Vault

Secrets stored in the vault are encrypted at rest with AES-256-GCM. The data-encryption key is held outside the resource store. Key rotation is supported. Plaintext values are not returnable from any read endpoint once set — you can update or reference the value, but you cannot fetch the plaintext back through the API.

---

## Egress IPs

Outbound traffic from instanode.dev deploy infrastructure leaves from a pool of egress addresses. If you operate a firewall, IP allowlist, or third-party API that needs to see a stable source range, the current CIDR list is:

| CIDR | Purpose |
|---|---|
| `152.42.154.144/32` | Primary egress for compute, builds, webhooks, and outbound API calls |

If you need notification before any of these change, subscribe to the changelog (see [`/changelog`](/changelog)) or email `security@instanode.dev`.

A few honest caveats:

- We do not commit to static egress IPs on the Hobby tier. The pool may change without notice.
- On the Team tier, a dedicated egress IP is available on request through `enterprise@instanode.dev`.
- These are best-effort published ranges, not a contractual guarantee, unless you are on a Team-tier contract that calls them out.

---

## Compliance posture

We aim to say only what is true. Here is what is true today.

| Framework | Status |
|---|---|
| SOC 2 Type II | In progress. Target completion Q3 2026. Audit firm not yet selected. We do not have a SOC 2 report to share today. |
| HIPAA | Not supported. We do not sign Business Associate Agreements today. If you need a BAA, email `enterprise@instanode.dev` so we can scope a Team-tier engagement and tell you whether and when we can support it. |
| GDPR | Standard Contractual Clauses (Module Two, controller-to-processor) are incorporated by reference in our [Data Processing Agreement](./dpa.md) — sign the DPA via `support@instanode.dev` to activate them. The product gating is separate: as of 2026-05, instanode.dev runs in NYC3 only, so customers whose users are EU residents should not route their PII through us without a separate residency commitment from the platform side. EU customers requiring an EU data-residency posture should wait for eu-west-1. |
| PCI-DSS | We do not handle cardholder data. Payment processing runs through Razorpay. Do not store card numbers in instanode.dev resources. |

If you are on a procurement call that requires a compliance answer not listed here, contact `security@instanode.dev` and we will tell you the truth instead of dodging.

---

## How to file a data-handling concern

| Reason | Email |
|---|---|
| Security disclosure or suspected vulnerability | [security@instanode.dev](mailto:security@instanode.dev) |
| Data-handling, privacy, or subject-rights request | [privacy@instanode.dev](mailto:privacy@instanode.dev) |
| Enterprise security review, custom region, BAA inquiry | [enterprise@instanode.dev](mailto:enterprise@instanode.dev) |

We respond within 48 business hours. Coordinated disclosure for security issues is welcome — send a description, reproduction steps, and your preferred handle for credit.

---

## Related documents

- [Data Processing Agreement](./dpa.md)
- [Subprocessor list](./subprocessors.md)
- [Security disclosures and reporting](./security.md)
- [Breach notification commitment](./breach-notification.md)
- [`/.well-known/security.txt`](/.well-known/security.txt)

---

_Last reviewed: 2026-05-14._
