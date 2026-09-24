import { describe, expect, it } from 'vitest';
import {
  ACTION_RULES,
  builtinRuleSet,
  checkDenylist,
  classifyAction,
  classifyUrl,
  ruleSetOf,
} from '../src/index.js';
import { labeledActions } from './fixtures.js';

describe('RuleSet seam (research §6)', () => {
  it('the built-in set holds exactly the built-in rules', () => {
    expect(builtinRuleSet().rules.map((r) => r.id)).toEqual(ACTION_RULES.map((r) => r.id));
    expect(builtinRuleSet().get('logout')?.safetyClass).toBe('destructive');
    expect(builtinRuleSet().get('nope')).toBeUndefined();
  });

  it.each(labeledActions.map((a) => [a.id, a] as const))(
    'classifyAction with and without an explicit set agree on %s',
    (_id, a) => {
      expect(classifyAction(a.descriptor, builtinRuleSet())).toEqual(classifyAction(a.descriptor));
    },
  );

  it('classifyUrl and checkDenylist agree with and without an explicit set', () => {
    for (const url of ['/wyloguj', '/oferta/123', '/kup-teraz/9', '/checkout']) {
      expect(classifyUrl(url, builtinRuleSet())).toEqual(classifyUrl(url));
      const classification = classifyUrl(url);
      expect(
        checkDenylist(
          ['logout', 'payment', 'path:/oferta/*'],
          { url, classification },
          builtinRuleSet(),
        ),
      ).toEqual(checkDenylist(['logout', 'payment', 'path:/oferta/*'], { url, classification }));
    }
  });

  it('two sets coexist without affecting each other', () => {
    const only = ruleSetOf([
      { id: 'custom', safetyClass: 'destructive', keywords: [/\bzniszcz\b/], paths: [] },
    ]);
    const d = { role: 'button', name: 'Zniszcz' };
    expect(classifyAction(d, only).rules).toEqual(['custom']);
    expect(classifyAction(d).rules).not.toContain('custom');
    expect(builtinRuleSet().get('custom')).toBeUndefined();
    expect(only.get('logout')).toBeUndefined();
  });
});
