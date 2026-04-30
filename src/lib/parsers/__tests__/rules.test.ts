import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES_YAML,
  getDefaultRules,
  parseRulesYaml,
} from "@/lib/parsers/rules";

describe("business rules parser", () => {
  it("parses the default rules", () => {
    const rules = getDefaultRules();
    expect(rules.aircraft_rules.allow_same_fleet_swap).toBe(true);
    expect(rules.turnaround_rules.default_minutes).toBe(40);
  });

  it("rejects malformed YAML", () => {
    expect(() => parseRulesYaml("aircraft_rules: [")).toThrow();
  });

  it("rejects structurally incomplete rules", () => {
    const missingScoreWeights = DEFAULT_RULES_YAML.replace(
      /score_weights:[\s\S]*$/,
      "",
    );
    expect(() => parseRulesYaml(missingScoreWeights)).toThrow(
      /score_weights/,
    );
  });

  it("rejects invalid field types", () => {
    const invalid = DEFAULT_RULES_YAML.replace(
      "allow_same_fleet_swap: true",
      "allow_same_fleet_swap: maybe",
    );
    expect(() => parseRulesYaml(invalid)).toThrow(
      /allow_same_fleet_swap/,
    );
  });
});
