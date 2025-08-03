export class ConsoleMigrationHelper {
  static createMetadata(component: string, method: string, extra?: object | null): object {
    const baseMetadata = {
      component,
      method,
      timestamp: Date.now(),
    };

    if (extra === null || extra === undefined) {
      return baseMetadata;
    }

    return {
      ...baseMetadata,
      ...extra,
    };
  }
}