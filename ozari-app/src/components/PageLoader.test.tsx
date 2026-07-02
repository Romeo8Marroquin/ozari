import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PageLoader from './PageLoader';

describe('PageLoader', () => {
  it('renders the branded full-screen loader', () => {
    render(<PageLoader />);
    // The brand logo (labelled) is the anchor of the loader.
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'components.pageLoader.logo');
  });
});
