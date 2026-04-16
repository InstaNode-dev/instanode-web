import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { previewClaim, submitClaim } from '../api/claim';
import type { ClaimPreviewResponse } from '../api/claim';
import { RESOURCE_EMOJI, RESOURCE_LABEL } from '../types/resource';
import { StatusBadge } from '../components/StatusBadge/StatusBadge';
import styles from './ClaimPage.module.css';

export function ClaimPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();

  const claimToken = searchParams.get('t') ?? '';

  const [preview, setPreview] = useState<ClaimPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState(false);
  const [claimError, setClaimError] = useState('');

  useEffect(() => {
    if (!claimToken || authLoading) return;

    if (!isAuthenticated) {
      void navigate(`/login?redirect=/claim?t=${encodeURIComponent(claimToken)}`, { replace: true });
      return;
    }

    setIsPreviewLoading(true);
    previewClaim(claimToken)
      .then(setPreview)
      .catch((err: unknown) => {
        setPreviewError(err instanceof Error ? err.message : 'Invalid or expired claim token.');
      })
      .finally(() => setIsPreviewLoading(false));
  }, [claimToken, isAuthenticated, authLoading, navigate]);

  const handleClaim = async () => {
    if (!claimToken) return;
    setIsSubmitting(true);
    setClaimError('');
    try {
      await submitClaim(claimToken, user?.email ?? undefined);
      setClaimSuccess(true);
      setTimeout(() => void navigate('/dashboard'), 2000);
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : 'Claim failed. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading || isPreviewLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.center} aria-live="polite">Loading…</div>
      </div>
    );
  }

  if (!claimToken) {
    return (
      <div className={styles.page}>
        <div className={styles.card} data-testid="claim-page-no-token">
          <h1 className={styles.title}>Claim Resources</h1>
          <p className={styles.body}>
            No claim token found. Visit a provisioning URL with <code>?t=...</code> to claim resources.
          </p>
        </div>
      </div>
    );
  }

  if (previewError) {
    return (
      <div className={styles.page}>
        <div className={styles.card} data-testid="claim-page-error">
          <h1 className={styles.title}>Invalid Claim Token</h1>
          <p className={styles.errorText}>{previewError}</p>
        </div>
      </div>
    );
  }

  if (claimSuccess) {
    return (
      <div className={styles.page}>
        <div className={styles.card} data-testid="claim-success">
          <span className={styles.successIcon}>🎉</span>
          <h1 className={styles.title}>Resources claimed!</h1>
          <p className={styles.body}>Redirecting to your dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page} data-testid="claim-page">
      <div className={styles.card}>
        <h1 className={styles.title}>Claim your resources</h1>
        <p className={styles.body}>
          The following resources will be transferred to your account and will no longer expire.
        </p>

        {preview && (
          <ul className={styles.resourceList} data-testid="claim-resource-list">
            {preview.resources.map((resource) => (
              <li key={resource.id} className={styles.resourceItem} data-testid={`claim-resource-${resource.resource_type}`}>
                <span className={styles.resourceIcon}>
                  {RESOURCE_EMOJI[resource.resource_type]}
                </span>
                <div className={styles.resourceInfo}>
                  <span className={styles.resourceName}>
                    {resource.name ?? `Unnamed ${RESOURCE_LABEL[resource.resource_type]}`}
                  </span>
                  <span className={styles.resourceType}>{RESOURCE_LABEL[resource.resource_type]}</span>
                </div>
                <StatusBadge status={resource.status} />
              </li>
            ))}
          </ul>
        )}

        {claimError && (
          <p className={styles.errorText} role="alert">{claimError}</p>
        )}

        <div className={styles.actions}>
          <button
            className={styles.claimBtn}
            onClick={() => void handleClaim()}
            disabled={isSubmitting || !preview}
            data-testid="claim-submit-btn"
          >
            {isSubmitting ? 'Claiming…' : `Claim ${preview?.resources.length ?? ''} resource${preview?.resources.length !== 1 ? 's' : ''}`}
          </button>
          <button
            className={styles.cancelBtn}
            onClick={() => void navigate('/dashboard')}
            disabled={isSubmitting}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
