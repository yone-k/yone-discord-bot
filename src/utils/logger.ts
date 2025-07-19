export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = LogLevel.INFO) {
    this.level = level;
  }

  private formatTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  private log(level: LogLevel, levelName: string, message: string, meta?: object): void {
    if (level >= this.level) {
      const timestamp = this.formatTimestamp();
      if (meta && Object.keys(meta).length > 0) {
        console.log(`[${timestamp}] [${levelName}] ${message}`, JSON.stringify(meta));
      } else {
        console.log(`[${timestamp}] [${levelName}] ${message}`);
      }
    }
  }

  debug(message: string, meta?: object): void {
    this.log(LogLevel.DEBUG, 'DEBUG', message, meta);
  }

  info(message: string, meta?: object): void {
    this.log(LogLevel.INFO, 'INFO', message, meta);
  }

  warn(message: string, meta?: object): void {
    this.log(LogLevel.WARN, 'WARN', message, meta);
  }

  error(message: string, meta?: object): void {
    this.log(LogLevel.ERROR, 'ERROR', message, meta);
  }
}