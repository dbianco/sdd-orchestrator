# Reporting CI evidence from GitHub Actions

For compliance apps and high-risk features, and for any app whose policy sets
`evidence: "ci"`, the move out of `verify` accepts test, lint and security
results only from CI. The pipeline posts them with
`scripts/sdd-ci-evidence.mjs`, which reads the feature id from the
`SDD-Ref: <feature_id>` trailer on `HEAD`. Commits without the trailer are
skipped with a notice, so the step is safe on every branch.

## One-time setup

1. Issue a token for the pipeline, restricted to its app:

   ```bash
   sdd-admin token create --for checkout-ci --scope ci --app checkout --name "checkout GitHub Actions"
   ```

2. Store the secret as the repository secret `SDD_CI_TOKEN`, and the server
   URL as the variable `SDD_URL`.
3. Copy `scripts/sdd-ci-evidence.mjs` into the app repository, or fetch it
   from a pinned revision of this repository in the job.

## Job for an npm project

```yaml
  sdd-evidence:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - name: Tests
        run: npx vitest run --reporter=json --outputFile=test-results.json || true
      - name: Lint
        run: npm run lint && echo pass > lint.txt || echo fail > lint.txt
      - name: Security scan
        run: npm audit --json > audit.json || true
      - name: Build evidence.json
        run: |
          jq -n \
            --slurpfile t test-results.json \
            --slurpfile a audit.json \
            --arg lint "$(cat lint.txt)" \
            --argjson files "$(git diff --name-only origin/main...HEAD | jq -R . | jq -s .)" \
            '{
              tests: { command: "npx vitest run", passed: $t[0].numPassedTests, failed: $t[0].numFailedTests },
              lint: $lint,
              security: { status: (if $a[0].metadata.vulnerabilities.high > 0 then "fail" else "pass" end),
                          new_high: $a[0].metadata.vulnerabilities.high },
              files_changed: $files
            }' > evidence.json
      - name: Report to the SDD server
        env:
          SDD_URL: ${{ vars.SDD_URL }}
          SDD_CI_TOKEN: ${{ secrets.SDD_CI_TOKEN }}
          SDD_APP: checkout
        run: node scripts/sdd-ci-evidence.mjs --evidence evidence.json --run-url "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
```

`new_high` above counts every high-severity advisory, not only new ones. If
your scanner can diff against the base branch, report that number instead.

## What the server checks

- The token has the `ci` scope and is allowed for the app.
- The feature belongs to the app.
- At the verify gate: the latest evidence posted since the feature entered
  `verify` is used, and when CI evidence is required it must carry `tests`,
  `lint` and `security` and be for the feature's latest commit. A commit
  pushed after the run makes the evidence stale; rerun the pipeline.
