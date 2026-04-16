import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ResourceTier } from '../../types/resource';
import styles from './UpgradeBanner.module.css';

interface UpgradeBannerProps {
  tier: ResourceTier;
}

export function UpgradeBanner({ tier }: UpgradeBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || tier === 'pro' || tier === 'team') return null;

  const isAnonymous = tier === 'anonymous';

  return (
    <div className={styles.banner} data-testid="upgrade-banner">
      <div className={styles.content}>
        <span className={styles.icon}>{isAnonymous ? '⏱' : '🚀'}</span>
        <div className={styles.text}>
          <strong className={styles.title}>
            {isAnonymous
              ? 'Your resources expire in 24 hours'
              : 'Upgrade to Pro for more power'}
          </strong>
          <span className={styles.subtitle}>
            {isAnonymous
              ? 'Your claim link was shown when you provisioned — check your terminal for a URL containing /start?t=. You need that link; opening /claim without it will not work.'
              : 'Get 10 GB storage, priority support, and team features.'}
          </span>
        </div>
        <Link
          to="/settings?section=billing"
          className={styles.cta}
        >
          {isAnonymous ? 'Plan & billing' : 'Upgrade now'}
        </Link>
      </div>
      <button
        className={styles.dismiss}
        onClick={() => setDismissed(true)}
        aria-label="Dismiss banner"
      >
        ✕
      </button>
    </div>
  );
}
