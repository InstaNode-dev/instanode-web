import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchResources, deleteResource, rotateCredentials, fetchResource } from '../api/resources';
import type { Resource, RotateCredentialsResponse } from '../types/resource';

export const RESOURCES_QUERY_KEY = ['resources'] as const;

export function useResources() {
  return useQuery({
    queryKey: RESOURCES_QUERY_KEY,
    queryFn: fetchResources,
    select: (data) => data.items,
    staleTime: 30_000, // 30s
  });
}

export function useResource(id: string) {
  return useQuery({
    queryKey: [...RESOURCES_QUERY_KEY, id],
    queryFn: () => fetchResource(id),
    select: (data) => data.resource,
    enabled: !!id,
  });
}

export function useDeleteResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteResource(id),
    onSuccess: (_data, id) => {
      // Optimistically remove from cache
      queryClient.setQueryData<Resource[]>(RESOURCES_QUERY_KEY, (old) =>
        old ? old.filter((r) => r.token !== id) : [],
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: RESOURCES_QUERY_KEY });
    },
  });
}

export function useRotateCredentials() {
  const queryClient = useQueryClient();

  return useMutation<RotateCredentialsResponse, Error, string>({
    mutationFn: (id: string) => rotateCredentials(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RESOURCES_QUERY_KEY });
    },
  });
}
