import { apiFetch } from './client';

export interface TeamMemberDTO {
  id: string;
  email: string;
  role: string;
  created_at: string;
}

export interface TeamInvitationDTO {
  id: string;
  email: string;
  role: string;
  status: string;
  invited_by: string;
  created_at: string;
  expires_at: string;
}

export interface ListMembersResponse {
  ok: boolean;
  members: TeamMemberDTO[];
  member_limit: number;
}

export interface ListInvitationsResponse {
  ok: boolean;
  invitations: TeamInvitationDTO[];
}

export async function listTeamMembers(): Promise<ListMembersResponse> {
  return apiFetch<ListMembersResponse>('/api/v1/team/members');
}

export async function listInvitations(): Promise<ListInvitationsResponse> {
  return apiFetch<ListInvitationsResponse>('/api/v1/team/invitations');
}

export async function inviteTeamMember(body: { email: string; role: string }): Promise<{ ok: boolean }> {
  return apiFetch('/api/v1/team/members/invite', { method: 'POST', body });
}

export async function removeTeamMember(userId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/team/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

export async function leaveTeam(): Promise<{ ok: boolean; access_token?: string }> {
  return apiFetch('/api/v1/team/members/leave', { method: 'POST' });
}

export async function revokeInvitation(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/team/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function acceptInvitation(id: string): Promise<{ ok: boolean; access_token?: string }> {
  return apiFetch(`/api/v1/team/invitations/${encodeURIComponent(id)}/accept`, { method: 'POST' });
}
