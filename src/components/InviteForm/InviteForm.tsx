import { useState } from 'react';
import styles from './InviteForm.module.css';

interface InviteFormProps {
  onInvite: (email: string, role: string) => Promise<void>;
  disabled?: boolean;
}

export function InviteForm({ onInvite, disabled }: InviteFormProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setMsg('Enter an email address.');
      return;
    }
    setPending(true);
    setMsg(null);
    try {
      await onInvite(trimmed, role);
      setEmail('');
      setMsg('Invitation sent.');
    } catch {
      setMsg('Could not send invite — check limits or duplicates.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={styles.wrap} data-testid="invite-form">
      <div className={styles.row}>
        <label className={styles.label} htmlFor="invite-email">
          Email
        </label>
        <input
          id="invite-email"
          className={styles.input}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="colleague@company.com"
          disabled={disabled || pending}
        />
      </div>
      <div className={styles.row}>
        <label className={styles.label} htmlFor="invite-role">
          Role
        </label>
        <select
          id="invite-role"
          className={styles.select}
          value={role}
          onChange={(e) => setRole(e.target.value)}
          disabled={disabled || pending}
        >
          <option value="member">Member</option>
        </select>
      </div>
      <button
        type="button"
        className={styles.btn}
        onClick={() => void submit()}
        disabled={disabled || pending}
        data-testid="invite-submit"
      >
        {pending ? 'Sending…' : 'Send invite'}
      </button>
      {msg && <p className={styles.hint}>{msg}</p>}
    </div>
  );
}
