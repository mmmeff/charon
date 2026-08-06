import type {
  UltraReviewArtifact,
  UltraReviewBlobStorage,
} from "../types";
import { parseUltraReviewArtifact } from "./ultraReview.ts";

interface LoadedUltraReviewArtifacts {
  artifacts: Record<string, UltraReviewArtifact>;
  rejected: string[];
}

const repoKey = (repo: string) => repo.replace(/[^a-zA-Z0-9_.-]/g, "__");

export const ultraReviewArtifactsPath = (repo: string) =>
  `repos/${repoKey(repo)}/ultrareviews.json`;

export async function readUltraReviewArtifacts(
  storage: UltraReviewBlobStorage,
  repo: string,
): Promise<LoadedUltraReviewArtifacts> {
  const raw = await storage.loadBlob(ultraReviewArtifactsPath(repo));
  if (raw === null) return { artifacts: {}, rejected: [] };
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { artifacts: {}, rejected: ["<root>"] };
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    return { artifacts: {}, rejected: ["<root>"] };
  }

  const artifacts: Record<string, UltraReviewArtifact> = {};
  const rejected: string[] = [];
  for (const [key, value] of Object.entries(decoded)) {
    try {
      const artifact = parseUltraReviewArtifact(value);
      artifacts[artifact.artifactKey] = artifact;
    } catch {
      rejected.push(key);
    }
  }
  return { artifacts, rejected };
}

export async function writeUltraReviewArtifacts(
  storage: UltraReviewBlobStorage,
  repo: string,
  artifacts: Record<string, UltraReviewArtifact>,
): Promise<void> {
  await storage.saveBlob(
    ultraReviewArtifactsPath(repo),
    JSON.stringify(artifacts, null, 2),
  );
}
