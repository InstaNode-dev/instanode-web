import { NavLink } from 'react-router-dom';
import styles from './Sidebar.module.css';

const NAV_ITEMS: { to: string; label: string; icon: string; badge?: string }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: '▦' },
  { to: '/billing', label: 'Billing', icon: '$' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
  { to: '/deploy', label: 'Deploy', icon: '🚀' },
];

export function Sidebar() {
  return (
    <aside className={styles.sidebar} data-testid="sidebar">
      <nav className={styles.nav} aria-label="Main navigation">
        <ul className={styles.list}>
          {NAV_ITEMS.map(({ to, label, icon, badge }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/dashboard'}
                className={({ isActive }) =>
                  `${styles.navLink} ${isActive ? styles.active : ''}`
                }
              >
                <span className={styles.navIcon}>{icon}</span>
                <span className={styles.navLabel}>{label}</span>
                {badge && <span className={styles.navBadge}>{badge}</span>}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
