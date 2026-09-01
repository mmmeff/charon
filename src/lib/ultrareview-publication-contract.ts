import type {
 Severity,
 UltraReviewRisk,
} from "../types";
import contract from "../../scripts/ultrareview-publisher-v2.json";

export type UltraReviewPublicationToolName =
 | "publish_plan"
 | "publish_chapter"
 | "finish_review";

export type UltraReviewPlanGroundingKind =
 | "author_stated"
 | "commit_history"
 | "ci_observed"
 | "existing_feedback"
 | "timeline_event";

export interface UltraReviewPlanGroundingInput {
 kind: UltraReviewPlanGroundingKind;
 claim: string;
}

export interface UltraReviewPlannedChapterInput {
 key: string;
 title: string;
}

export interface UltraReviewPlannedSystemInput {
 key: string;
 title: string;
 thesis: string;
 risk: UltraReviewRisk;
 chapters: UltraReviewPlannedChapterInput[];
}

export interface UltraReviewPlanPublicationInput {
 thesis: string;
 grounding: UltraReviewPlanGroundingInput[];
 systems: UltraReviewPlannedSystemInput[];
}

export interface UltraReviewContextRangeInput {
 path: string;
 startLine: number;
 endLine: number;
 reason: string;
}

export interface UltraReviewConcernInput {
 severity: Severity;
 question: string;
}

export interface UltraReviewBeatPublicationInput {
 title: string;
 claim: string;
 why: string;
 risk: UltraReviewRisk;
 changedEvidenceIds: string[];
 context: UltraReviewContextRangeInput[];
 concerns?: UltraReviewConcernInput[];
}

export interface UltraReviewMechanicalPublicationInput {
 title: string;
 reason: string;
 changedEvidenceIds: string[];
}

export interface UltraReviewChapterPublicationInput {
 chapterKey: string;
 purpose: string;
 before: string;
 after: string;
 risk: UltraReviewRisk;
 dependencyChapterKeys?: string[];
 beats: UltraReviewBeatPublicationInput[];
 mechanicalChanges?: UltraReviewMechanicalPublicationInput[];
}

export interface UltraReviewFailedChapterInput {
 chapterKey: string;
 message: string;
 retryable: boolean;
}

export interface UltraReviewCompletionPublicationInput {
 failedChapters: UltraReviewFailedChapterInput[];
}

export interface UltraReviewPublicationInputByTool {
 publish_plan: UltraReviewPlanPublicationInput;
 publish_chapter: UltraReviewChapterPublicationInput;
 finish_review: UltraReviewCompletionPublicationInput;
}

export interface UltraReviewPublicationIssue {
 code: string;
 path: string;
 message: string;
 repair: string;
}

interface JsonSchema {
 type?: string;
 description?: string;
 properties?: Record<string, JsonSchema>;
 required?: string[];
 additionalProperties?: boolean;
 items?: JsonSchema;
 enum?: unknown[];
 pattern?: string;
 minLength?: number;
 maxLength?: number;
 minimum?: number;
 maximum?: number;
 minItems?: number;
 maxItems?: number;
 uniqueItems?: boolean;
}

interface PublisherToolContract {
 description: string;
 payloadLimitBytes: number;
 inputSchema: JsonSchema;
}

interface PublisherContract {
 contractVersion: number;
 tools: Record<
  UltraReviewPublicationToolName,
  PublisherToolContract
 >;
}

const publisherContract = contract as PublisherContract;

function fieldPath(path: string, field: string): string {
 return path.length === 0 ? field : `${path}.${field}`;
}

function itemPath(path: string, index: number): string {
 return `${path}[${index}]`;
}

function schemaType(value: unknown): string {
 if (Array.isArray(value)) return "array";
 if (value === null) return "null";
 if (
  typeof value === "number"
  && Number.isSafeInteger(value)
 ) {
  return "integer";
 }
 return typeof value;
}

function typeMatches(value: unknown, type: string): boolean {
 if (type === "object") {
  return value !== null
   && typeof value === "object"
   && !Array.isArray(value);
 }
 if (type === "array") return Array.isArray(value);
 if (type === "integer") {
  return typeof value === "number"
   && Number.isSafeInteger(value);
 }
 return typeof value === type;
}

function issue(
 code: string,
 path: string,
 message: string,
 repair: string,
): UltraReviewPublicationIssue {
 return { code, path, message, repair };
}

function validateString(
 value: string,
 schema: JsonSchema,
 path: string,
): UltraReviewPublicationIssue[] {
 if (
  schema.minLength !== undefined
  && (
   value.length < schema.minLength
   || (schema.minLength > 0 && value.trim().length === 0)
  )
 ) {
  return [issue(
   "STRING_TOO_SHORT",
   path,
   `${path} must contain text.`,
   `Provide at least ${schema.minLength} character.`,
  )];
 }
 if (
  schema.maxLength !== undefined
  && value.length > schema.maxLength
 ) {
  return [issue(
   "STRING_TOO_LONG",
   path,
   `${path} has ${value.length} characters; the limit is ${schema.maxLength}.`,
   `Shorten ${path} to ${schema.maxLength} characters or fewer.`,
  )];
 }
 if (
  schema.pattern !== undefined
  && !new RegExp(schema.pattern).test(value)
 ) {
  return [issue(
   "INVALID_FORMAT",
   path,
   `${path} does not match the required format.`,
   schema.description
    ?? `Use a value matching ${schema.pattern}.`,
  )];
 }
 return [];
}

