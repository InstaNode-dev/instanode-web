import styles from './MemberList.module.css';

export interface MemberRow {
  id: string;
  email: string;
  role: string;
}

interface MemberListProps {
  members: MemberRow[];
  currentUserId: string;
  isOwner: boolean;
  onRemove: (userId: string) => void;
  onLeave: () => void;
  busyUserId: string | null;
}

export function MemberList({
  members,
  currentUserId,
  isOwner,
  onRemove,
  onLeave,
  busyUserId,
}: MemberListProps) {
  return (
    <ul className={styles.list} data-testid="member-list">
      {members.map((m) => {
        const isSelf = m.id === currentUserId;
        const canRemove = isOwner && m.id !== currentUserId && m.role !== 'owner';
        const canLeave = isSelf && m.role !== 'owner';
        return (
          <li key={m.id} className={styles.row}>
            <div className={styles.meta}>
              <span className={styles.email}>{m.email}</span>
              <span className={m.role === 'owner' ? styles.badgeOwner : styles.badgeMember}>{m.role}</span>
            </div>
            <div className={styles.actions}>
              {canRemove && (
                <button
                  type="button"
                  className={styles.dangerBtn}
                  disabled={busyUserId === m.id}
                  onClick={() => onRemove(m.id)}
                  data-testid={`remove-member-${m.id}`}
                >
                  {busyUserId === m.id ? '…' : 'Remove'}
                </button>
              )}
              {canLeave && (
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={busyUserId === 'leave'}
                  onClick={() => onLeave()}
                  data-testid="leave-team-btn"
                >
                  {busyUserId === 'leave' ? '…' : 'Leave team'}
                </button>
              )}
            </div>
          </li>
        );
      })}
      {members.length === 0 && <li className={styles.empty}>No members yet.</li>}
    </ul>
  );
}
