import { OutputApi } from '../api/OutputApi';
import { withApiDeadline } from '../api/CoreClient';

export async function deleteAllOutput(channelId: string, api: Pick<OutputApi, 'deleteAll' | 'job'> = new OutputApi()): Promise<string> {
  const deadline = Date.now() + 60_000;
  let progress = await withApiDeadline(60_000, () => api.deleteAll(channelId));
  let obtainedProgress = progress.firstAttemptFinished || progress.confirmedDeletedCount > 0;
  while (!progress.firstAttemptFinished) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(1000, remaining)));
    if (Date.now() >= deadline) break;
    try {
      progress = await withApiDeadline(deadline - Date.now(), () => api.job(progress.jobId));
      obtainedProgress = true;
    } catch (error) {
      if (!obtainedProgress) throw error;
      // The last server-confirmed count remains valid when progress is unavailable.
      break;
    }
  }
  if (!obtainedProgress) throw new Error('削除進捗を取得できませんでした');
  const count = progress.confirmedDeletedCount;
  return count === 0 ? '✅ 削除対象のメッセージはありませんでした。' : `✅ ${count}件のメッセージを削除しました。`;
}
