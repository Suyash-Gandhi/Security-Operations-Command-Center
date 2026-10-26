import { DetectionRuleType, DetectionSeverity } from "@prisma/client";

export type ThresholdConfig = {
  ruleType: "THRESHOLD";
  eventType: string;
  field?: string;
  operator?: "EQ" | "NEQ";
  value?: string;
  groupBy?: string[];
  threshold: number;
  windowMinutes: number;
};

export type SequenceConfig = {
  ruleType: "SEQUENCE";
  steps: Array<{ eventType: string }>;
  windowMinutes: number;
};

export type DetectionRuleConfig = ThresholdConfig | SequenceConfig;

export interface RuleDefinition {
  id: string;
  organizationId: string | null;
  name: string;
  description: string;
  ruleType: DetectionRuleType;
  configuration: DetectionRuleConfig;
  severity: DetectionSeverity;
  enabled: boolean;
  version: number;
}
