import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

const attachmentBucket = "report-attachments";

export type StorageCleanupResult = {
  pending: boolean;
  objectCount: number;
};

function uniquePaths(paths: string[]) {
  return [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
}

async function updateCleanupJobs(
  paths: string[],
  changes: Record<string, unknown>
) {
  if (!paths.length) return;
  const { error } = await createAdminClient()
    .from("storage_cleanup_jobs")
    .update(changes)
    .eq("bucket", attachmentBucket)
    .in("object_path", paths);
  if (error) {
    console.warn("Could not update attachment cleanup jobs.", error.message);
  }
}

export async function removeQueuedAttachmentObjects(
  paths: string[]
): Promise<StorageCleanupResult> {
  const objectPaths = uniquePaths(paths);
  if (!objectPaths.length) return { pending: false, objectCount: 0 };

  const attemptedAt = new Date().toISOString();
  const { error } = await createAdminClient().storage
    .from(attachmentBucket)
    .remove(objectPaths);

  if (error) {
    await updateCleanupJobs(objectPaths, {
      status: "pending",
      last_attempt_at: attemptedAt,
      last_error: error.message.slice(0, 500),
    });
    return { pending: true, objectCount: objectPaths.length };
  }

  await updateCleanupJobs(objectPaths, {
    status: "completed",
    completed_at: attemptedAt,
    last_attempt_at: attemptedAt,
    last_error: null,
  });
  return { pending: false, objectCount: objectPaths.length };
}

export async function drainAttachmentCleanupQueue(limit = 50) {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const { data, error } = await createAdminClient()
    .from("storage_cleanup_jobs")
    .select("object_path")
    .eq("bucket", attachmentBucket)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(safeLimit);
  if (error) throw new Error(`Could not load attachment cleanup jobs: ${error.message}`);
  return removeQueuedAttachmentObjects((data ?? []).map((job) => job.object_path));
}
