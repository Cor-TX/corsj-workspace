/**
 * @corsj/core — B 层设计子系统公共出口。
 */
export {
  ACCEPTANCE_SPEC_OBJECT_TYPE, freezeSpec, validateAcceptanceSpec,
  type AcceptanceSpec, type ClarificationRequest, type FrozenAcceptanceSpec,
  type RequirementItem, type Threshold, type ThresholdOp, type ValidatorSpec, type ValidatorStrength,
} from './acceptance-spec/schema.js';

export {
  ELIGIBILITY_MATRIX, L3_EXTENSION_COMMANDS, canBeRequired, coreCommands, eligibilityOf,
  extensionCommands, l4Commands, validateStrengthGrant,
  type EligibilityRule,
} from './acceptance-spec/eligibility-matrix.js';

export {
  METRIC_RULES, generateAcceptanceSpec, thresholdToSI,
  type AuthorizationRecord, type GenerateSpecInput, type GenerateSpecResult, type MetricRule, type ParsedRequirements,
} from './acceptance-spec/generator.js';

export {
  DESIGN_STATES, ALLOWED_TRANSITIONS, DesignStateMachine, StateTransitionError,
  canTransition, isTerminal,
  type DesignState,
} from './state-machine.js';

export {
  DEFAULT_ITERATION_CONFIG, DEFAULT_ITERATION_PARAMS,
  type CommandStatus, type FailureClass, type IterationConfig, type IterationParams,
} from './config/schema.js';

export { ITERATION_CONFIG_FILENAME, loadIterationConfig } from './config/loader.js';

export {
  degradationDigest, degradationRecord, freezeDegradation, validateDegradation,
  type DegradationKind, type DegradationRecord, type FrozenDegradation,
} from './degradation.js';

export {
  GATE_COMMAND_ID, actualToNumber, deliveryGateSubmit, evaluateThreshold,
  renderGateReport, resolvePath, specHash, targetToNumber,
  type BuildManifest, type BuildManifestEntry, type GateBranch, type GateInput, type GateVerdict,
  type ValidatorEvidence, type ValidatorOutcome,
} from './delivery-gate.js';

export {
  DesignSession, createUnavailableAssetResolver, runDesignLoop,
  type ExecutionRecord, type LoopOptions, type LoopResult, type RoundPlan, type RoundRecord,
} from './engine.js';
