# Quickstart: Validating Portal-Agnostic Safety and Portal Workspaces

Proves spec 002 end to end. Assumes spec 001's quickstart prerequisites (Node 22+, pnpm,
`pnpm --dir apps/crawler install`, a working Chromium). Commands run from the repo root.

## 1. Unit suites (FR-002, FR-010 to FR-017, FR-025; SC-002, SC-005, SC-006)

```bash
pnpm --dir apps/crawler test
```

- **Expect**: all spec 001 tests still pass; the robots fixtures (uniqa.pl, allegrolokalnie.pl,
  wykop.pl, pl.wikipedia.org, olx.pl, RFC 9309 examples) give the expected verdicts, including
  every uniqa `cHash` campaign URL in the 50-URL sample (SC-002); the spec 001 labelled actions
  keep their classes (SC-005); every invalid portal rule and cross-portal `extends` in the test
  set fails with the file and rule named (SC-006, SC-009).

## 2. Robots on the insurer mock (User Story 1; SC-001)

Run the integration file for the insurer mock (5 consecutive map runs):

```bash
pnpm --dir apps/crawler exec vitest run packages/mcp-server/tests/insurer-run.test.ts
```

- **Expect**: 0 requests in the mock's log to `*cHash*`, `/quote/summary` or `/api/` (with the
  default `robots_page_requests: block`); `/quote/start` visited; each skipped link is a frontier
  item `robots_disallowed` with its `robots:` rule; the `/api/` calls appear as decision-log
  `note` entries; the run's config snapshot holds the robots policy and its evidence reference.
- Repeat with the mock portal file set to `robots_page_requests: allow_and_record`: `/api/` is
  requested and still recorded as a `note`; navigations to disallowed URLs stay refused.

## 3. Robots failures (FR-004; SC-003)

The same test file runs the mock with `robots.txt` answering 404, 503 and a redirect loop.

- **Expect**: 404 → run proceeds, policy `no_rules`; 503 and redirect loop → `start_run` returns
  `ROBOTS_UNAVAILABLE` in under 5 s and the mock logged only `robots.txt` requests.

## 4. Configuration only (User Story 3; SC-004, SC-007)

- The insurer mock is mapped from `portals/<mock>/portal.yaml` and `personas/<mock>/guest.yaml`
  created by the test; no source file mentions it.
- **Expect**: "Kup polisę" refused under `purchase`, "Wyślij zapytanie" under `submit_request`,
  "Przedłuż polisę" under the portal rule `renew_policy`; the quote form's fields are recorded,
  never submitted.
- Search for portal ids and domains in code:

```bash
grep -rniE "uniqa|allegro|lokalnie|olx|wykop" apps/crawler/packages/*/src .claude/agents
```

  **Expect**: no matches (SC-007).

## 5. Workspaces, export and delete (User Story 5; SC-008, SC-009)

Map both mock portals into one sandbox DB (the integration test does this), then:

```bash
pnpm --dir apps/crawler portal:export mock --env sandbox --operator "qa"
pnpm --dir apps/crawler portal:delete mock --env sandbox --operator "qa"          # dry run
pnpm --dir apps/crawler portal:delete mock --env sandbox --operator "qa" --yes
```

- **Expect**: the export folder holds only the marketplace mock's rows and evidence; the dry run
  lists counts and shared evidence it would keep; after the delete, 0 rows of that portal
  remain, the insurer mock's rows and evidence are byte-identical to before, and
  `portal_data_log` has an `export` and a `delete` row naming `qa`.
- Identical pages on the two mocks (the shared cookie page) are two states, one per portal.

## 6. Live check on uniqa.pl (after T072 sign-off in spec 001)

Ask the main session: "Use the crawler subagent to map `uniqa` as `guest`".

- **Expect**: the run's robots policy for `www.uniqa.pl` has `outcome = rules`; no request in the
  run touches a `robots.txt`-disallowed URL (checked from the decision log and the network
  shapes); `cHash` menu links appear in the frontier report as `robots_disallowed`.
