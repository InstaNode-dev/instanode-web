import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRequireAuth } from '../hooks/useAuth';
import type { DashboardStack } from '../api/stacks';
import { deleteStack, listStacks } from '../api/stacks';
import { DeploymentList } from '../components/deploy/DeploymentList';
import { NewDeploymentModal } from '../components/deploy/NewDeploymentModal';
import styles from './DeployPage.module.css';
import deployStyles from '../components/deploy/DeployComponents.module.css';

const STACKS_QUERY_KEY = ['stacks', 'list'] as const;

export function DeployPage() {
  useRequireAuth();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<'create' | 'redeploy' | null>(null);
  const [redeployTarget, setRedeployTarget] = useState<DashboardStack | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: STACKS_QUERY_KEY,
    queryFn: listStacks,
  });

  const deleteMut = useMutation({
    mutationFn: deleteStack,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: STACKS_QUERY_KEY });
    },
  });

  const openCreate = () => {
    setRedeployTarget(null);
    setModal('create');
  };

  const openRedeploy = (stack: DashboardStack) => {
    setRedeployTarget(stack);
    setModal('redeploy');
  };

  return (
    <div className={`${deployStyles.page} ${styles.page}`} data-testid="deploy-page">
      <header className={deployStyles.header}>
        <h1 className={deployStyles.title} data-testid="deploy-page-title">
          Deployments
        </h1>
        <button type="button" className={deployStyles.primaryBtn} onClick={openCreate} data-testid="deploy-new-btn">
          New
        </button>
      </header>

      <DeploymentList
        stacks={data?.items}
        isLoading={isLoading}
        error={error as Error | null}
        onRetry={() => void refetch()}
        onDelete={async (slug) => {
          await deleteMut.mutateAsync(slug);
        }}
        onRedeploy={openRedeploy}
        busy={deleteMut.isPending}
      />

      {modal === 'create' ? (
        <NewDeploymentModal
          mode="create"
          onClose={() => setModal(null)}
          onSuccess={() => void queryClient.invalidateQueries({ queryKey: STACKS_QUERY_KEY })}
        />
      ) : null}
      {modal === 'redeploy' && redeployTarget ? (
        <NewDeploymentModal
          mode="redeploy"
          redeploySlug={redeployTarget.slug}
          onClose={() => {
            setModal(null);
            setRedeployTarget(null);
          }}
          onSuccess={() => void queryClient.invalidateQueries({ queryKey: STACKS_QUERY_KEY })}
        />
      ) : null}
    </div>
  );
}
