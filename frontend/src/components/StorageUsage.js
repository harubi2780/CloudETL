import './StorageUsage.css';

export function formatStorageBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024))));
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: index === 0 ? 0 : 1 }).format(bytes / (1024 ** index))} ${units[index]}`;
}

export default function StorageUsage({ storage, compact = false, stale = false, refreshing = false }) {
  if (!storage || !['limit_bytes', 'used_bytes', 'reserved_bytes', 'available_bytes'].every((field) => (
    Number.isFinite(storage[field]) && storage[field] >= 0
  ))) return null;
  const used = storage.used_bytes;
  const reserved = storage.reserved_bytes;
  const limit = storage.limit_bytes;
  const available = storage.available_bytes;
  const exceeded = storage.over_limit;
  const allocated = Math.min(limit, used + reserved);
  return <section className={`storage-usage${compact ? ' storage-usage-compact' : ''}${exceeded ? ' storage-usage-exceeded' : ''}`} aria-label="Storage usage" aria-busy={refreshing}>
    <div className="storage-usage-heading"><strong>Storage</strong><span>{formatStorageBytes(used)} of {formatStorageBytes(limit)} used</span></div>
    <meter className="storage-usage-meter" min={0} max={Math.max(1, limit)} value={allocated} aria-label="Used and reserved storage"
      aria-valuetext={`${formatStorageBytes(used)} used, ${formatStorageBytes(reserved)} reserved, ${formatStorageBytes(available)} available out of ${formatStorageBytes(limit)}`} />
    <div className="storage-usage-footer"><span>{formatStorageBytes(available)} available</span>{reserved > 0 && <span>{formatStorageBytes(reserved)} reserved for work in progress</span>}</div>
    {exceeded ? <p className="storage-usage-warning" role="alert">Storage limit exceeded. Remove unneeded files or results to free space.</p>
      : available === 0 && <p className="storage-usage-warning">Storage is full. Remove unneeded files or results to free space.</p>}
    {refreshing && <p className="storage-usage-note">Updating storage usage…</p>}
    {stale && !refreshing && <p className="storage-usage-note">Last loaded usage. Refresh datasets to update.</p>}
  </section>;
}
