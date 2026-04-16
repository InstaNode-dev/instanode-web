import { useParams, Link } from 'react-router-dom';
import { useRequireAuth } from '../hooks/useAuth';
import { useResource, useDeleteResource, useRotateCredentials } from '../hooks/useResources';
import { StatusBadge } from '../components/StatusBadge/StatusBadge';
import { UsageBar } from '../components/UsageBar/UsageBar';
import { RESOURCE_EMOJI, RESOURCE_LABEL, STORAGE_QUOTA } from '../types/resource';
import styles from './ResourceDetailPage.module.css';

/** Format bytes to human-readable size string */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function ResourceDetailPage() {
  useRequireAuth();
  const { id } = useParams<{ id: string }>();
  const { data: resource, isLoading, error } = useResource(id ?? '');
  const deleteMutation = useDeleteResource();
  const rotateMutation = useRotateCredentials();

  if (isLoading) {
    return (
      <div className={styles.center} aria-live="polite">Loading resource…</div>
    );
  }

  if (error || !resource) {
    return (
      <div className={styles.center} role="alert">
        <p className={styles.errorText}>
          {error ? error.message : 'Resource not found.'}
        </p>
        <Link to="/dashboard" className={styles.backLink}>← Back to dashboard</Link>
      </div>
    );
  }

  const quota = STORAGE_QUOTA[resource.tier];
  const hasUsage = resource.storage_bytes !== undefined && quota !== null;

  return (
    <div className={styles.page} data-testid="resource-detail-page">
      <div className={styles.breadcrumb}>
        <Link to="/dashboard" className={styles.backLink}>← Back to Dashboard</Link>
      </div>

      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.icon}>{RESOURCE_EMOJI[resource.resource_type]}</span>
          <div>
            <h1 className={styles.name}>
              {resource.name ?? `Unnamed ${RESOURCE_LABEL[resource.resource_type]}`}
            </h1>
            <p className={styles.id}>ID: <code>{resource.id}</code></p>
          </div>
        </div>
        <StatusBadge status={resource.status} tier={resource.tier} />
      </header>

      <div className={styles.metaGrid} data-testid="resource-meta">
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Type</span>
          <span className={styles.metaValue}>{RESOURCE_LABEL[resource.resource_type]}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Tier</span>
          <span className={styles.metaValue}>{resource.tier}</span>
        </div>
        {resource.cloud_vendor && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Cloud</span>
            <span className={styles.metaValue}>{resource.cloud_vendor}</span>
          </div>
        )}
        {resource.country_code && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Region</span>
            <span className={styles.metaValue}>{resource.country_code.toUpperCase()}</span>
          </div>
        )}
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Created</span>
          <span className={styles.metaValue}>
            {new Date(resource.created_at).toLocaleDateString()}
          </span>
        </div>
        {resource.expires_at && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Expires</span>
            <span className={`${styles.metaValue} ${styles.expiry}`}>
              {new Date(resource.expires_at).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {/* Storage usage for postgres / redis / mongodb */}
      {hasUsage && resource.storage_bytes !== undefined && quota !== null && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Storage Usage</h2>
          <UsageBar used={resource.storage_bytes} quota={quota} />
          <p className={styles.mutedText}>
            {formatBytes(resource.storage_bytes)} used of {formatBytes(quota)}
          </p>
        </section>
      )}

      {resource.key_prefix && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Redis Key Prefix</h2>
          <code className={styles.codeBlock}>{resource.key_prefix}</code>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Actions</h2>
        <div className={styles.actions}>
          {resource.resource_type === 'postgres' && resource.status === 'active' && (
            <button
              className={styles.rotateBtn}
              onClick={() => void rotateMutation.mutateAsync(resource.token)}
              disabled={rotateMutation.isPending}
              data-testid="rotate-credentials-btn"
            >
              {rotateMutation.isPending ? 'Rotating credentials…' : 'Rotate credentials'}
            </button>
          )}

          {resource.status !== 'deleted' && (
            <button
              className={styles.deleteBtn}
              onClick={() => {
                if (window.confirm(`Delete this ${RESOURCE_LABEL[resource.resource_type]}? This cannot be undone.`)) {
                  deleteMutation.mutate(resource.token);
                }
              }}
              disabled={deleteMutation.isPending}
              data-testid="delete-resource-btn"
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete resource'}
            </button>
          )}
        </div>

        {rotateMutation.isSuccess && rotateMutation.data && (
          <div className={styles.rotatedResult} data-testid="rotated-url">
            <strong>New connection URL:</strong>
            <code className={styles.codeBlock}>{rotateMutation.data.connection_url}</code>
          </div>
        )}
      </section>
    </div>
  );
}
