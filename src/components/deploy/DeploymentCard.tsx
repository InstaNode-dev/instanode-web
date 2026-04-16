import { useState } from 'react';
import type { DashboardStack } from '../../api/stacks';
import { LogsModal } from './LogsModal';
import styles from './DeployComponents.module.css';

type Props = {
  stack: DashboardStack;
  onDelete: (slug: string) => Promise<void>;
  onRedeploy: (stack: DashboardStack) => void;
  busy?: boolean;
};

function badgeClass(status: string): string {
  switch (status) {
    case 'running':
      return styles.running;
    case 'failed':
      return styles.failed;
    case 'stopped':
      return styles.stopped;
    default:
      return styles.building;
  }
}

function formatCreated(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

export function DeploymentCard({ stack, onDelete, onRedeploy, busy }: Props) {
  const [logsOpen, setLogsOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const displayName = stack.name?.trim() || stack.slug;
  const canLogs = Boolean(stack.logs_service);
  const canRedeploy = stack.status === 'running' || stack.status === 'failed' || stack.status === 'stopped';

  const handleDelete = async () => {
    if (!window.confirm(`Delete deployment “${displayName}” (${stack.slug})? This cannot be undone.`)) {
      return;
    }
    setDeleting(true);
    try {
      await onDelete(stack.slug);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <article className={styles.card} data-testid={`deployment-card-${stack.slug}`}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardName}>{displayName}</h3>
          <span className={`${styles.badge} ${badgeClass(stack.status)}`} data-testid="deployment-status">
            <span className={styles.dot} aria-hidden />
            {stack.status === 'running'
              ? 'Running'
              : stack.status === 'failed'
                ? 'Failed'
                : stack.status === 'stopped'
                  ? 'Stopped'
                  : 'Building'}
          </span>
        </div>
        <p className={styles.meta}>Created: {formatCreated(stack.created_at)}</p>
        {stack.url ? (
          <p className={styles.url}>
            URL:{' '}
            <a href={stack.url} target="_blank" rel="noreferrer">
              {stack.url}
            </a>
          </p>
        ) : (
          <p className={styles.meta}>URL: not assigned yet</p>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={!canLogs || busy || deleting}
            onClick={() => setLogsOpen(true)}
            data-testid="deployment-logs-btn"
          >
            Logs
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={!canRedeploy || busy || deleting}
            onClick={() => onRedeploy(stack)}
            data-testid="deployment-redeploy-btn"
          >
            Redeploy
          </button>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.dangerBtn}`}
            disabled={busy || deleting}
            onClick={() => void handleDelete()}
            data-testid="deployment-delete-btn"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </article>
      {logsOpen && canLogs && stack.logs_service ? (
        <LogsModal slug={stack.slug} service={stack.logs_service} onClose={() => setLogsOpen(false)} />
      ) : null}
    </>
  );
}
