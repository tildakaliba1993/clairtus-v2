import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge (toolchain smoke + styling)', () => {
  it('renders the status label', () => {
    render(<StatusBadge status="FUNDED" />);
    expect(screen.getByText('FUNDED')).toBeTruthy();
  });

  it('applies a status-specific style and falls back for unknown', () => {
    const { rerender } = render(<StatusBadge status="RELEASED" />);
    expect(screen.getByText('RELEASED').className).toContain('emerald');
    rerender(<StatusBadge status="weird-status" />);
    expect(screen.getByText('weird-status').className).toContain('slate');
  });
});
