import { Logger } from '../utils/logger';
import { templates } from '../templates/embed/templates';

export class TemplateManager {
  private templateCache: Map<string, string> = new Map();
  private readonly logger: Logger;

  constructor() {
    this.logger = new Logger();
  }

  async loadTemplate(templateName: string): Promise<string> {
    const cacheKey = templateName;
    
    if (this.templateCache.has(cacheKey)) {
      this.logger.debug(`Template "${templateName}" loaded from cache`);
      return this.templateCache.get(cacheKey)!;
    }

    try {
      const templateContent = templates[templateName as keyof typeof templates];
      
      if (!templateContent) {
        throw new Error(`Template "${templateName}" not found`);
      }
      
      this.cacheTemplate(cacheKey, templateContent);
      this.logger.info(`Template "${templateName}" loaded and cached`);
      
      return templateContent;
    } catch (error) {
      this.logger.error(`Failed to load template "${templateName}"`, { error });
      throw new Error(`Template "${templateName}" not found`);
    }
  }

  renderTemplate(template: string, variables: Record<string, string>): string {
    let renderedContent = template;
    
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{${key}}`;
      renderedContent = renderedContent.replace(new RegExp(placeholder, 'g'), value);
    }
    
    this.logger.debug('Template rendered successfully', { 
      variableCount: Object.keys(variables).length 
    });
    
    return renderedContent;
  }

  private cacheTemplate(name: string, content: string): void {
    this.templateCache.set(name, content);
    this.logger.debug(`Template "${name}" cached`);
  }

  clearCache(): void {
    this.templateCache.clear();
    this.logger.info('Template cache cleared');
  }

  getCacheSize(): number {
    return this.templateCache.size;
  }
}