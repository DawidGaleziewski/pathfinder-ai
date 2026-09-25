import type { PortalConfig } from '@pathfinder/config';
import { ACTION_RULES, type ActionRule } from './rules.js';

/**
 * The action rules one run classifies with (research §6). A value, not a module constant, so a
 * portal's own rules apply only to that portal's runs and several runs can share one process.
 */
export interface RuleSet {
  readonly rules: readonly ActionRule[];
  get(id: string): ActionRule | undefined;
}

export function ruleSetOf(rules: readonly ActionRule[]): RuleSet {
  const frozen = Object.freeze([...rules]);
  const byId = new Map(frozen.map((r) => [r.id, r]));
  return { rules: frozen, get: (id) => byId.get(id) };
}

const BUILTIN = ruleSetOf(ACTION_RULES);

export function builtinRuleSet(): RuleSet {
  return BUILTIN;
}

/** The rule set of a run of `portal`: the built-in rules, extended by the portal's own rules. */
export function portalRuleSet(portal: PortalConfig): RuleSet {
  void portal; // portal `action_rules` arrive with User Story 4
  return BUILTIN;
}

/** The resolved rules of a run, for its config snapshot: a run can be re-explained without the portal file. */
export function ruleSetSummary(set: RuleSet): { id: string; class: string; origin: string }[] {
  return set.rules.map((r) => ({ id: r.id, class: r.safetyClass, origin: r.origin ?? 'builtin' }));
}
