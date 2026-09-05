interface DisplayGroup {
  list(): Promise<{ channelId: string }[]>;
  render(channel: { channelId: string }): Promise<void>;
}

export async function refreshStoredDisplays(groups: DisplayGroup[]): Promise<{ channelId: string; message: string }[]> {
  const failures: { channelId: string; message: string }[] = [];
  for (const group of groups) {
    for (const channel of await group.list()) {
      try { await group.render(channel); }
      catch (error) { failures.push({ channelId: channel.channelId, message: error instanceof Error ? error.message : '表示更新に失敗しました' }); }
    }
  }
  return failures;
}
