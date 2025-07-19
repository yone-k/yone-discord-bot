export enum CommandErrorType {
  NOT_FOUND = 'NOT_FOUND',
  EXECUTION_FAILED = 'EXECUTION_FAILED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  INVALID_PARAMETERS = 'INVALID_PARAMETERS',
  TIMEOUT = 'TIMEOUT',
  RATE_LIMITED = 'RATE_LIMITED'
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
    case CommandErrorType.RATE_LIMITED:
      return 'レート制限により、しばらく時間を置いてから再試行してください。';
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