# Data Processing Agreement

> This DPA template is provided for customer review. To execute a signed instance for your organization, contact `privacy@instanode.dev`. The version published on this page is the contractually-binding template — signing follows the standard process described under "Execution" below.

Last updated: 2026-05-13.

---

This Data Processing Agreement ("DPA") forms part of the Master Subscription Agreement or equivalent services agreement (the "Agreement") between the customer ("Controller") and instanode.dev ("Processor") for the provision of the instanode.dev platform (the "Services"). It is entered into pursuant to Article 28 of Regulation (EU) 2016/679 ("GDPR") and applies wherever the Processor processes personal data on behalf of the Controller.

In case of conflict between this DPA and the Agreement, this DPA prevails with respect to data-protection matters.

---

## 1. Subject Matter and Duration

The subject matter of the processing is the provision of managed developer infrastructure (databases, caches, object storage, message queues, webhook receivers, application deployments, and adjacent platform services). The duration of the processing is the term of the Agreement plus any post-termination retention period set out below.

## 2. Nature and Purpose of Processing

The Processor processes personal data only to provide, secure, support, and bill for the Services, and only on documented instructions from the Controller. Documented instructions include the Agreement, this DPA, the Controller's use of the Services' configuration surfaces, and any subsequent written instructions the Controller gives the Processor.

## 3. Categories of Personal Data

The Processor may process the following categories on behalf of the Controller:

| Category | Source | Purpose |
|---|---|---|
| Account identifiers (email, name, organization) | Controller's sign-up | Account management |
| Authentication metadata (OAuth subject, hashed session tokens) | Sign-in flow | Authentication |
| Application content stored in customer-provisioned resources | Controller's applications | Service operation |
| Operational telemetry (request logs, error traces, performance metrics) | Service operation | Reliability, security, support |
| Billing metadata (plan, invoice IDs, transaction amounts; never card data) | Payment processor | Billing |

The Controller acknowledges that the content stored in customer-provisioned resources is controlled, populated, and classified by the Controller; the Processor does not inspect it except where strictly necessary to operate, secure, or recover the Service.

## 4. Categories of Data Subjects

Data subjects may include the Controller's:
- Employees, contractors, and agents who hold accounts on the Service.
- End users of applications the Controller deploys or operates on the Service.
- Any other natural persons whose personal data the Controller chooses to process through the Service.

## 5. Obligations of the Processor

The Processor will:

1. Process personal data only on documented instructions from the Controller, including with regard to transfers to a third country, unless required to do otherwise by Union or Member State law to which the Processor is subject.
2. Ensure that persons authorized to process personal data have committed themselves to confidentiality or are under an appropriate statutory obligation.
3. Implement appropriate technical and organizational measures to ensure a level of security appropriate to the risk (see Annex B).
4. Assist the Controller, by appropriate technical and organizational measures, insofar as possible, for the fulfilment of the Controller's obligation to respond to requests for the exercise of data-subject rights under Chapter III of the GDPR.
5. Assist the Controller in ensuring compliance with Articles 32 to 36 of the GDPR taking into account the nature of processing and the information available to the Processor.
6. At the choice of the Controller, delete or return all personal data to the Controller after the end of the provision of services, and delete existing copies unless retention is required by Union or Member State law.
7. Make available to the Controller all information necessary to demonstrate compliance with the obligations laid down in this clause and Article 28 GDPR, and allow for and contribute to audits, including inspections, conducted by the Controller or another auditor mandated by the Controller, subject to the audit terms in Section 9.

## 6. Sub-processor Authorization

The Controller provides a general written authorization for the Processor to engage sub-processors to assist in providing the Services. The current list of sub-processors is published at [/docs/public/subprocessors](./subprocessors.md). The Processor will:

- Maintain the published list as the authoritative record.
- Notify the Controller by email at least 30 days before adding or replacing a sub-processor.
- Permit the Controller to object to a new sub-processor during that window; if the parties cannot agree on a mitigation, the Controller may terminate the affected Services without penalty for the remainder of the prepaid term.
- Impose data-protection obligations on each sub-processor that are no less protective than those in this DPA.

## 7. International Transfers — Standard Contractual Clauses

Where the Processor or any sub-processor processes personal data outside the European Economic Area, the United Kingdom, or Switzerland in a jurisdiction not benefiting from an adequacy decision, transfers are governed by the Standard Contractual Clauses ("SCCs").

