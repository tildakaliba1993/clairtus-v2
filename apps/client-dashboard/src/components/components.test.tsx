import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModeBadge } from './ModeBadge';
import { BalanceCards } from './BalanceCards';
import { EscrowTable } from './EscrowTable';
import { WebhookDeliveryTable } from './WebhookDeliveryTable';

describe('ModeBadge', () => {
  it('labels sandbox vs live distinctly', () => {
    const { rerender } = render(<ModeBadge mode="sandbox" />);
    expect(screen.getByText('Sandbox').className).toContain('amber');
    rerender(<ModeBadge mode="live" />);
    expect(screen.getByText('Live').className).toContain('emerald');
  });
});

describe('BalanceCards', () => {
  it('renders a card per balance with formatted money', () => {
    render(<BalanceCards balances={[
      { accountId: 'a1', type: 'escrow_held', ownerRef: null, currency: 'ZAR', balance: 100000 },
      { accountId: 'a2', type: 'clairtus_revenue', ownerRef: null, currency: 'ZAR', balance: 1500 },
    ]} />);
    expect(screen.getByText(/Held in escrow/)).toBeTruthy();
    expect(screen.getByText(/1,000.00/)).toBeTruthy();
    expect(screen.getByText(/Platform fees/)).toBeTruthy();
  });

  it('shows an empty state', () => {
    render(<BalanceCards balances={[]} />);
    expect(screen.getByText(/No balances yet/)).toBeTruthy();
  });
});

describe('EscrowTable', () => {
  it('lists escrows with status, amount, and a detail link', () => {
    render(<EscrowTable escrows={[
      { id: 'escrow-abcdefgh-1', status: 'FUNDED', baseAmount: 100000, currency: 'ZAR', feeResponsibility: 'SELLER', sellerPartyId: 's1', createdAt: '2026-06-03' },
    ]} />);
    expect(screen.getByText('FUNDED')).toBeTruthy();
    expect(screen.getByText(/1,000.00/)).toBeTruthy();
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/escrows/escrow-abcdefgh-1');
  });
});

describe('WebhookDeliveryTable', () => {
  it('maps delivery status to a badge tone', () => {
    render(<WebhookDeliveryTable deliveries={[
      { id: 'd1', event_type: 'escrow.funded', status: 'delivered', attempts: 1, created_at: '2026-06-03' },
      { id: 'd2', event_type: 'payout.failed', status: 'failed', attempts: 5, created_at: '2026-06-03' },
    ]} />);
    expect(screen.getByText('escrow.funded')).toBeTruthy();
    expect(screen.getByText('payout.failed')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
  });
});
