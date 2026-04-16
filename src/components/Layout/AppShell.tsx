import type { ReactNode } from 'react';
import { TopNav } from './TopNav';
import { Sidebar } from './Sidebar';
import styles from './AppShell.module.css';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className={styles.root}>
      <TopNav />
      <div className={styles.body}>
        <Sidebar />
        <main className={styles.main} id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
