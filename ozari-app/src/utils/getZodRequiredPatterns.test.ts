import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import getZodRequiredPatterns from './getZodRequiredPatterns';

const requires = (patterns: RegExp[], field: string): boolean =>
  patterns.some((p) => p.test(field));

describe('getZodRequiredPatterns', () => {
  it('marks non-optional fields required and skips optional/default ones', () => {
    const schema = z.object({
      a: z.string(),
      b: z.string().optional(),
      c: z.string().default('x'),
    });
    const patterns = getZodRequiredPatterns(schema);

    expect(requires(patterns, 'a')).toBe(true);
    expect(requires(patterns, 'b')).toBe(false);
    expect(requires(patterns, 'c')).toBe(false);
  });

  it('recurses into nested objects', () => {
    const schema = z.object({
      user: z.object({ name: z.string(), nickname: z.string().optional() }),
    });
    const patterns = getZodRequiredPatterns(schema);

    expect(requires(patterns, 'user.name')).toBe(true);
    expect(requires(patterns, 'user.nickname')).toBe(false);
  });

  it('anchors each pattern to the exact field path (no partial matches)', () => {
    const patterns = getZodRequiredPatterns(z.object({ name: z.string() }));
    expect(requires(patterns, 'name')).toBe(true);
    expect(requires(patterns, 'username')).toBe(false);
    expect(requires(patterns, 'name.first')).toBe(false);
  });

  it('recurses into intersections', () => {
    const schema = z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() }));
    const patterns = getZodRequiredPatterns(schema);
    expect(requires(patterns, 'a')).toBe(true);
    expect(requires(patterns, 'b')).toBe(true);
  });

  it('recurses into a required array of objects (array + element are required)', () => {
    const patterns = getZodRequiredPatterns(z.object({ items: z.array(z.object({ name: z.string() })) }));
    expect(requires(patterns, 'items')).toBe(true);
    expect(requires(patterns, 'items.0.name')).toBe(true);
  });

  it('does not mark an optional array as required', () => {
    const patterns = getZodRequiredPatterns(z.object({ tags: z.array(z.string()).optional() }));
    expect(requires(patterns, 'tags')).toBe(false);
  });
});
