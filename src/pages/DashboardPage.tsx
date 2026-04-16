import { useRequireAuth } from '../hooks/useAuth';
import { useResources } from '../hooks/useResources';
import { ResourceCard } from '../components/ResourceCard/ResourceCard';
import { UpgradeBanner } from '../components/UpgradeBanner/UpgradeBanner';
import styles from './DashboardPage.module.css';

export function DashboardPage() {
  const { user, isLoading: authLoading } = useRequireAuth();
  const { data: resources, isLoading: resourcesLoading, error, refetch } = useResources();

  if (authLoading) {
    return <div className={styles.center} aria-live="polite">Authenticating…</div>;
  }

  return (
    <div className={styles.page} data-testid="dashboard-page">
      <header className={styles.pageHeader}>
        <h1 className={styles.title}>Resources</h1>
        <button
          className={styles.refreshBtn}
          onClick={() => void refetch()}
          disabled={resourcesLoading}
          aria-label="Refresh resources"
        >
          {resourcesLoading ? '↻' : '↻ Refresh'}
        </button>
      </header>

      {user && (user.tier === 'anonymous' || user.tier === 'hobby') && (
        <UpgradeBanner tier={user.tier} />
      )}

      {resourcesLoading && (
        <div className={styles.center} aria-live="polite" data-testid="resources-loading">
          Loading resources…
        </div>
      )}

      {error && (
        <div className={styles.errorState} role="alert" data-testid="resources-error">
          <span className={styles.errorIcon}>⚠</span>
          <p>Failed to load resources: {error.message}</p>
          <button className={styles.retryBtn} onClick={() => void refetch()}>
            Retry
          </button>
        </div>
      )}

      {!resourcesLoading && !error && resources && resources.length === 0 && (
        <div className={styles.emptyState} data-testid="empty-state">
          <span className={styles.emptyIcon}>🌱</span>
          <h2 className={styles.emptyTitle}>No resources yet</h2>
          <p className={styles.emptyBody}>
            Use the instant.dev API to provision your first Postgres, Redis, or MongoDB instance.
          </p>
          <pre className={styles.emptyCode}>
            curl -X POST https://api.instant.dev/db/new
          </pre>
        </div>
      )}

      {!resourcesLoading && resources && resources.length > 0 && (
        <div className={styles.grid} data-testid="resource-grid">
          {resources.map((resource) => (
            <ResourceCard key={resource.id} resource={resource} />
          ))}
        </div>
      )}
    </div>
  );
}
