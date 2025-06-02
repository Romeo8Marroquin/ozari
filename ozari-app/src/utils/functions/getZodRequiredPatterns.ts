import {
  ZodOptional,
  ZodDefault,
  ZodEffects,
  ZodIntersection,
  ZodArray,
  ZodObject,
  type ZodTypeAny,
  type ZodRawShape,
} from 'zod';

function unwrapSchema(schema: ZodTypeAny): {
  schema: ZodTypeAny;
  isOptional: boolean;
} {
  let isOptional = false;
  let current: ZodTypeAny = schema;
  let again = true;

  while (again) {
    again = false;

    if (current instanceof ZodOptional || current instanceof ZodDefault) {
      isOptional = true;
      current = (current as ZodOptional<ZodTypeAny> | ZodDefault<ZodTypeAny>)._def.innerType;
      again = true;
      continue;
    }

    if (current instanceof ZodEffects) {
      current = current._def.schema;
      again = true;
    }
  }

  return { schema: current, isOptional };
}

function getZodRequiredPatterns(schema: ZodTypeAny, prefix = ''): RegExp[] {
  const { schema: unwrapped, isOptional } = unwrapSchema(schema);

  if (unwrapped instanceof ZodIntersection) {
    return [
      ...getZodRequiredPatterns(unwrapped._def.left, prefix),
      ...getZodRequiredPatterns(unwrapped._def.right, prefix),
    ];
  }

  if (unwrapped instanceof ZodArray) {
    const elementType = unwrapped._def.type;
    const children = getZodRequiredPatterns(elementType, `${prefix}\\.\\d+`);
    const patterns: RegExp[] = [];
    if (prefix && !isOptional) {
      patterns.push(new RegExp(`^${prefix}$`));
    }
    return [...patterns, ...children];
  }

  if (unwrapped instanceof ZodObject) {
    const shapeDef = unwrapped._def.shape;
    const shape: ZodRawShape = typeof shapeDef === 'function' ? shapeDef() : shapeDef;

    return Object.entries(shape).flatMap(([key, childSchema]) => {
      const path = prefix ? `${prefix}\\.${key}` : key;
      return getZodRequiredPatterns(childSchema, path);
    });
  }

  if (prefix && !isOptional) {
    return [new RegExp(`^${prefix}$`)];
  }

  return [];
}

export default getZodRequiredPatterns;
