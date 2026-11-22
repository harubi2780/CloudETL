import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DateTimeFilterInput from './DateTimeFilterInput';

function Harness({ initialValue = '', disabled = false, onValueChange }) {
  const [value, setValue] = useState(initialValue);
  return (
    <div>
      <button type="button">Outside control</button>
      <DateTimeFilterInput
        label="Rule 1 comparison value"
        value={value}
        disabled={disabled}
        onChange={(next) => {
          setValue(next);
          onValueChange?.(next);
        }}
      />
      <span data-testid="dt-value">{value}</span>
    </div>
  );
}

test('opens portal calendar dialog on focus/trigger and clamps fixed coordinates to viewport', async () => {
  render(<Harness initialValue="2026-06-10" />);
  const input = screen.getByLabelText('Rule 1 comparison value');
  const trigger = screen.getByRole('button', { name: 'Open calendar' });
  expect(input).toHaveAttribute('placeholder', 'YYYY-MM-DD');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');

  jest.spyOn(input, 'getBoundingClientRect').mockReturnValue({
    left: 950,
    right: 1010,
    top: 710,
    bottom: 740,
    width: 60,
    height: 30,
  });

  await userEvent.click(input);
  const dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
  expect(dialog).toHaveClass('dt-picker-popover');
  expect(dialog.style.position).toBe('fixed');
  expect(dialog.style.zIndex).toBe('1000');
  expect(Number.parseInt(dialog.style.left, 10)).toBeLessThanOrEqual(1024 - 280 - 8);
  expect(Number.parseInt(dialog.style.top, 10)).toBeLessThan(710);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');

  // Day 10 is selected in June 2026
  expect(within(dialog).getByRole('button', { name: '10' })).toHaveAttribute('aria-pressed', 'true');
});

test('navigates months across year boundaries, selects a date, and supports Today and Clear', async () => {
  const onValueChange = jest.fn();
  render(<Harness initialValue="2026-01-05" onValueChange={onValueChange} />);

  await userEvent.click(screen.getByRole('button', { name: 'Open calendar' }));
  const dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
  expect(screen.getByText('January 2026')).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole('button', { name: 'Previous month' }));
  expect(screen.getByText('December 2025')).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole('button', { name: 'Next month' }));
  expect(screen.getByText('January 2026')).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole('button', { name: '20' }));
  expect(screen.getByTestId('dt-value')).toHaveTextContent('2026-01-20');
  expect(screen.queryByRole('dialog', { name: 'Choose date and time' })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Open calendar' }));
  const reopened = screen.getByRole('dialog', { name: 'Choose date and time' });
  await userEvent.click(within(reopened).getByRole('button', { name: 'Today' }));
  const now = new Date();
  const expectedToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  expect(screen.getByTestId('dt-value')).toHaveTextContent(expectedToday);
  expect(screen.queryByRole('dialog', { name: 'Choose date and time' })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Open calendar' }));
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Choose date and time' })).getByRole('button', { name: 'Clear' }));
  expect(screen.getByTestId('dt-value')).toHaveTextContent('');
  expect(screen.queryByRole('dialog', { name: 'Choose date and time' })).not.toBeInTheDocument();
});

