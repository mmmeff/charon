import type { AcpMcpServer } from "./acp";
import { native } from "./tauri";
import { uid } from "./template";
import type { UltraReviewPublicationReceipt } from "./ultrareview-publication-artifact";
import type { UltraReviewPublicationIssue } from "./ultrareview-publication-contract";

export interface UltraReviewPublicationEvent {
 id: string;
 kind: "plan" | "chapter" | "complete";
 chapterKey: string | null;
 payload: Record<string, unknown>;
}

export interface UltraReviewPublicationAcknowledgment {
 accepted: boolean;
 message: string;
 errors?: UltraReviewPublicationIssue[];
 result?: UltraReviewPublicationReceipt;
}

export interface PreparedUltraReviewPublication {
 publicationId: string;
 inboxRel: string;
 mcpServer: AcpMcpServer;
}

function publicationEvent(
 value: unknown,
): UltraReviewPublicationEvent | null {
 if (
  value === null
  || typeof value !== "object"
  || Array.isArray(value)
 ) {
  return null;
 }
 const event = value as Record<string, unknown>;
 const kind = event.kind;
 const chapterKey = event.chapterKey;
 const payload = event.payload;
 if (
  typeof event.id !== "string"
  || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(event.id)
  || (
   kind !== "plan"
   && kind !== "chapter"
   && kind !== "complete"
  )
  || (
   kind === "chapter"
   && (
    typeof chapterKey !== "string"
    || chapterKey.trim() === ""
   )
  )
  || (kind !== "chapter" && chapterKey !== null)
  || payload === null
  || typeof payload !== "object"
  || Array.isArray(payload)
 ) {
  return null;
 }
 return {
  id: event.id,
  kind,
  chapterKey: kind === "chapter" ? chapterKey as string : null,
  payload: payload as Record<string, unknown>,
 };
}

export function parseUltraReviewPublicationInbox(
 raw: string,
): UltraReviewPublicationEvent[] {
 return raw
  .split("\n")
  .flatMap((line) => {
   if (!line.trim()) return [];
   try {
    const event = publicationEvent(JSON.parse(line));
    return event ? [event] : [];
   } catch {
    return [];
   }
  });
}

export async function prepareUltraReviewPublication(
): Promise<PreparedUltraReviewPublication> {
 const publicationId = uid("ultra-publication-");
 const paths = await native.prepareUltraReviewPublication(
  publicationId,
 );
 return {
  publicationId,
  inboxRel: paths.inboxRel,
  mcpServer: {
   name: "charon-ultrareview-publisher",
   command: "/usr/bin/env",
   args: [
    "node",
    paths.publisherPath,
    "--inbox",
    paths.inboxPath,
    "--acks",
    paths.acknowledgmentDirectoryPath,
    "--contract",
    paths.publisherContractPath,
   ],
   env: [],
  },
 };
}

export async function acknowledgeUltraReviewPublication(
 publication: PreparedUltraReviewPublication,
 event: UltraReviewPublicationEvent,
 acknowledgment: UltraReviewPublicationAcknowledgment,
): Promise<void> {
 await native.saveBlob(
  `ultrareview-publications/${publication.publicationId}`
   + `/acks/${event.id}.json`,
  JSON.stringify(acknowledgment),
 );
}

export function watchUltraReviewPublications(
 publication: PreparedUltraReviewPublication,
 onEvent: (
  event: UltraReviewPublicationEvent,
 ) => Promise<void>,
): () => Promise<void> {
 let stopped = false;
 let timer: ReturnType<typeof setTimeout> | null = null;
 let work = Promise.resolve();
 const handled = new Set<string>();

 const poll = async () => {
  if (stopped) return;
  try {
   const raw = await native.loadBlob(publication.inboxRel);
   for (
    const event of parseUltraReviewPublicationInbox(raw ?? "")
   ) {
    if (handled.has(event.id)) continue;
    await onEvent(event);
    handled.add(event.id);
   }
  } catch (error) {
   console.warn(
    "UltraReview publication poll failed",
    error,
   );
  } finally {
   if (!stopped) {
    timer = setTimeout(() => {
     work = work.then(poll);
    }, 100);
   }
  }
 };

 work = poll();
 return async () => {
  stopped = true;
  if (timer !== null) clearTimeout(timer);
  await work;
 };
}
