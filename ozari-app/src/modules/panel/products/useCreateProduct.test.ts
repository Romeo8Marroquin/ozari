import { renderHook, waitFor } from '@testing-library/react';
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@api/client', () => ({ api: { post } }));

import { createQueryWrapper } from '../../../test/queryWrapper';
import type { CreateProductBody } from './SchemaCreateProduct';
import { useCreateProduct } from './useCreateProduct';

const body: CreateProductBody = {
  name: 'Mesa redonda',
  businessTypeId: 1,
  categoryId: 1,
  currencyId: 1,
  quantity: 40,
  rentPrice: 75,
  rentTimeUnitId: 2,
  productDetails: [],
};

beforeEach(() => vi.clearAllMocks());

describe('useCreateProduct', () => {
  it('posts the body with the form owning its errors (skipErrorNotification)', async () => {
    post.mockResolvedValue({ data: { data: { id: 7 } } });
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useCreateProduct(), { wrapper: createQueryWrapper() });

    act(() => result.current.createProduct(body, { onSuccess }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/products', body, { skipErrorNotification: true });
  });

  it('propagates a failure to the caller (no retry)', async () => {
    post.mockRejectedValue(new Error('nope'));
    const onError = vi.fn();
    const { result } = renderHook(() => useCreateProduct(), { wrapper: createQueryWrapper() });

    act(() => result.current.createProduct(body, { onError }));

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(post).toHaveBeenCalledTimes(1);
  });
});