test('supports optional time controls and keeps dialog open until Done', async () => {
  render(<Harness initialValue="2026-06-15" />);
  await userEvent.click(screen.getByRole('button', { name: 'Open calendar' }));
  const dialog = screen.getByRole('dialog', { name: 'Choose date and time' });

  await userEvent.click(within(dialog).getByLabelText('Include time'));
  expect(screen.getByTestId('dt-value')).toHaveTextContent('2026-06-15 00:00:00');
  expect(screen.getByRole('dialog', { name: 'Choose date and time' })).toBeInTheDocument();

  await userEvent.selectOptions(within(dialog).getByLabelText('Hour'), '14');
  await userEvent.selectOptions(within(dialog).getByLabelText('Minute'), '30');
  await userEvent.selectOptions(within(dialog).getByLabelText('Second'), '45');
  expect(screen.getByTestId('dt-value')).toHaveTextContent('2026-06-15 14:30:45');

  await userEvent.click(within(dialog).getByRole('button', { name: '18' }));
  expect(screen.getByTestId('dt-value')).toHaveTextContent('2026-06-18 14:30:45');
  expect(screen.getByRole('dialog', { name: 'Choose date and time' })).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('dialog', { name: 'Choose date and time' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Rule 1 comparison value')).toHaveFocus();
});

test('closes on Escape (restoring focus without reopening) and on outside click (without stealing focus)', async () => {
  render(<Harness initialValue="2026-06-15" />);
  const input = screen.getByLabelText('Rule 1 comparison value');
  const outside = screen.getByRole('button', { name: 'Outside control' });

  await userEvent.click(screen.getByRole('button', { name: 'Open calendar' }));
  const dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
  within(dialog).getByRole('button', { name: '15' }).focus();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Choose date and time' })).not.toBeInTheDocument();
  expect(input).toHaveFocus();

  await userEvent.click(input);
  expect(screen.getByRole('dialog', { name: 'Choose date and time' })).toBeInTheDocument();
  await userEvent.click(outside);
  expect(screen.queryByRole('dialog', { name: 'Choose date and time' })).not.toBeInTheDocument();
  expect(outside).toHaveFocus();
});

test('constrains invalid text while accepting valid dates, datetimes, and clearing', async () => {
  const onValueChange = jest.fn();
  render(<Harness onValueChange={onValueChange} />);
  const input = screen.getByLabelText('Rule 1 comparison value');

  await userEvent.type(input, 'not-a-date');
  expect(input).toHaveValue('');
  expect(onValueChange).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('Use the calendar or enter YYYY-MM-DD or YYYY-MM-DD HH:mm:ss.');

  fireEvent.change(input, { target: { value: '2026-02-30' } });
  expect(input).toHaveValue('');
  expect(onValueChange).not.toHaveBeenCalled();

  fireEvent.change(input, { target: { value: '2026-06-15' } });
  expect(input).toHaveValue('2026-06-15');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();

  fireEvent.change(input, { target: { value: '2026-06-15 14:30' } });
  expect(input).toHaveValue('2026-06-15 14:30');

  fireEvent.change(input, { target: { value: '2026-06-15T14:30:45' } });
  expect(input).toHaveValue('2026-06-15T14:30:45');

  await userEvent.clear(input);
  expect(input).toHaveValue('');
});

test('auto-closes and disables controls when disabled becomes true', async () => {
  const { rerender } = render(<Harness initialValue="2026-06-15" disabled={false} />);
  await userEvent.click(screen.getByRole('button', { name: 'Open calendar' }));
  expect(screen.getByRole('dialog', { name: 'Choose date and time' })).toBeInTheDocument();

  rerender(<Harness initialValue="2026-06-15" disabled />);
  expect(screen.queryByRole('dialog', { name: 'Choose date and time' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Rule 1 comparison value')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Open calendar' })).toBeDisabled();
});

test('clamps Previous month navigation at year 0001 and clears rejected notice when value changes', async () => {
  const { rerender } = render(
    <DateTimeFilterInput label="Rule 1 comparison value" value="0001-01-10" onChange={jest.fn()} />,
  );

  await userEvent.click(screen.getByRole('button', { name: 'Open calendar' }));
  const dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
  expect(within(dialog).getByText('January 1')).toBeInTheDocument();
  const prevBtn = within(dialog).getByRole('button', { name: 'Previous month' });
  expect(prevBtn).toBeDisabled();

  await userEvent.click(within(dialog).getByRole('button', { name: 'Next month' }));
  expect(within(dialog).getByText('February 1')).toBeInTheDocument();
  expect(prevBtn).toBeEnabled();

  await userEvent.click(prevBtn);
  expect(within(dialog).getByText('January 1')).toBeInTheDocument();
  expect(prevBtn).toBeDisabled();

  await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));

  const input = screen.getByLabelText('Rule 1 comparison value');
  await userEvent.type(input, 'bad');
  expect(screen.getByRole('status')).toHaveTextContent('Use the calendar or enter YYYY-MM-DD or YYYY-MM-DD HH:mm:ss.');

  rerender(<DateTimeFilterInput label="Rule 1 comparison value" value="2026-12-31" onChange={jest.fn()} />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