By signing this DPA, the parties incorporate the SCCs published at https://commission.europa.eu/publications/standard-contractual-clauses-international-transfers_en (Commission Implementing Decision (EU) 2021/914, Module Two — Controller to Processor), with this DPA's Annex A serving as the SCC Annex (Annex I.A, I.B, I.C, II, and III). Where the United Kingdom International Data Transfer Addendum or the Swiss FDPIC equivalent applies, the parties incorporate those instruments by reference and treat references to "the GDPR" as references to the UK GDPR or the Swiss FADP, as applicable.

The Processor commits to the supplementary measures described in Annex B (encryption in transit and at rest, key isolation, access controls, logging) to address the risks identified by the European Data Protection Board in its post-Schrems II guidance.

## 8. Data Breach Notification

The Processor will notify the Controller without undue delay, and in any event within 72 hours of becoming aware, of a personal-data breach affecting the Controller's data. The Processor's standing commitment, the definition of "becoming aware," and the content of breach notifications are set out at [/docs/public/breach-notification](./breach-notification.md), which is incorporated into this DPA by reference.

## 9. Audits

The Controller has the right, upon reasonable prior written notice and not more than once per twelve-month period (except following a confirmed breach affecting the Controller's data), to audit the Processor's compliance with this DPA. The Processor will satisfy audit obligations by providing:

1. The Processor's then-current security documentation and trust page (`/docs/public/trust-residency`).
2. Independent third-party attestations once available (SOC 2, ISO 27001, or equivalent).
3. Written responses to a reasonable security questionnaire (CAIQ or equivalent).

On-site audits are available for Team-tier customers under a separate Mutual NDA and at the Controller's cost, scheduled to avoid unreasonable disruption to the Services or other customers.

## 10. Liability

Liability under this DPA is subject to the limitations and exclusions of liability set out in the Agreement. The Processor's aggregate liability under or in connection with this DPA is capped at the amount set in the Agreement; nothing in this DPA limits any liability that cannot be limited under applicable law.

## 11. Termination

This DPA terminates automatically with the Agreement. Upon termination, the Processor will, at the Controller's choice, delete or return all personal data within 30 days, unless retention is required by Union or Member State law, in which case the Processor will continue to protect the data under the obligations of this DPA until deletion. Backups containing personal data will be overwritten in the ordinary course of the Processor's backup-rotation schedule (90 days maximum).

## 12. Execution

This DPA becomes binding upon the earlier of (a) electronic countersignature via the link provided after a written request to `privacy@instanode.dev`, or (b) the Controller's continued use of the Services after publication of this DPA where the Agreement expressly incorporates the published DPA by reference. Either party may request a paper-signed counterpart; the Processor will provide one within 10 business days.

---

## Annex A — Description of Processing

This Annex serves as Annex I to the SCCs.

- **Data exporter:** the Controller, as identified in the Agreement.
- **Data importer:** instanode.dev, the Processor.
- **Categories of data subjects:** as in Section 4.
- **Categories of personal data:** as in Section 3.
- **Sensitive data:** none processed by default. Controllers must not store special-category data (GDPR Article 9) on the Service without a prior written addendum.
- **Frequency:** continuous.
- **Nature and purpose:** as in Sections 1 and 2.
- **Retention:** for the term of the Agreement plus the deletion timeline in Section 11.
- **Sub-processors:** as published at [/docs/public/subprocessors](./subprocessors.md).
- **Competent supervisory authority:** the supervisory authority of the Controller's lead establishment, or where the Controller is outside the EEA, the supervisory authority of the EU Member State in which the Controller's EU representative is located.

## Annex B — Technical and Organizational Measures

| Domain | Measure |
|---|---|
| Encryption in transit | TLS 1.2 or higher for all customer-facing and inter-service traffic |
| Encryption at rest | AES-256-GCM for credentials; provider-side encryption for managed-disk volumes |
| Access control | Role-based access; least-privilege defaults; multi-factor authentication required for production operator access |
| Network isolation | Customer workloads run in segregated environments; egress controlled |
| Logging and audit | Operational logs retained for security investigations; access logs reviewed on incident |
| Key management | Platform secrets generated with cryptographically secure RNGs; rotation supported without service interruption |
| Vulnerability management | Disclosed via [/docs/public/security](./security.md); patch cadence aligned with severity |
| Backup and recovery | Platform-managed backups on a 90-day rolling window; customer-controlled export at any time via the Service API |
| Personnel | Confidentiality obligations in employment terms; background checks where lawful |
| Incident response | 72-hour customer notification commitment per Section 8 |

---

## Related Documents

- [Subprocessor list](./subprocessors.md)
- [Security disclosures and reporting](./security.md)
- [Breach notification commitment](./breach-notification.md)
- [Trust and residency](./trust-residency.md)
