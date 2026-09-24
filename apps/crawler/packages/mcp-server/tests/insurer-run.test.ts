import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { canLaunchBrowser } from '@pathfinder/crawler';
import { mapPortal, startHarness, type Body } from './harness.js';
import { startMockInsurer, type MockInsurerOptions } from './mock-insurer.js';
import type { MockPortal } from './mock-portal.js';

const available = await canLaunchBrowser();

/** Written by the test: the insurer mock is onboarded with configuration only (SC-004). */
const insurerYaml = (
  origin: string,
  o: { pageRequests?: 'block' | 'allow_and_record'; denylist?: string } = {},
) => `
id: insurer
base_url: ${origin}/
environment: sandbox
scope:
  allowed_domains: [127.0.0.1]
  allowed_paths: ["/*"]
  external_link_policy: record
  max_depth: 4
  max_states: 40
  max_actions_per_state: 40
  max_run_time_minutes: 5
  max_steps: 60
denylist: ${o.denylist ?? '[logout, delete, payment]'}
obstacles:
  - { id: cookie_dialog, selector: "#CybotCookiebotDialogBodyButtonDecline" }
rate_limit: { requests_per_second: 20, max_concurrency: 1, user_agent: "PathfinderAI-Crawler/0.1 (+ops@corp.pl)" }
robots_page_requests: ${o.pageRequests ?? 'block'}
`;
const PERSONA =
  'id: guest\nauth: none\nmax_action_class: read\nviewport: { width: 1280, height: 800 }\nlocale: pl-PL\n';

const mocks: MockPortal[] = [];
afterEach(async () => {
  for (const m of mocks.splice(0)) await m.close();
});

async function insurer(
  opts: MockInsurerOptions = {},
  yaml: Parameters<typeof insurerYaml>[1] = {},
) {
  const mock = await startMockInsurer(opts);
  mocks.push(mock);
  const h = await startHarness({
    'portals/insurer/portal.yaml': insurerYaml(mock.origin, yaml),
    'personas/insurer/guest.yaml': PERSONA,
  });
  return { mock, ...h };
}

