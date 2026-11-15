/**
 * @corsj/core — 数据模型子系统公共出口。
 */
export {
  BASE_DIMENSIONS, DIM, DIMENSIONLESS, SI_PREFIXES, UNITS,
  compatibleUnits, dimToString, divDim, findUnit, mulDim, powDim, requireUnit, sameDim, toSI,
  validateQuantity,
  type BaseDimension, type DimName, type DimensionVector, type QuantityValue, type UnitDef,
} from './units.js';

export {
  isQuantity, registerUnits, validateQuantitySchema,
  type KeyDimension, type Quantity, type QuantityRange, type QuantitySeries,
} from './quantity-schema.js';

export {
  EOP_EXTENSION, EOP_MANIFEST_ENTRY, EOP_SCHEMA, OBJECT_TYPES, RELATION_TYPES,
  type EopManifest, type EvidenceRecord, type ObjectRecord, type ObjectType,
  type Payload, type Relation, type RelationType,
} from './eop-types.js';

export {
  EopPackage, createManifest, loadEop, saveEop, stableStringify, validateManifest,
} from './eop.js';

export {
  buildView, loadView, readEvidenceJson, readObjectPayload, readObjectPayloadText,
  type EopView, type ViewerEvidence, type ViewerNode, type ViewerPayload,
} from './viewer.js';
