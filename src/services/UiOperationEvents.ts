import { hasOutputWrite, withInteractionOutput } from '../api/CoreClient';
import { OutputApi } from '../api/OutputApi';
import type { Schema } from '../api/contracts';
import type { OperationResult } from '../models/types/OperationLog';
import type { Logger } from '../utils/logger';

interface UiInteraction {
  id?: string;
  channelId?: string | null;
  user: { id: string };
}

export class UiOperationEvents {
  constructor(private readonly logger: Logger, private readonly outputs: Pick<OutputApi, 'recordEvent'> = new OutputApi()) {}

  async record(interaction: UiInteraction, operationKind: string, result: OperationResult): Promise<void> {
    if (!interaction.id || !interaction.channelId || hasOutputWrite()) return;
    try {
      await withInteractionOutput(interaction, operationKind, () => this.outputs.recordEvent({
        actorId: interaction.user.id, channelId: interaction.channelId!, interactionId: interaction.id!,
        operationKind: operationKind as Schema['OutputOperationKind'], occurredAt: new Date().toISOString(),
        success: result.success,
        ...(result.message ? { message: result.message } : {}),
        ...(result.details?.cancelReason ? { cancelReason: result.details.cancelReason } : {})
      }));
    } catch {
      this.logger.warn('Failed to record UI operation', { interactionId: interaction.id, operationKind });
    }
  }
}
