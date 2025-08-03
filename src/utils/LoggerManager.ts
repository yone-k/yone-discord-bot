import { Logger } from './logger';

export class LoggerManager {
  private static instances = new Map<string, Logger>();
  
  static getLogger(component: string): Logger {
    if (!this.instances.has(component)) {
      this.instances.set(component, new Logger());
    }
    return this.instances.get(component)!;
  }
}