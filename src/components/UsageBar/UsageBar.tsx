import styles from './UsageBar.module.css';

interface UsageBarProps {
  used: number;   // bytes
  quota: number;  // bytes
  label?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function UsageBar({ used, quota, label = 'Storage' }: UsageBarProps) {
  const pct = Math.min(100, Math.round((used / quota) * 100));
  const isWarning = pct >= 80;
  const isCritical = pct >= 95;

  return (
    <div className={styles.container} data-testid="usage-bar">
      <div className={styles.header}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>
          {formatBytes(used)} / {formatBytes(quota)}
        </span>
      </div>
      <div className={styles.track} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={`${styles.fill} ${isWarning ? styles.warning : ''} ${isCritical ? styles.critical : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
