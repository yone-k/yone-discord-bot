export class CoreLifecycle {
  private stopped = false;
  constructor(private readonly verifyApi: () => Promise<void>) {}

  stop(): void { this.stopped = true; }

  async connect(login: () => Promise<unknown>): Promise<void> {
    await this.verifyApi();
    await login();
  }

  async health(discordReady: boolean): Promise<{
    statusCode: number; ready: boolean; api: { ready: boolean }
  }> {
    try {
      await this.verifyApi();
      const ready = discordReady && !this.stopped;
      return { statusCode: ready ? 200 : 503, ready, api: { ready: true } };
    } catch {
      return { statusCode: 503, ready: false, api: { ready: false } };
    }
  }
}
