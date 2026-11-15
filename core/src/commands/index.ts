/**
 * @corsj/core — 命令子系统公共出口。
 */
export {
  registerCommand, getCapability, listCapabilities, verifyRegistry, executeCommand,
  COMMAND_COUNT, CORE_COUNT, EXTENSION_COUNT,
  type CommandRegistration,
} from './registry.js';

export {
  designError, envError, notImplemented, ok,
  type Artifact, type Capability, type CommandContext, type CommandExecutor,
  type CommandParams, type CommandResult, type CommandStatus, type L3AssetResolver,
} from './types.js';

export { artPrefix } from './core-commands-1.js';
export { EXTENSION_COMMAND_META, registerExtensionCommands, extensionCommandIds } from './builtin/extension-commands.js';
export { ensureCommandsRegistered } from './builtin/register.js';

export {
  primitiveToStep, primitiveToStl, bboxOf, volumeOf, areaOf, centroidOf,
  type Primitive,
} from './builtin/geometry-kernel.js';

export {
  buildMesh, faceNodes, solveStatic,
  type Material, type FeaLoad, type FeaConstraint, type FeaMesh, type StructureSpec, type StaticSolution,
} from './builtin/fea-kernel.js';

export {
  runErc, runPcbDrc, extractBom, manufacturingOutputs,
  type Netlist, type NetlistComponent, type NetlistNet, type NetlistNode, type ErcFinding,
} from './builtin/eda-kernel.js';

export {
  simulateEnergyClosure, solvePipeResistance, solveThermalStatic, simulateMotion, computeLinkBudget,
  designPropeller, solveHullResistance,
  type EnergyModel, type PipeSpec, type ThermalNetwork, type MotionParams, type LinkBudgetParams,
  type PropellerInput, type PropellerDesignResult, type HullFlowInput, type HullFlowResult,
} from './builtin/physics-kernels.js';
