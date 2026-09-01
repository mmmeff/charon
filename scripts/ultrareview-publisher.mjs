#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import {
 appendFileSync,
 existsSync,
 mkdirSync,
 readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

function argument(name) {
 const index = process.argv.indexOf(name);
 const value = index < 0 ? undefined : process.argv[index + 1];
 if (!value) throw new Error(`Missing ${name}`);
 return value;
}

const inboxPath = argument("--inbox");
const acknowledgmentDirectory = argument("--acks");
const contractPath = argument("--contract");
const contract = JSON.parse(readFileSync(contractPath, "utf8"));
if (contract.contractVersion !== 2) {
 throw new Error("The UltraReview publisher requires contract version 2.");
}
const tools = Object.entries(contract.tools).map(
 ([name, tool]) => ({
  name,
  description: tool.description,
  inputSchema: tool.inputSchema,
 }),
);
const toolByName = new Map(
 tools.map((tool) => [tool.name, tool]),
);

mkdirSync(dirname(inboxPath), { recursive: true });
mkdirSync(acknowledgmentDirectory, { recursive: true });

const sleep = (milliseconds) =>
 new Promise((resolve) => setTimeout(resolve, milliseconds));

function issue(code, path, message, repair) {
 return { code, path, message, repair };
}

function fieldPath(path, field) {
 return path.length === 0 ? field : `${path}.${field}`;
}

function itemPath(path, index) {
 return `${path}[${index}]`;
}

function schemaType(value) {
 if (Array.isArray(value)) return "array";
 if (value === null) return "null";
 if (typeof value === "number" && Number.isSafeInteger(value)) {
  return "integer";
 }
 return typeof value;
}

function typeMatches(value, type) {
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

function validateString(value, schema, path) {
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
   schema.description ?? `Use a value matching ${schema.pattern}.`,
  )];
 }
 return [];
}

function validateNumber(value, schema, path) {
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

function validateArray(value, schema, path) {
 const issues = [];
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
  const seen = new Map();
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

function validateObject(value, schema, path) {
 const issues = [];
 const properties = schema.properties ?? {};
 for (const field of schema.required ?? []) {
  if (!(field in value)) {
   const missingPath = fieldPath(path, field);
   issues.push(issue(
    "MISSING_FIELD",
    missingPath,
    `${missingPath} is required.`,
    properties[field]?.description ?? `Provide ${missingPath}.`,
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

function validateSchema(value, schema, path) {
 if (
  schema.type !== undefined
  && !typeMatches(value, schema.type)
 ) {
  return [issue(
   "INVALID_TYPE",
   path,
   `${path} must be ${schema.type}; received ${schemaType(value)}.`,
   schema.description ?? `Provide ${path} as ${schema.type}.`,
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
  return validateObject(value, schema, path);
 }
 return [];
}

async function waitForAcknowledgment(id) {
 const path = join(acknowledgmentDirectory, `${id}.json`);
 const deadline = Date.now() + 30_000;
 while (Date.now() < deadline) {
 if (existsSync(path)) {
   try {
    return JSON.parse(readFileSync(path, "utf8"));
   } catch {
    // The app may still be replacing the acknowledgment file.
   }
  }
  await sleep(50);
 }
 return {
  accepted: false,
  message: "Charon did not validate the publication within 30 seconds.",
  errors: [issue(
   "VALIDATION_TIMEOUT",
   "",
   "Charon did not validate the publication within 30 seconds.",
   "Retry this call once. Do not change an already accepted publication.",
  )],
 };
}

function write(message) {
 process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, acknowledgment) {
 const output = {
  ok: acknowledgment.accepted === true,
  message: acknowledgment.message,
  ...(acknowledgment.errors === undefined
   ? {}
   : { errors: acknowledgment.errors }),
  ...(acknowledgment.result === undefined
   ? {}
   : { result: acknowledgment.result }),
 };
 write({
  jsonrpc: "2.0",
  id,
  result: {
   content: [{
    type: "text",
    text: JSON.stringify(output),
   }],
   structuredContent: output,
   isError: acknowledgment.accepted !== true,
  },
 });
}

async function callTool(request) {
 const name = request.params?.name;
 const args = request.params?.arguments;
 const tool = toolByName.get(name);
 if (tool === undefined) {
  result(request.id, {
   accepted: false,
   message: `Unknown UltraReview publisher tool ${String(name)}.`,
   errors: [issue(
    "UNKNOWN_TOOL",
    "",
    `Unknown UltraReview publisher tool ${String(name)}.`,
    "Use publish_plan, publish_chapter, or finish_review.",
   )],
  });
  return;
 }
 const payloadBytes = Buffer.byteLength(
  JSON.stringify(args ?? null),
 );
 const payloadLimit = contract.tools[name].payloadLimitBytes;
 if (payloadBytes > payloadLimit) {
  const payloadIssue = issue(
   "PAYLOAD_TOO_LARGE",
   "",
   `${name} is ${payloadBytes} bytes; the limit is ${payloadLimit}.`,
   `Remove ${payloadBytes - payloadLimit} bytes before retrying.`,
  );
  result(request.id, {
   accepted: false,
   message: payloadIssue.message,
   errors: [payloadIssue],
  });
  return;
 }
 const issues = validateSchema(args, tool.inputSchema, "");
 if (issues.length > 0) {
  result(request.id, {
   accepted: false,
   message: issues[0].message,
   errors: issues,
  });
  return;
 }
 const chapterKey = name === "publish_chapter"
  ? args.chapterKey
  : null;
 const id = randomUUID();
 appendFileSync(
  inboxPath,
  `${JSON.stringify({
   id,
   kind: name === "publish_plan"
    ? "plan"
    : name === "publish_chapter"
     ? "chapter"
     : "complete",
   chapterKey,
   payload: args,
  })}\n`,
 );
 result(request.id, await waitForAcknowledgment(id));
}

async function handle(request) {
 if (request.method === "initialize") {
  write({
   jsonrpc: "2.0",
   id: request.id,
   result: {
    protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
    capabilities: { tools: { listChanged: false } },
    serverInfo: {
     name: "charon-ultrareview-publisher",
     version: String(contract.contractVersion),
    },
   },
  });
  return;
 }
 if (request.method === "tools/list") {
  write({
   jsonrpc: "2.0",
   id: request.id,
   result: { tools },
  });
  return;
 }
 if (request.method === "tools/call") {
  await callTool(request);
  return;
 }
 if (request.id !== undefined) {
  write({
   jsonrpc: "2.0",
   id: request.id,
   error: {
    code: -32601,
    message: `Method not found: ${request.method}`,
   },
  });
 }
}

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
 if (!line.trim()) continue;
 try {
  await handle(JSON.parse(line));
 } catch (error) {
  process.stderr.write(
   `${error instanceof Error ? error.message : String(error)}\n`,
  );
 }
}
