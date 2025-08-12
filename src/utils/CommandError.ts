export enum CommandErrorType {
  NOT_FOUND = 'NOT_FOUND', // コマンドが存在しない場合
  EXECUTION_FAILED = 'EXECUTION_FAILED', // コマンド実行中の一般的なエラー
  PERMISSION_DENIED = 'PERMISSION_DENIED', // Discord権限エラー
  INVALID_PARAMETERS = 'INVALID_PARAMETERS', // コマンド引数の形式エラー
  TIMEOUT = 'TIMEOUT', // コマンド実行タイムアウト
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE' // 外部サービス利用不可
}

export class CommandError extends Error {
  public readonly type: CommandErrorType;
  public readonly commandName: string;
  public readonly originalError?: Error;
  public readonly userMessage: string;

  constructor(
    type: CommandErrorType,
    commandName: string,
    message: string,
    userMessage?: string,
    originalError?: Error
  ) {
    super(message);
    this.name = 'CommandError';
    this.type = type;
    this.commandName = commandName;
    this.userMessage = userMessage || this.getDefaultUserMessage(type);
    this.originalError = originalError;
  }

  private getDefaultUserMessage(type: CommandErrorType): string {
    switch (type) {
    case CommandErrorType.NOT_FOUND:
      return 'そのコマンドは見つかりませんでした。';
    case CommandErrorType.EXECUTION_FAILED:
      return 'コマンドの実行中にエラーが発生しました。';
    case CommandErrorType.PERMISSION_DENIED:
      return 'そのコマンドを実行する権限がありません。';
    case CommandErrorType.INVALID_PARAMETERS:
      return 'コマンドのパラメータが正しくありません。';
    case CommandErrorType.TIMEOUT:
      return 'コマンドの実行がタイムアウトしました。';
    case CommandErrorType.SERVICE_UNAVAILABLE:
      return 'サービスが利用できません。しばらく時間を置いてから再試行してください。';
    default:
      return '予期しないエラーが発生しました。';
    }
  }

  public getErrorDetails(): object {
    return {
      type: this.type,
      commandName: this.commandName,
      message: this.message,
      userMessage: this.userMessage,
      originalError: this.originalError?.message,
      timestamp: new Date().toISOString()
    };
  }
}