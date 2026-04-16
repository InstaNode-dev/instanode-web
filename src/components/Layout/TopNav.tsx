import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import styles from './TopNav.module.css';

export function TopNav() {
  const { user, logout, isLoggingOut } = useAuth();

  return (
    <header className={styles.topNav} data-testid="top-nav">
      <Link to="/dashboard" className={styles.logo}>
        <span className={styles.logoMark}>⚡</span>
        <span className={styles.logoText}>instant.dev</span>
      </Link>

      <div className={styles.right}>
        {user && (
          <>
            <span className={styles.email}>{user.email}</span>
            <button
              className={styles.logoutBtn}
              onClick={() => logout()}
              disabled={isLoggingOut}
              data-testid="logout-btn"
            >
              {isLoggingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </>
        )}
      </div>
    </header>
  );
}
