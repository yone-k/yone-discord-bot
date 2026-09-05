export class DatabaseLifecycle {
  public displaysReady = false;
  constructor(private readonly verifyDatabase: () => Promise<void>) {}

  async connect(login: () => Promise<unknown>): Promise<void> {
    await this.verifyDatabase();
    await login();
  }

  async health(discordReady: boolean): Promise<{
    statusCode: number; ready: boolean; database: { ready: boolean; schema: string }
  }> {
    try {
      await this.verifyDatabase();
      const ready = discordReady && this.displaysReady;
      return { statusCode: ready ? 200 : 503, ready, database: { ready: true, schema: 'current' } };
    } catch {
      return { statusCode: 503, ready: false, database: { ready: false, schema: 'unavailable' } };
    }
  }
}
