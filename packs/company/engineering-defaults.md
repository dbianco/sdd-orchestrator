---
id: company.engineering-defaults
tier: retrieved
title: Engineering defaults
---
## Observability

Every service emits structured JSON logs with a request id and exposes `/healthz` and `/metrics`. Alerts page on symptoms (error rate, latency), not on causes.

## Dependencies

Prefer the standard library and existing dependencies. A new dependency needs a one-line reason in the pull request and a licence compatible with MIT or Apache-2.0.

## Feature flags

Behaviour changes that affect users ship behind a flag when they cannot be rolled back with a deploy. Flags are removed within two releases of full rollout.

## Data handling

Exports and reports stream rather than buffer when the result can exceed 10 MB. Personal data fields are listed in the app's data dictionary before they are stored.
