import { CoreClient, coreClient } from './CoreClient';
import type { Schema } from './contracts';
import { encodePathId as part } from './PathId';

export class OutputApi {
  constructor(private readonly providedClient?: CoreClient) {}
  private get client(): CoreClient { return this.providedClient ?? coreClient(); }
  status(): Promise<Schema['OutputStatus']> { return this.client.request('GET', '/v1/outputs/status'); }
  job(id: string): Promise<Schema['OutputJob']> { return this.client.request('GET', `/v1/outputs/jobs/${part(id)}`); }
  deleteAll(channelId: string): Promise<Schema['OutputJob']> { return this.client.request('POST', `/v1/outputs/delete-all/${part(channelId)}`); }
  initialize(channelId: string, input: Schema['OutputInitializeInput']): Promise<Schema['OutputAccepted']> { return this.client.request('POST', `/v1/outputs/initialize/${part(channelId)}`, input); }
  redraw(channelId: string, kind: Schema['OutputRedrawInput']['kind']): Promise<Schema['OutputAccepted']> { return this.client.request('POST', `/v1/outputs/redraw/${part(channelId)}`, { kind }); }
  setCardView(channelId: string, kind: Schema['OutputTargetKind'], targetId: string, input: Schema['OutputCardViewInput']): Promise<Schema['OutputCardView']> {
    return this.client.request('POST', `/v1/outputs/card-view/${part(channelId)}/${kind}/${part(targetId)}`, input);
  }
  recordEvent(event: Schema['OutputLogEvent']): Promise<Schema['OutputAccepted']> { return this.client.request('POST', '/v1/outputs/operation-log-events', event); }
}
