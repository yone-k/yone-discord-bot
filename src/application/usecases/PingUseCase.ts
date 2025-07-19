import { PingCommand } from '../../domain/commands/PingCommand.js';

export interface PingResult {
  message: string;
  responseTime: number;
}

/**
 * Pingコマンドのアプリケーションユースケース
 * ドメイン層のビジネスロジックを調整し、結果を返します
 */
export class PingUseCase {
  private pingCommand: PingCommand;

  constructor() {
    this.pingCommand = new PingCommand();
  }

  async execute(): Promise<PingResult> {
    const response = await this.pingCommand.execute();
    
    // ドメイン層のResponseから、アプリケーション層のPingResultに変換
    // 応答時間はドメイン層で既に計算されているため、メッセージから抽出
    const responseTimeMatch = response.content.match(/(\d+)ms/);
    const responseTime = responseTimeMatch ? parseInt(responseTimeMatch[1]) : 0;
    
    return {
      message: response.content,
      responseTime
    };
  }
}