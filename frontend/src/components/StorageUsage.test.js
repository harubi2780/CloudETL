import { render, screen, within } from '@testing-library/react';
import StorageUsage, { formatStorageBytes } from './StorageUsage';

const MiB = 1024 * 1024;
const storage = { limit_bytes: 10 * MiB, used_bytes: 2 * MiB, uploaded_bytes: MiB,
  result_bytes: MiB * .75, pending_cleanup_bytes: MiB * .25, reserved_bytes: MiB,
  available_bytes: 7 * MiB, over_limit: false };

test('shows server-used and available bytes while the meter includes reserved work', () => {
  render(<StorageUsage storage={storage} />);
  const usage = screen.getByRole('region', { name: 'Storage usage' });
  expect(within(usage).getByText('2 MiB of 10 MiB used')).toBeInTheDocument();
  expect(within(usage).getByText('7 MiB available')).toBeInTheDocument();
  expect(within(usage).getByText('1 MiB reserved for work in progress')).toBeInTheDocument();
  const meter = within(usage).getByRole('meter', { name: 'Used and reserved storage' });
  expect(meter).toHaveAttribute('value', String(3 * MiB));
  expect(meter).toHaveAttribute('max', String(10 * MiB));
  expect(meter).toHaveAttribute('aria-valuetext', '2 MiB used, 1 MiB reserved, 7 MiB available out of 10 MiB');
});

test('keeps authoritative available capacity rather than recomputing it from a display estimate', () => {
  render(<StorageUsage storage={{ ...storage, available_bytes: 123 }} compact />);
  expect(screen.getByText('123 B available')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Storage usage' })).toHaveClass('storage-usage-compact');
});

test('reports exceeded capacity truthfully and clamps the visual meter at the quota', () => {
  render(<StorageUsage storage={{ ...storage, used_bytes: 12 * MiB, available_bytes: 0, over_limit: true }} />);
  expect(screen.getByText('12 MiB of 10 MiB used')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Storage limit exceeded.');
  expect(screen.getByRole('meter')).toHaveAttribute('value', String(10 * MiB));
});

test('a full allowance and zero-byte capacity never create a negative or invalid meter', () => {
  render(<StorageUsage storage={{ ...storage, limit_bytes: 0, used_bytes: 0, reserved_bytes: 0, available_bytes: 0 }} />);
  expect(screen.getByText('0 B of 0 B used')).toBeInTheDocument();
  expect(screen.getByText('Storage is full. Remove unneeded files or results to free space.')).toBeInTheDocument();
  expect(screen.getByRole('meter')).toHaveAttribute('max', '1');
  expect(screen.getByRole('meter')).toHaveAttribute('value', '0');
});

test('labels stale and refreshing snapshots without inventing a current usage', () => {
  const { rerender } = render(<StorageUsage storage={storage} stale />);
  expect(screen.getByText('Last loaded usage. Refresh datasets to update.')).toBeInTheDocument();
  rerender(<StorageUsage storage={storage} stale refreshing />);
  expect(screen.getByText('Updating storage usage…')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Storage usage' })).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByText('Last loaded usage. Refresh datasets to update.')).not.toBeInTheDocument();
});

test('older responses without storage stay compatible and malformed numeric data is omitted', () => {
  const { rerender } = render(<StorageUsage />);
  expect(screen.queryByRole('region', { name: 'Storage usage' })).not.toBeInTheDocument();
  rerender(<StorageUsage storage={{ ...storage, used_bytes: NaN }} />);
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
});

test('formats byte limits using their actual binary unit without rounding to invented totals', () => {
  expect(formatStorageBytes(0)).toBe('0 B');
  expect(formatStorageBytes(400)).toBe('400 B');
  expect(formatStorageBytes(1024)).toBe('1 KiB');
  expect(formatStorageBytes(1.5 * MiB)).toBe('1.5 MiB');
  expect(formatStorageBytes(1024 * MiB)).toBe('1 GiB');
});
