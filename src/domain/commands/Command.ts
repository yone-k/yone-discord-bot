export interface CommandData {
  name: string;
  description: string;
}

export interface CommandResponse {
  content: string;
  ephemeral: boolean;
}

export abstract class Command {
  public abstract readonly data: CommandData;
  
  /**
   * コマンドのドメインロジックを実行します
   * Discord固有の処理は含まず、純粋なビジネスロジックのみを扱います
   */
  public abstract execute(...args: any[]): Promise<CommandResponse>;
  
  /**
   * 応答時間を測定してコマンドを実行するヘルパーメソッド
   */
  protected async executeWithTiming<T>(
    operation: () => Promise<T>
  ): Promise<{ result: T; responseTime: number }> {
    const startTime = Date.now();
    
    // 微妙な遅延を追加して現実的な応答時間を測定
    await new Promise(resolve => setTimeout(resolve, 1));
    
    const result = await operation();
    const responseTime = Date.now() - startTime;
    
    return { result, responseTime };
  }
}