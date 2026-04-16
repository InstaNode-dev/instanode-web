import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRequireAuth, AUTH_QUERY_KEY } from '../hooks/useAuth';
import { updateTeam, fetchBilling, createCheckout } from '../api/team';
import {
  acceptInvitation,
  inviteTeamMember,
  leaveTeam,
  listInvitations,
  listTeamMembers,
  removeTeamMember,
  revokeInvitation,
} from '../api/team-members';
import { setAccessToken } from '../api/client';
import { InviteForm } from '../components/InviteForm/InviteForm';
import { MemberList } from '../components/MemberList/MemberList';
import styles from './SettingsPage.module.css';

type SettingsSection = 'account' | 'team' | 'billing';

const SECTIONS: { id: SettingsSection; label: string; icon: string }[] = [
  { id: 'account', label: 'Account', icon: '👤' },
  { id: 'team', label: 'Team', icon: '👥' },
  { id: 'billing', label: 'Billing', icon: '💳' },
];

export function SettingsPage() {
  const { user, team, isLoading, logout, isLoggingOut } = useRequireAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSection = (searchParams.get('section') as SettingsSection) ?? 'account';

  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [memberBusy, setMemberBusy] = useState<string | null>(null);
  const inviteHandledRef = useRef(false);

  // Billing data — fetched separately so it reflects live DB plan_tier
  const { data: billingData } = useQuery({
    queryKey: ['billing'],
    queryFn: fetchBilling,
    enabled: activeSection === 'billing',
  });

  // Team name input ref
  const teamNameRef = useRef<HTMLInputElement>(null);

  const { data: membersData } = useQuery({
    queryKey: ['team-members'],
    queryFn: listTeamMembers,
    enabled: !!team && activeSection === 'team',
  });

  const isOwner = user?.role === 'owner' || (!!team && user?.id === team.owner_id);

  const { data: invitationsData } = useQuery({
    queryKey: ['team-invitations'],
    queryFn: listInvitations,
    enabled: !!team && activeSection === 'team' && isOwner,
    retry: false,
  });

  useEffect(() => {
    const invite = searchParams.get('invite');
    if (!invite || activeSection !== 'team' || inviteHandledRef.current) {
      return;
    }
    inviteHandledRef.current = true;
    void (async () => {
      try {
        const res = await acceptInvitation(invite);
        if (res.access_token) {
          setAccessToken(res.access_token);
        }
        await queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
        await queryClient.invalidateQueries({ queryKey: ['team-members'] });
      } catch {
        // ignore — user may be wrong account or invite expired
      } finally {
        const next = new URLSearchParams(searchParams);
        next.delete('invite');
        setSearchParams(next, { replace: true });
      }
    })();
  }, [activeSection, searchParams, queryClient, setSearchParams]);

  // PATCH /api/v1/team mutation
  const updateTeamMutation = useMutation({
    mutationFn: (name: string) => updateTeam({ name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      setSaveMsg('Team name saved.');
      setTimeout(() => setSaveMsg(null), 3000);
    },
    onError: () => {
      setSaveMsg('Failed to save — please try again.');
      setTimeout(() => setSaveMsg(null), 3000);
    },
  });

  if (isLoading) {
    return <div className={styles.center}>Loading…</div>;
  }

  const setSection = (section: SettingsSection) => {
    setSearchParams({ section });
    setSaveMsg(null);
  };

  const handleSaveTeam = () => {
    const name = teamNameRef.current?.value?.trim() ?? '';
    if (!name) return;
    updateTeamMutation.mutate(name);
  };

  const plan = billingData?.plan ?? user?.tier ?? 'hobby';

  const removeMemberMutation = useMutation({
    mutationFn: (id: string) => removeTeamMember(id),
    onMutate: (id) => setMemberBusy(id),
    onSettled: () => setMemberBusy(null),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['team-members'] }),
  });

  const leaveMutation = useMutation({
    mutationFn: leaveTeam,
    onMutate: () => setMemberBusy('leave'),
    onSettled: () => setMemberBusy(null),
    onSuccess: async (res) => {
      if (res.access_token) {
        setAccessToken(res.access_token);
      }
      await queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: ['team-members'] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeInvitation(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['team-invitations'] }),
  });

  const handleUpgrade = async (targetPlan: string) => {
    if (!billingData?.billing.razorpay_configured) {
      window.open('https://instant.dev/pricing', '_blank');
      return;
    }
    setUpgradeLoading(true);
    setUpgradeError(null);
    try {
      const result = await createCheckout(targetPlan);
      if (result.short_url) {
        window.location.href = result.short_url;
      }
    } catch {
      setUpgradeError('Failed to start checkout — please try again.');
    } finally {
      setUpgradeLoading(false);
    }
  };

  return (
    <div className={styles.page} data-testid="settings-page">
      <h1 className={styles.title}>Settings</h1>

      <div className={styles.layout}>
        <nav className={styles.tabs} aria-label="Settings sections">
          {SECTIONS.map(({ id, label, icon }) => (
            <button
              key={id}
              className={`${styles.tab} ${activeSection === id ? styles.activeTab : ''}`}
              onClick={() => setSection(id)}
              data-testid={`settings-tab-${id}`}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </nav>

        <div className={styles.content}>
          {activeSection === 'account' && (
            <section data-testid="settings-account">
              <h2 className={styles.sectionTitle}>Account</h2>
              <div className={styles.form}>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Email</label>
                  <input
                    className={styles.input}
                    type="email"
                    defaultValue={user?.email ?? ''}
                    readOnly
                    aria-label="Email address"
                    data-testid="settings-user-email"
                  />
                  <p className={styles.hint}>Contact support to change your email address.</p>
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Current tier</label>
                  <div className={styles.tierDisplay}>
                    <span className={styles.tierBadge}>{user?.tier ?? 'hobby'}</span>
                  </div>
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Session</label>
                  <button
                    className={styles.logoutBtn}
                    type="button"
                    onClick={() => logout()}
                    disabled={isLoggingOut}
                    data-testid="settings-logout-btn"
                  >
                    {isLoggingOut ? 'Signing out…' : 'Sign out'}
                  </button>
                </div>
              </div>
            </section>
          )}

          {activeSection === 'team' && (
            <section data-testid="settings-team">
              <h2 className={styles.sectionTitle}>Team</h2>
              {team ? (
                <div className={styles.form}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Team name</label>
                    <input
                      ref={teamNameRef}
                      className={styles.input}
                      defaultValue={team.name}
                      aria-label="Team name"
                      data-testid="settings-team-name-input"
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Team slug</label>
                    <input className={styles.input} defaultValue={team.slug} readOnly aria-label="Team slug" />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Members</label>
                    <p className={styles.metaValue} data-testid="settings-member-limit">
                      {(() => {
                        const used = membersData?.members?.length ?? team.member_count;
                        const lim = membersData?.member_limit ?? 1;
                        if (lim < 0) {
                          return `${used} member${used !== 1 ? 's' : ''} (unlimited on this plan)`;
                        }
                        return `${used} / ${lim} member${lim !== 1 ? 's' : ''} on your plan`;
                      })()}
                    </p>
                  </div>

                  {membersData?.members && user && (
                    <div className={styles.fieldGroup}>
                      <label className={styles.label}>Directory</label>
                      <MemberList
                        members={membersData.members}
                        currentUserId={user.id}
                        isOwner={isOwner}
                        onRemove={(id) => removeMemberMutation.mutate(id)}
                        onLeave={() => leaveMutation.mutate()}
                        busyUserId={memberBusy}
                      />
                    </div>
                  )}

                  {isOwner && (
                    <div className={styles.fieldGroup}>
                      <label className={styles.label}>Invite teammate</label>
                      <InviteForm
                        disabled={false}
                        onInvite={async (email, role) => {
                          await inviteTeamMember({ email, role });
                          await queryClient.invalidateQueries({ queryKey: ['team-members'] });
                          await queryClient.invalidateQueries({ queryKey: ['team-invitations'] });
                        }}
                      />
                    </div>
                  )}

                  {isOwner && invitationsData?.invitations && invitationsData.invitations.length > 0 && (
                    <div className={styles.fieldGroup}>
                      <label className={styles.label}>Pending invitations</label>
                      <ul className={styles.inviteList} data-testid="pending-invites">
                        {invitationsData.invitations.map((inv) => (
                          <li key={inv.id} className={styles.inviteRow}>
                            <span>{inv.email}</span>
                            <span className={styles.inviteMeta}>{inv.role}</span>
                            <button
                              type="button"
                              className={styles.revokeBtn}
                              onClick={() => revokeMutation.mutate(inv.id)}
                              disabled={revokeMutation.isPending}
                            >
                              Revoke
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <button
                    className={styles.saveBtn}
                    type="button"
                    onClick={handleSaveTeam}
                    disabled={updateTeamMutation.isPending}
                    data-testid="settings-save-btn"
                  >
                    {updateTeamMutation.isPending ? 'Saving…' : 'Save team'}
                  </button>
                  {saveMsg && (
                    <p className={styles.hint} data-testid="save-msg">{saveMsg}</p>
                  )}
                </div>
              ) : (
                <div className={styles.emptySection}>
                  <p>You are not part of a team yet.</p>
                </div>
              )}
            </section>
          )}

          {activeSection === 'billing' && (
            <section data-testid="settings-billing">
              <h2 className={styles.sectionTitle}>Billing</h2>
              <p className={styles.hint} style={{ marginBottom: '16px' }}>
                <Link to="/billing">Open billing portal</Link> for invoices, payment method, and plan changes.
              </p>
              <div className={styles.planCard}>
                <div className={styles.planHeader}>
                  <span className={styles.planName}>{plan} plan</span>
                  {plan === 'hobby' && (
                    <span className={styles.freeBadge}>Free</span>
                  )}
                </div>
                <ul className={styles.planFeatures}>
                  {plan === 'hobby' && (
                    <>
                      <li>Up to 5 resources per type</li>
                      <li>500 MB Postgres, 25 MB Redis, 100 MB MongoDB per resource</li>
                      <li>7-day resource history</li>
                      <li>Community support</li>
                    </>
                  )}
                  {plan === 'pro' && (
                    <>
                      <li>Up to 50 resources per type</li>
                      <li>5 GB Postgres, 256 MB Redis, 2 GB MongoDB per resource</li>
                      <li>90-day history + PITR on Postgres</li>
                      <li>Priority support</li>
                    </>
                  )}
                  {plan === 'team' && (
                    <>
                      <li>Unlimited resources</li>
                      <li>Dedicated infrastructure</li>
                      <li>Custom domains + on-call rotation</li>
                      <li>SLA + priority support</li>
                    </>
                  )}
                </ul>
                {plan !== 'pro' && plan !== 'team' && (
                  <>
                    <button
                      className={styles.upgradeBtn}
                      data-testid="upgrade-btn"
                      disabled={upgradeLoading}
                      onClick={() => void handleUpgrade('pro')}
                    >
                      {upgradeLoading ? 'Redirecting…' : 'Upgrade to Pro — $49/mo'}
                    </button>
                    {upgradeError && (
                      <p className={styles.hint} style={{ marginTop: '8px', color: 'var(--color-error, #e53e3e)' }}>
                        {upgradeError}
                      </p>
                    )}
                    {!billingData?.billing.razorpay_configured && (
                      <p className={styles.hint} style={{ marginTop: '8px' }}>
                        Billing not yet configured — button opens pricing page.
                      </p>
                    )}
                  </>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
