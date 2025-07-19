export interface ResponseTimeResult {
  message: string;
  responseTime: number;
}

/**
 * コマンド処理に関するドメインサービス
 * ビジネスロジックを集約し、インフラストラクチャ層への依存を排除します
 */
export class CommandService {
  /**
   * Pingコマンドのレスポンスメッセージを生成します
   * @param responseTime 応答時間（ミリ秒）
   * @returns レスポンスメッセージ
   */
  public generatePingResponse(responseTime: number): string {
    return `Pong! ${responseTime}ms`;
  }
  
  /**
   * 応答時間を測定してレスポンスを生成します
   * @returns 応答時間付きのレスポンス結果
   */
  public async generatePingResponseWithTiming(): Promise<ResponseTimeResult> {
    const startTime = Date.now();
    
    // 微妙な遅延を追加して現実的な応答時間を測定
    await new Promise(resolve => setTimeout(resolve, 1));
    
    const responseTime = Date.now() - startTime;
    const message = this.generatePingResponse(responseTime);
    
    return {
      message,
      responseTime
    };
  }
  
  /**
   * コマンドの基本的な妥当性検証を行います
   * @param commandName コマンド名
   * @returns 妥当性検証結果
   */
  public validateCommandName(commandName: string): boolean {
    return commandName && commandName.trim().length > 0;
  }
}