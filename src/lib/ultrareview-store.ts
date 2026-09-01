import { create } from "zustand";
import type {
  UltraReviewArtifact,
  UltraReviewArtifactIdentity,
  UltraReviewBlobStorage,
  UltraReviewGenerationStatus,
} from "../types";
import { native } from "./tauri";
import {
  readUltraReviewArtifacts,
  writeUltraReviewArtifacts,
} from "./ultrareview-storage";
import {
  recoverInterruptedUltraReviewArtifact,
} from "./ultrareview-recovery";
import { useAgentStore } from "./store";
import { ultraReviewArtifactKey } from "./ultraReview.ts";

interface UltraReviewStoreState {
  repo: string | null;
  loaded: boolean;
  artifacts: Record<string, UltraReviewArtifact>;
  rejectedArtifactKeys: string[];
  init(
    repo: string,
    storage?: UltraReviewBlobStorage,
  ): Promise<void>;
  put(
    artifact: UltraReviewArtifact,
    storage?: UltraReviewBlobStorage,
  ): Promise<void>;
  update(
    artifactKey: string,
    updater: (artifact: UltraReviewArtifact) => UltraReviewArtifact,
    storage?: UltraReviewBlobStorage,
  ): Promise<void>;
}

let persistenceQueue: Promise<void> = Promise.resolve();

function persist(
  repo: string,
  artifacts: Record<string, UltraReviewArtifact>,
  storage: UltraReviewBlobStorage,
): Promise<void> {
  const snapshot = { ...artifacts };
  persistenceQueue = persistenceQueue
    .catch(() => undefined)
    .then(() => writeUltraReviewArtifacts(storage, repo, snapshot));
  return persistenceQueue;
}

export const useUltraReviewStore = create<UltraReviewStoreState>(
  (set, get) => ({
    repo: null,
    loaded: false,
    artifacts: {},
    rejectedArtifactKeys: [],

    async init(repo, storage = native) {
      if (get().repo === repo && get().loaded) return;
      set({
        repo,
        loaded: false,
        artifacts: {},
        rejectedArtifactKeys: [],
      });
      const loaded = await readUltraReviewArtifacts(storage, repo);
      if (get().repo !== repo) return;
      set({
        loaded: true,
        artifacts: loaded.artifacts,
        rejectedArtifactKeys: loaded.rejected,
      });
    },

    async put(artifact, storage = native) {
      const repo = get().repo ?? artifact.identity.repo;
      const artifacts = {
        ...get().artifacts,
        [artifact.artifactKey]: artifact,
      };
      set({ repo, loaded: true, artifacts });
      await persist(repo, artifacts, storage);
    },

    async update(artifactKey, updater, storage = native) {
      const current = get().artifacts[artifactKey];
      const repo = get().repo;
      if (!current || !repo) {
        throw new Error(
          `Cannot update missing UltraReview artifact ${artifactKey}`,
        );
      }
      const updated = updater(current);
      if (updated.artifactKey !== artifactKey) {
        throw new Error("UltraReview updates cannot change artifact identity");
      }
      const artifacts = {
        ...get().artifacts,
        [artifactKey]: updated,
      };
      set({ artifacts });
      await persist(repo, artifacts, storage);
    },
  }),
);

export function findUltraReviewArtifact(
  identity: UltraReviewArtifactIdentity,
): UltraReviewArtifact | null {
  const key = ultraReviewArtifactKey(identity);
  return useUltraReviewStore.getState().artifacts[key] ?? null;
}

export function useUltraReviewGenerationStatus(
  identity: UltraReviewArtifactIdentity,
): UltraReviewGenerationStatus | null {
  const key = ultraReviewArtifactKey(identity);
  return useUltraReviewStore(
    (state) => state.artifacts[key]?.generation.status ?? null,
  );
}

export async function reconcileInterruptedUltraReviews(
  repo: string,
  storage: UltraReviewBlobStorage = native,
): Promise<number> {
  const state = useUltraReviewStore.getState();
  if (!state.loaded || state.repo !== repo) return 0;

  const agentState = useAgentStore.getState();
  const runs = agentState.order
    .map((runId) => agentState.runs[runId])
    .filter((run) => run !== undefined);
  let recoveredCount = 0;

  for (const artifact of Object.values(state.artifacts)) {
    const recovered = recoverInterruptedUltraReviewArtifact(
      artifact,
      runs,
    );
    if (recovered === artifact) continue;
    if (useUltraReviewStore.getState().repo !== repo) break;

    await useUltraReviewStore.getState().update(
      artifact.artifactKey,
      (current) =>
        recoverInterruptedUltraReviewArtifact(current, runs),
      storage,
    );
    recoveredCount += 1;
  }

  return recoveredCount;
}
