import {
  ZodOptional,
  ZodDefault,
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
      current = (current as ZodOptional<ZodTypeAny> | ZodDefault<ZodTypeAny>).unwrap();
      again = true;
    }
  }

  return { schema: current, isOptional };
}

function getZodRequiredPatterns(schema: ZodTypeAny, prefix = ''): RegExp[] {
  const { schema: unwrapped, isOptional } = unwrapSchema(schema);

  if (unwrapped instanceof ZodIntersection) {
    return [
      ...getZodRequiredPatterns(unwrapped.def.left as ZodTypeAny, prefix),
      ...getZodRequiredPatterns(unwrapped.def.right as ZodTypeAny, prefix),
    ];
  }

  if (unwrapped instanceof ZodArray) {
    const elementType = unwrapped.element;
    const children = getZodRequiredPatterns(elementType as ZodTypeAny, `${prefix}\\.\\d+`);
    const patterns: RegExp[] = [];
    if (prefix && !isOptional) {
      patterns.push(new RegExp(`^${prefix}$`));
    }
    return [...patterns, ...children];
  }

  if (unwrapped instanceof ZodObject) {
    const shape: ZodRawShape = unwrapped.shape;

    return Object.entries(shape).flatMap(([key, childSchema]) => {
      const path = prefix ? `${prefix}\\.${key}` : key;
      return getZodRequiredPatterns(childSchema as ZodTypeAny, path);
    });
  }

  if (prefix && !isOptional) {
    return [new RegExp(`^${prefix}$`)];
  }

  return [];
}

export default getZodRequiredPatterns;
