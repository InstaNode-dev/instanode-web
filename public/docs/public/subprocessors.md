# Subprocessors

Last updated: 2026-05-14.

This page lists the sub-processors instanode.dev engages to provide the Service. It is the authoritative record referenced by the [Data Processing Agreement](./dpa.md) and by Cloud Security Alliance CAIQ Section H responses.

---

## Current sub-processors

| Sub-processor | Role | Data categories processed | Region | DPA in place | SCCs / transfer mechanism |
|---|---|---|---|---|---|
| DigitalOcean | Compute, container orchestration, and DO Spaces object storage hosting customer workloads and data at rest | Customer application data; customer compute workloads; resource credentials encrypted at rest | United States (NYC3 today; eu-west planned) | Yes | Yes — EU-US Data Privacy Framework certified |
| Razorpay | Payment processing (subscription, invoicing, dunning) | Billing metadata: email, plan tier, transaction amounts and timestamps. Card data is tokenized by Razorpay and is never transmitted to or stored by instanode.dev. | India and global | Yes | Standard Contractual Clauses (Module Two) |
| Brevo (formerly Sendinblue) | Transactional email — welcome, upgrade confirmations, payment receipts, dunning notices, deletion-request acknowledgments | Email address; first name | European Union | Yes | Not applicable — EU residency |
| GitHub | OAuth sign-in | GitHub username; primary email; public profile | United States | Yes | Yes — EU-US Data Privacy Framework certified |
| Google | OAuth sign-in | Email address; given name; family name | United States | Yes | Yes — EU-US Data Privacy Framework certified |
| New Relic | Observability — logs, traces, metrics | Operational telemetry; may incidentally include customer identifiers (account UUIDs, email addresses) in error contexts | United States | Yes | Yes — EU-US Data Privacy Framework certified |
| Amazon Web Services (SES bounce handling) | Email-deliverability webhooks (bounce, complaint, suppression) | Masked recipient addresses; delivery status codes | United States | Yes | Yes — EU-US Data Privacy Framework certified |
| Resend | Transactional email — account verification, magic-link sign-in, billing notifications | Email address; auth-token payload contained in the message body during the validity window | United States | Yes | Yes — EU-US Data Privacy Framework certified |
| Cloudflare | CDN + DNS for marketing and dashboard hosts (instanode.dev apex, *.instanode.dev) | HTTP request metadata; payload bytes are visible at the edge because Cloudflare terminates TLS before forwarding to origin | Global edge network | Yes | Yes — EU-US Data Privacy Framework certified |
| Fastly + GitHub Pages | Marketing site and `/docs/public/*` SSG hosting (instanode.dev static assets) | Public marketing content + the dashboard SPA bundle; no PII transits this path | United States + EU edges | Yes | Yes — EU-US Data Privacy Framework certified |
| Loops | Lifecycle email forwarder — onboarding drip, churn-prevention, win-back; sees the same audit event stream the backend emits under the `Loops forwarder` audit kind | Customer email address; tagged lifecycle event metadata (signup, upgrade, downgrade, deletion request) | United States | Yes | Yes — EU-US Data Privacy Framework certified |

---

## Change notification

We notify all customers via email at least 30 days before adding or replacing a sub-processor. Customers may object during that window. If the parties cannot agree on a mitigation, the affected customer may terminate the Service for the remainder of the prepaid term without penalty.

To subscribe a different email address for sub-processor change notices, contact `privacy@instanode.dev`.

---

## Removed sub-processors

None to date.

---

## Related documents

- [Data Processing Agreement](./dpa.md)
- [Breach notification commitment](./breach-notification.md)
- [Security disclosures and reporting](./security.md)
- [Trust and residency](./trust-residency.md)
