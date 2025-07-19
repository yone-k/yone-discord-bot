export interface ReplyOptions {
  content: string;
  ephemeral?: boolean;
}

export interface DiscordInteraction {
  reply(options: ReplyOptions): Promise<void>;
}

export class DiscordClient {
  async replyToInteraction(interaction: DiscordInteraction, options: ReplyOptions): Promise<void> {
    await interaction.reply({
      content: options.content,
      ephemeral: options.ephemeral || false
    });
  }
}