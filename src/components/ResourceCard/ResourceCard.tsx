import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { Resource } from '../../types/resource';
import { RESOURCE_EMOJI, RESOURCE_LABEL, STORAGE_QUOTA } from '../../types/resource';
import { StatusBadge } from '../StatusBadge/StatusBadge';
import { UsageBar } from '../UsageBar/UsageBar';
import { useDeleteResource, useRotateCredentials } from '../../hooks/useResources';
import styles from './ResourceCard.module.css';

interface ResourceCardProps {
  resource: Resource;
}

function formatCountdown(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m remaining`;
  return `${m}m remaining`;
}

export function ResourceCard({ resource }: ResourceCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rotatedUrl, setRotatedUrl] = useState<string | null>(null);

  const deleteMutation = useDeleteResource();
  const rotateMutation = useRotateCredentials();

  const displayName = resource.name ?? `Unnamed ${RESOURCE_LABEL[resource.resource_type]}`;
  const quota = STORAGE_QUOTA[resource.tier];

  const copyTarget = rotatedUrl ?? resource.connection_url ?? resource.token;
  const copyIsConnectionUrl = Boolean(rotatedUrl ?? resource.connection_url);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(copyTarget);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied — fallback
    }
  }, [copyTarget]);

  const handleRotate = useCallback(async () => {
    const result = await rotateMutation.mutateAsync(resource.token);
    setRotatedUrl(result.connection_url);
  }, [resource.token, rotateMutation]);

  const handleDelete = useCallback(() => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    deleteMutation.mutate(resource.token);
  }, [confirmDelete, resource.token, deleteMutation]);

  return (
    <article
      className={`${styles.card} ${resource.status === 'deleted' ? styles.deleted : ''}`}
      data-testid={`resource-card-${resource.resource_type}`}
      data-resource-id={resource.token}
    >
      <div className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.icon} aria-label={RESOURCE_LABEL[resource.resource_type]}>
            {RESOURCE_EMOJI[resource.resource_type]}
          </span>
          <div>
            <Link
              to={`/dashboard/resources/${resource.token}`}
              className={styles.name}
            >
              {displayName}
            </Link>
            {resource.cloud_vendor && (
              <p className={styles.meta}>
                {resource.cloud_vendor}
                {resource.country_code ? ` · ${resource.country_code.toUpperCase()}` : ''}
              </p>
            )}
          </div>
        </div>
        <StatusBadge status={resource.status} tier={resource.tier} />
      </div>

      {resource.expires_at && resource.status === 'active' && (
        <div className={styles.expiry} data-testid="expiry-countdown">
          ⏳ {formatCountdown(resource.expires_at)}
        </div>
      )}

      {resource.storage_bytes !== undefined && quota !== null && (
        <div className={styles.usage}>
          <UsageBar used={resource.storage_bytes} quota={quota} />
        </div>
      )}

      {resource.key_prefix && (
        <p className={styles.keyPrefix}>
          Prefix: <code>{resource.key_prefix}</code>
        </p>
      )}

      <div className={styles.actions}>
        <button
          className={`${styles.actionBtn} ${styles.copy}`}
          onClick={() => void handleCopy()}
          disabled={resource.status === 'deleted'}
          data-testid="copy-url-btn"
          aria-label={copyIsConnectionUrl ? 'Copy connection URL' : 'Copy resource token'}
        >
          {copied ? '✓ Copied' : copyIsConnectionUrl ? 'Copy URL' : 'Copy Token'}
        </button>

        {resource.resource_type === 'postgres' && resource.status === 'active' && (
          <button
            className={`${styles.actionBtn} ${styles.rotate}`}
            onClick={() => void handleRotate()}
            disabled={rotateMutation.isPending}
            data-testid="rotate-credentials-btn"
          >
            {rotateMutation.isPending ? 'Rotating…' : 'Rotate Credentials'}
          </button>
        )}

        {resource.status !== 'deleted' && (
          confirmDelete ? (
            <span className={styles.confirmRow}>
              <span className={styles.confirmText}>Sure?</span>
              <button
                className={`${styles.actionBtn} ${styles.deleteFinal}`}
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                data-testid="confirm-delete-btn"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                className={`${styles.actionBtn} ${styles.cancel}`}
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              className={`${styles.actionBtn} ${styles.delete}`}
              onClick={handleDelete}
              data-testid="delete-btn"
            >
              Delete
            </button>
          )
        )}
      </div>

      {rotateMutation.isSuccess && rotatedUrl && (
        <div className={styles.rotatedUrl} data-testid="rotated-url">
          <span className={styles.rotatedLabel}>New connection URL:</span>
          <code className={styles.rotatedCode}>{rotatedUrl}</code>
        </div>
      )}
    </article>
  );
}
