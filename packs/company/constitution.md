---
id: company.constitution
tier: always_on
title: Company constitution
---
- No personal data in logs or error messages (GDPR fines are assessed per incident, and logs are retained for 90 days)
- Every outbound HTTP call has an explicit timeout and a retry budget (an unbounded upstream call took checkout down in INC-12)
- Database schema changes ship as reversible migrations with a tested down path (a one-way migration blocked a rollback during INC-31)
- Public API changes are additive within a major version; removals need a deprecation notice one release earlier (partners integrate against versioned contracts)
- Secrets come from the environment or the secret manager, never from source (a leaked key in a public repo cost a weekend rotation)
- Tests run in CI before merge and a red build blocks the merge (unreviewed hotfixes caused two regressions in 2025)
- Accessibility: interactive elements are keyboard reachable and labelled (procurement requires WCAG 2.1 AA)