const DISALLOWED = [/cHash/, /^\/quote\/(?!start)/, /^\/api\//];

describe.skipIf(!available)('insurer mock: robots.txt (spec 002 US1, SC-001, SC-003)', () => {
  it('5 consecutive map runs never request a robots-disallowed URL', async () => {
    const { mock, ctx, call, cleanup } = await insurer();
    try {
      const runIds: string[] = [];
      for (let i = 0; i < 5; i++) runIds.push(await mapPortal(call, 'insurer', mock.origin + '/'));

      const offending = mock.requests.filter((r) => DISALLOWED.some((re) => re.test(r.url)));
      expect(offending).toEqual([]);
      expect(mock.hits('/quote/start').length).toBeGreaterThan(0);
      expect(mock.hits('/robots.txt').length).toBe(5); // once per run

      for (const runId of runIds) {
        const skipped = await ctx.db
          .selectFrom('frontier')
          .select(['status', 'reason', 'action_json'])
          .where('run_id', '=', runId)
          .where('status', '=', 'robots_disallowed')
          .execute();
        const reasons = skipped.map((s) => s.reason ?? '');
        expect(reasons.some((r) => r.startsWith('robots:Disallow: *cHash*'))).toBe(true);
        expect(reasons.some((r) => r.startsWith('robots:Disallow: /quote/'))).toBe(true);

        const refusals = await ctx.db
          .selectFrom('decision_log')
          .select(['kind', 'rule', 'detail_json'])
          .where('run_id', '=', runId)
          .where('rule', 'like', 'robots:%')
          .execute();
        // every skipped link is also in the decision log with its rule (SC-001: 100%)
        expect(
          refusals.filter((d) => d.kind === 'skip' || d.kind === 'refuse').length,
        ).toBeGreaterThanOrEqual(skipped.length);
        const notes = refusals.filter((d) => d.kind === 'note');
        expect(notes.length).toBeGreaterThan(0);
        expect(notes.every((n) => n.rule === 'robots:Disallow: /api/')).toBe(true);
        expect(JSON.parse(notes[0]!.detail_json!)).toMatchObject({ action: 'blocked' });

        const run = await ctx.db
          .selectFrom('runs')
          .select(['config_snapshot', 'coverage'])
          .where('id', '=', runId)
          .executeTakeFirstOrThrow();
        const snap = JSON.parse(run.config_snapshot) as Body;
        expect(snap.robots).toMatchObject({
          product_token: 'PathfinderAI-Crawler',
          page_requests: 'block',
          policies: [{ outcome: 'rules' }],
        });
        const evidence = JSON.parse(
          readFileSync(ctx.evidence.resolve(snap.robots.policies[0].evidence_ref), 'utf8'),
        ) as Body;
        expect(evidence.body).toContain('Disallow: *cHash*');
        expect(JSON.parse(run.coverage!).robots).toMatchObject({
          refused_navigations: expect.any(Number),
          page_requests_allowed: 0,
        });
        expect(JSON.parse(run.coverage!).robots.page_requests_blocked).toBeGreaterThan(0);
      }
    } finally {
      await cleanup();
    }
  }, 300_000);

  it('a direct navigate to a disallowed URL is refused with the robots rule', async () => {
    const { mock, call, cleanup } = await insurer();
    try {
      const runId = (await call('start_run', { portal_id: 'insurer', persona_id: 'guest' })).body
        .run_id as string;
      const r = await call('navigate', {
        run_id: runId,
        url: mock.origin + '/formularze-online/?itm_campaign=x&cHash=02e3',
      });
      expect(r).toMatchObject({
        isError: true,
        body: { error: { code: 'ACTION_REFUSED', rule: 'robots:Disallow: *cHash*' } },
      });
      expect(mock.requests.filter((q) => q.url.includes('cHash'))).toEqual([]);
    } finally {
      await cleanup();
    }
  }, 60_000);

  it('allow_and_record: the page own /api/ call goes out and is noted; navigations stay refused', async () => {
    const { mock, ctx, call, cleanup } = await insurer({}, { pageRequests: 'allow_and_record' });
    try {
      const runId = await mapPortal(call, 'insurer', mock.origin + '/');
      expect(mock.hits('/api/').length).toBeGreaterThan(0);
      expect(mock.requests.filter((r) => /cHash|^\/quote\/summary/.test(r.url))).toEqual([]);
      const notes = await ctx.db
        .selectFrom('decision_log')
        .select('detail_json')
        .where('run_id', '=', runId)
        .where('kind', '=', 'note')
        .execute();
      expect(notes.map((n) => JSON.parse(n.detail_json!).action)).toContain('allowed');
    } finally {
      await cleanup();
    }
  }, 120_000);

  it('robots.txt 404: the run proceeds with policy no_rules', async () => {
    const { mock, ctx, call, cleanup } = await insurer({ robots: '404' });
    try {
      await mapPortal(call, 'insurer', mock.origin + '/');
      const rows = await ctx.db.selectFrom('robots_policies').select('outcome').execute();
      expect(rows.map((r) => r.outcome)).toEqual(['no_rules']);
      expect(mock.hits('/api/').length).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  }, 120_000);

  it.each<['503' | 'loop']>([['503'], ['loop']])(
    'robots.txt %s: start_run refuses with ROBOTS_UNAVAILABLE in under 5 s, only robots requested',
    async (variant) => {
      const { mock, ctx, call, cleanup } = await insurer({ robots: variant });
      try {
        const t0 = Date.now();
        const r = await call('start_run', { portal_id: 'insurer', persona_id: 'guest' });
        expect(Date.now() - t0).toBeLessThan(5000);
        expect(r).toMatchObject({ isError: true, body: { error: { code: 'ROBOTS_UNAVAILABLE' } } });
        expect(mock.requests.every((q) => /^\/robots(\.txt|-loop\/)/.test(q.url))).toBe(true);
        expect(await ctx.db.selectFrom('runs').selectAll().execute()).toEqual([]);
      } finally {
        await cleanup();
      }
    },
    60_000,
  );
});

describe.skipIf(!available)('insurer mock: url: denylist entries (spec 002 US2)', () => {
  it('skips only the sessionId link as denylisted with the url: entry', async () => {
    const { mock, ctx, call, cleanup } = await insurer(
      {},
      { denylist: '[logout, delete, payment, "url:/*?*sessionId=*"]' },
    );
    try {
      const runId = await mapPortal(call, 'insurer', mock.origin + '/');
      expect(mock.requests.filter((r) => r.url.includes('sessionId'))).toEqual([]);
      expect(mock.hits('/porady/').length).toBeGreaterThan(0); // the plain link is followed
      const denied = await ctx.db
        .selectFrom('frontier')
        .select(['reason', 'action_json'])
        .where('run_id', '=', runId)
        .where('status', '=', 'denylisted')
        .execute();
      expect(denied.length).toBeGreaterThan(0);
      expect(denied.every((d) => d.reason!.startsWith('url:/*?*sessionId=*'))).toBe(true);
      expect(denied.every((d) => d.action_json.includes('sessionId'))).toBe(true);
    } finally {
      await cleanup();
    }
  }, 120_000);
});
