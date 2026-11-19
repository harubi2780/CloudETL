import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import CheckoutDialog from './CheckoutDialog';

const order = { id: '10000000-0000-0000-0000-000000000001', plan_name: 'Premium', amount_vnd: 59000,
  period_days: 30, expires_at: '2026-11-19T10:15:00Z' };

function CheckoutHarness() {
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={() => setOpen(true)}>Open checkout</button>
    {open && <CheckoutDialog order={order} onClose={() => setOpen(false)} />}
  </>;
}

test('checkout traps keyboard focus, makes the background inert, and restores the opener', async () => {
  render(<CheckoutHarness />);
  const opener = screen.getByRole('button', { name: 'Open checkout' });
  const appRoot = opener.parentElement;
  opener.focus();
  fireEvent.click(opener);

  const dialog = await screen.findByRole('dialog', { name: 'Review your upgrade' });
  expect(within(dialog).getByRole('button', { name: 'Confirm upgrade' })).toHaveFocus();
  expect(appRoot).toHaveAttribute('inert');
  expect(appRoot).toHaveAttribute('aria-hidden', 'true');

  const close = within(dialog).getByRole('button', { name: 'Close checkout' });
  const finalSummary = within(dialog).getByText('Order reference');
  finalSummary.focus();
  fireEvent.keyDown(finalSummary, { key: 'Tab' });
  expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(finalSummary).toHaveFocus();

  fireEvent.click(close);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(opener).toHaveFocus();
  expect(appRoot).not.toHaveAttribute('inert');
  expect(appRoot).not.toHaveAttribute('aria-hidden');
});

test('busy checkout cannot be cancelled with Escape or duplicate confirmation', () => {
  const onClose = jest.fn();
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  render(<CheckoutDialog order={order} busy onClose={onClose} onConfirm={onConfirm} onCancel={onCancel} />);

  const dialog = screen.getByRole('dialog', { name: 'Review your upgrade' });
  expect(within(dialog).getByRole('heading', { name: 'Review your upgrade' })).toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm upgrade' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel checkout' }));
  expect(onClose).not.toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
  expect(onCancel).not.toHaveBeenCalled();
});
