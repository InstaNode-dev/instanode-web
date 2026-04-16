import type { ResourceStatus, ResourceTier } from '../../types/resource';
import styles from './StatusBadge.module.css';

interface StatusBadgeProps {
  status: ResourceStatus;
  tier?: ResourceTier;
}

const STATUS_LABEL: Record<ResourceStatus, string> = {
  active: 'Active',
  deleted: 'Deleted',
  suspended: 'Suspended',
};

const TIER_LABEL: Record<ResourceTier, string> = {
  anonymous: 'Anonymous',
  hobby: 'Hobby',
  pro: 'Pro',
  team: 'Team',
};

export function StatusBadge({ status, tier }: StatusBadgeProps) {
  return (
    <span className={styles.wrapper}>
      <span className={`${styles.badge} ${styles[status]}`} data-testid={`status-badge-${status}`}>
        {STATUS_LABEL[status]}
      </span>
      {tier && (
        <span className={`${styles.badge} ${styles.tier} ${styles[`tier-${tier}`]}`} data-testid={`tier-badge-${tier}`}>
          {TIER_LABEL[tier]}
        </span>
      )}
    </span>
  );
}
