export class CoreLifecycle {
  public displaysReady = false;
  private initializing = false;
  private stopped = false;
  private retry?: ReturnType<typeof setTimeout>;
  constructor(private readonly verifyApi: () => Promise<void>) {}

  initializeDisplays(refresh: () => Promise<void>, startNotifications: () => void, reportFailure: (error: unknown) => void): void {
    if (this.initializing || this.stopped) return;
    this.initializing = true;
    const attempt = async (): Promise<void> => {
      try {
        await refresh();
      } catch (error) {
        if (this.stopped) return;
        reportFailure(error);
        this.retry = setTimeout(() => { void attempt(); }, 60_000);
        return;
      }
      if (this.stopped) return;
      startNotifications();
      this.displaysReady = true;
    };
    void attempt();
  }

  stop(): void {
    this.stopped = true;
    this.displaysReady = false;
    clearTimeout(this.retry);
  }

  async connect(login: () => Promise<unknown>): Promise<void> {
    await this.verifyApi();
    await login();
  }

  async health(discordReady: boolean): Promise<{
    statusCode: number; ready: boolean; api: { ready: boolean }
  }> {
    try {
      await this.verifyApi();
      const ready = discordReady && this.displaysReady;
      return { statusCode: ready ? 200 : 503, ready, api: { ready: true } };
    } catch {
      return { statusCode: 503, ready: false, api: { ready: false } };
    }
  }
}