function validateNumber(
 value: number,
 schema: JsonSchema,
 path: string,
): UltraReviewPublicationIssue[] {
 if (
  schema.minimum !== undefined
  && value < schema.minimum
 ) {
  return [issue(
   "NUMBER_TOO_SMALL",
   path,
   `${path} must be at least ${schema.minimum}.`,
   `Use ${schema.minimum} or a larger integer.`,
  )];
 }
 if (
  schema.maximum !== undefined
  && value > schema.maximum
 ) {
  return [issue(
   "NUMBER_TOO_LARGE",
   path,
   `${path} must be at most ${schema.maximum}.`,
   `Use ${schema.maximum} or a smaller integer.`,
  )];
 }
 return [];
}

function validateArray(
 value: unknown[],
 schema: JsonSchema,
 path: string,
): UltraReviewPublicationIssue[] {
 const issues: UltraReviewPublicationIssue[] = [];
 if (
  schema.minItems !== undefined
  && value.length < schema.minItems
 ) {
  issues.push(issue(
   "ARRAY_TOO_SHORT",
   path,
   `${path} requires at least ${schema.minItems} item.`,
   `Add at least ${schema.minItems - value.length} item.`,
  ));
 }
 if (
  schema.maxItems !== undefined
  && value.length > schema.maxItems
 ) {
  issues.push(issue(
   "ARRAY_TOO_LONG",
   path,
   `${path} has ${value.length} items; the limit is ${schema.maxItems}.`,
   `Remove ${value.length - schema.maxItems} item.`,
  ));
 }
 if (schema.uniqueItems) {
  const seen = new Map<string, number>();
  for (let index = 0; index < value.length; index += 1) {
   const key = JSON.stringify(value[index]);
   const previous = seen.get(key);
   if (previous !== undefined) {
    issues.push(issue(
     "DUPLICATE_VALUE",
     itemPath(path, index),
     `${itemPath(path, index)} duplicates ${itemPath(path, previous)}.`,
     "Remove the duplicate item.",
    ));
   } else {
    seen.set(key, index);
   }
  }
 }
 if (schema.items !== undefined) {
  for (let index = 0; index < value.length; index += 1) {
   issues.push(
    ...validateSchema(
     value[index],
     schema.items,
     itemPath(path, index),
    ),
   );
  }
 }
 return issues;
}

function validateObject(
 value: Record<string, unknown>,
 schema: JsonSchema,
 path: string,
): UltraReviewPublicationIssue[] {
 const issues: UltraReviewPublicationIssue[] = [];
 const properties = schema.properties ?? {};
 for (const field of schema.required ?? []) {
  if (!(field in value)) {
   const missingPath = fieldPath(path, field);
   issues.push(issue(
    "MISSING_FIELD",
    missingPath,
    `${missingPath} is required.`,
    properties[field]?.description
     ?? `Provide ${missingPath}.`,
   ));
  }
 }
 if (schema.additionalProperties === false) {
  for (const field of Object.keys(value)) {
   if (!(field in properties)) {
    const extraPath = fieldPath(path, field);
    issues.push(issue(
     "UNSUPPORTED_FIELD",
     extraPath,
     `${extraPath} is not part of the publisher contract.`,
     "Remove this field. Charon may own and derive it.",
    ));
   }
  }
 }
 for (const [field, fieldSchema] of Object.entries(properties)) {
  if (!(field in value)) continue;
  issues.push(
   ...validateSchema(
    value[field],
    fieldSchema,
    fieldPath(path, field),
   ),
  );
 }
 return issues;
}

function validateSchema(
 value: unknown,
 schema: JsonSchema,
 path: string,
): UltraReviewPublicationIssue[] {
 if (
  schema.type !== undefined
  && !typeMatches(value, schema.type)
 ) {
  return [issue(
   "INVALID_TYPE",
   path,
   `${path} must be ${schema.type}; received ${schemaType(value)}.`,
   schema.description
    ?? `Provide ${path} as ${schema.type}.`,
  )];
 }
 if (
  schema.enum !== undefined
  && !schema.enum.includes(value)
 ) {
  return [issue(
   "INVALID_ENUM",
   path,
   `${path} must be one of ${schema.enum.join(", ")}.`,
   `Choose one of ${schema.enum.join(", ")}.`,
  )];
 }
 if (typeof value === "string") {
  return validateString(value, schema, path);
 }
 if (typeof value === "number") {
  return validateNumber(value, schema, path);
 }
 if (Array.isArray(value)) {
  return validateArray(value, schema, path);
 }
 if (value !== null && typeof value === "object") {
  return validateObject(
   value as Record<string, unknown>,
   schema,
   path,
  );
 }
 return [];
}

export class UltraReviewPublicationInputError extends Error {
 readonly issues: UltraReviewPublicationIssue[];

 constructor(issues: UltraReviewPublicationIssue[]) {
  super(
   issues[0]?.message
    ?? "The publication input is invalid.",
  );
  this.name = "UltraReviewPublicationInputError";
  this.issues = issues;
 }
}

export function parseUltraReviewPublicationInput<
 Name extends UltraReviewPublicationToolName,
>(
 name: Name,
 value: unknown,
): UltraReviewPublicationInputByTool[Name] {
 const tool = publisherContract.tools[name];
 const issues = validateSchema(
  value,
  tool.inputSchema,
  "",
 );
 if (issues.length > 0) {
  throw new UltraReviewPublicationInputError(issues);
 }
 return value as UltraReviewPublicationInputByTool[Name];
}

export function ultraReviewPublicationPayloadLimit(
 name: UltraReviewPublicationToolName,
): number {
 return publisherContract.tools[name].payloadLimitBytes;
}

export function ultraReviewPublicationContractVersion(): number {
 return publisherContract.contractVersion;
}
