import type { DashboardStack } from '../../api/stacks';
import { DeploymentCard } from './DeploymentCard';
import styles from './DeployComponents.module.css';

type Props = {
  stacks: DashboardStack[] | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  onDelete: (slug: string) => Promise<void>;
  onRedeploy: (stack: DashboardStack) => void;
  busy?: boolean;
};

export function DeploymentList({
  stacks,
  isLoading,
  error,
  onRetry,
  onDelete,
  onRedeploy,
  busy,
}: Props) {
  if (isLoading) {
    return (
      <div className={styles.center} data-testid="deployments-loading">
        Loading deployments…
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.errorBox} role="alert" data-testid="deployments-error">
        {error.message}
        <div style={{ marginTop: 12 }}>
          <button type="button" className={styles.actionBtn} onClick={() => void onRetry()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!stacks || stacks.length === 0) {
    return (
      <div className={styles.empty} data-testid="deployments-empty">
        Deploy your first app with{' '}
        <code>POST /stacks/new</code>
        <span className={styles.hint}>
          (multipart: <code>manifest</code> field with instant.yaml plus one tarball field per service)
        </span>
      </div>
    );
  }

  return (
    <div className={styles.grid} data-testid="deployments-list">
      {stacks.map((s) => (
        <DeploymentCard key={s.id} stack={s} onDelete={onDelete} onRedeploy={onRedeploy} busy={busy} />
      ))}
    </div>
  );
}
