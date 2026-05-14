# Security Disclosures

Last updated: 2026-05-13.

This page is the canonical location for reporting security issues to instanode.dev. It is referenced from [`/.well-known/security.txt`](/.well-known/security.txt) per RFC 9116.

---

## Reporting a vulnerability

Email `security@instanode.dev`.

For sensitive reports, encrypt with our PGP key.

- Fingerprint: `E950B348C79A7E867867A76AEC2067042EA4BC23` (RSA 4096, expires 2028-05-14)
- Public key: [`/.well-known/pgp-key.txt`](/.well-known/pgp-key.txt)

Include in your report:

- A clear description of the issue and its impact.
- Steps to reproduce, ideally with a minimal proof of concept.
- The affected URL, endpoint, version, or commit if known.
- Your name or handle for credit, and whether you wish to be acknowledged.

Please do not file public GitHub issues for security reports.

---

## Response SLA

| Stage | Target |
|---|---|
| Acknowledgment of receipt | Within 48 business hours |
| First status update | Within 5 business days |
| Triage and severity rating | Within 10 business days |
| Fix or mitigation plan | Communicated with the triage outcome; timeline depends on severity |
| Public disclosure | Coordinated with the reporter, typically after fix and customer notification |

Business hours are 09:00–18:00 IST, Monday through Friday, excluding Indian public holidays.

---

## Scope

In-scope assets:

- `instanode.dev` and its subdomains (`*.instanode.dev`), including the marketing site, dashboard, and API.
- Customer-facing application URLs hosted on the deployment platform (`*.deployment.instanode.dev`), when the issue is in the platform itself rather than customer code.
- Official client libraries and CLI distributed by instanode.dev.

Out-of-scope:

- Third-party services we use as sub-processors. Report those directly to the service. See the [sub-processor list](./subprocessors.md).
- Denial-of-service findings that rely on volumetric load.
- Social engineering of staff, customers, or sub-processor support teams.
- Physical attacks against any facility.
- Findings that require already-privileged access on the victim machine.
- Best-practice issues without a demonstrable security impact (e.g., missing low-impact headers on static pages).
- Vulnerabilities in customer-deployed application code; report those to the customer that operates the application.

---

## Safe Harbor

We authorize good-faith security research conducted within this scope and policy. While conducting research, please:

- Avoid privacy violations, degradation of the Service, and destruction of data.
- Do not pivot beyond the minimum proof of concept needed to demonstrate impact.
- Do not exfiltrate customer data. If you accidentally encounter customer data, stop, do not retain or share it, and report the finding immediately.
- Use only your own accounts or accounts you have explicit written permission to test.

If you make a good-faith effort to comply with this policy during your research, we will consider your research authorized, will not pursue civil action or initiate a complaint to law enforcement, and will work with you to understand and resolve the issue quickly.

---

## Bug-bounty status

Today we run an informal disclosure program: bounties are paid case-by-case, scaled to severity and quality of the report. A more formal program through HackerOne or Bugcrowd is targeted for onboarding in Q4 2026.

Until then, reporters are eligible for cash awards at our discretion plus public acknowledgment if desired.

---

## Recognition

Researchers who submit valid reports under this policy are credited below with their permission.

| Date | Researcher | Summary |
|---|---|---|
| — | — | No reports acknowledged yet. |

---

## Related documents

- [`/.well-known/security.txt`](/.well-known/security.txt)
- [Breach notification commitment](./breach-notification.md)
- [Data Processing Agreement](./dpa.md)
- [Trust and residency](./trust-residency.md)
