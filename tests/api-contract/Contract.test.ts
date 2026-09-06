import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const spec = parse(readFileSync('api/generated/openapi.yaml', 'utf8'));

describe('public API contract', () => {
  it('keeps quantities and versions as strings and nullable dates explicit', () => {
    expect(spec.openapi).toBe('3.0.0');
    expect(spec.components.schemas.Quantity.type).toBe('string');
    expect(spec.components.schemas.Revision.type).toBe('string');
    expect(spec.components.schemas.ListEditItem.properties.until.nullable).toBe(true);
    expect(spec.components.schemas.StoredRemindTask.properties.lastDoneAt.nullable).toBe(true);
  });
  it('protects business operations but permits health without authentication', () => {
    expect(spec.paths['/health'].get.security).toEqual([{}]);
    expect(spec.security).toEqual([{ BearerAuth: [] }]);
    const ids = Object.values(spec.paths).flatMap((path: any) => Object.values(path).map((op: any) => op.operationId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['completeTask', 'applyInventory', 'pollNotifications', 'ackNotification', 'getInitialization', 'editTaskInventory']));
  });
  it('does not accept caller-calculated completion time or resulting stock', () => {
    expect(Object.keys(spec.components.schemas.CompleteTaskInput.properties).sort()).toEqual(['consumeOverrides', 'expectedRevision']);
    expect(Object.keys(spec.paths['/v1/reminders/{channelId}/tasks/{id}/complete'].post.responses)).toEqual(expect.arrayContaining(['400', '401', '404', '409', '422', '500', '503']));
  });
  it('requires identity for existing snapshots but allocates identity for new apply entries', () => {
    expect(spec.components.schemas.InventoryEditItem.required).toContain('id');
    expect(spec.components.schemas.ApplyInventoryItem.required).not.toContain('id');
    expect(spec.components.schemas.ApplyInventoryInput.properties.items.items.$ref).toBe('#/components/schemas/ApplyInventoryItem');
  });
  it('makes every business route authenticated and deadline aware', () => {
    for (const [path, value] of Object.entries(spec.paths)) {
      if (!path.startsWith('/v1/')) continue;
      for (const op of Object.values(value as Record<string, any>)) {
        expect(op.security, path).toBeUndefined();
        const parameters = op.parameters.map((parameter: any) => parameter.$ref ? spec.components.parameters[parameter.$ref.split('/').pop()] : parameter);
        expect(parameters, path).toEqual(expect.arrayContaining([expect.objectContaining({
          in: 'header', name: 'X-Core-Timeout-Ms', schema: expect.objectContaining({ minimum: 1, maximum: 5000 })
        })]));
        for (const parameter of parameters.filter((item: any) => item.in === 'path')) {
          expect(parameter.schema.$ref, `${path}: ${parameter.name}`).toBe('#/components/schemas/PathId');
        }
      }
    }
    expect(spec.components.securitySchemes.BearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
  });
  it('exposes readiness-only health and all stable error classifications', () => {
    expect(spec.paths['/health'].get.responses['503'].content['application/json'].schema.$ref).toBe('#/components/schemas/Health');
    expect(Object.keys(spec.components.schemas.Health.properties)).toEqual(['ready']);
    expect(spec.components.schemas.ApiError.properties.code.enum.sort()).toEqual(['conflict', 'internal', 'invalid_input', 'not_found', 'referenced', 'shortage', 'unauthorized', 'unavailable']);
  });
  it('preserves timestamp precision and rejects nondate deadline representations', () => {
    const schemas = spec.components.schemas;
    expect(new RegExp(schemas.Timestamp.pattern).test('2026-09-06T12:34:56.789+09:00')).toBe(true);
    expect(new RegExp(schemas.Timestamp.pattern).test('2026-09-06T12:34:56Z')).toBe(false);
    expect(new RegExp(schemas.BusinessDate.pattern).test('2026-09-06')).toBe(true);
    expect(new RegExp(schemas.BusinessTime.pattern).test('25:00')).toBe(false);
    expect(new RegExp(schemas.NotificationDeadline.pattern).test('tomorrow')).toBe(false);
    expect(schemas.StoredRemindTask.properties.nextDueAt.$ref).toBe('#/components/schemas/Timestamp');
    expect(schemas.NotificationToken.required.sort()).toEqual(['channelId', 'evaluatedAt', 'expectedRevision', 'id', 'kind', 'targetDueAt']);
  });
  it('publishes one progress plan and a read-only shortage check', () => {
    expect(spec.paths['/v1/display/progress']).toBeUndefined();
    expect(spec.paths['/v1/reminders/{channelId}/tasks/{id}/shortage-check'].get.operationId).toBe('checkTaskShortage');
    expect(spec.components.schemas.Initialization.required).toContain('remindChannels');
  });
  it('rejects floating-point schema regressions and declares numeric business boundaries', () => {
    const inspect = (value: any): void => {
      if (!value || typeof value !== 'object') return;
      expect(value.type).not.toBe('number');
      expect(['float', 'double']).not.toContain(value.format);
      for (const child of Object.values(value)) inspect(child);
    };
    inspect(spec.components.schemas);
    expect(spec.components.schemas.IntervalDays.minimum).toBe(1);
    expect(spec.components.schemas.ReminderMinutes).toMatchObject({ minimum: 0, maximum: 10080 });
    expect(spec.components.schemas.NonnegativeInteger.minimum).toBe(0);
  });
});
