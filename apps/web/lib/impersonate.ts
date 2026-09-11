'use client';

import { api, setToken, setRefreshToken, stashAdminSession } from './api';

/** Roles an admin can view the app as. */
export type ImpersonatableRole = 'CLIENT' | 'SALES' | 'SUB_ADMIN';

interface ImpersonateResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string; role: string };
}

/** Where each role's own workspace starts. */
export function landingFor(role: string): string {
  if (role === 'CLIENT') return '/client-home';
  if (role === 'SALES') return '/sales-home';
  return '/dashboard';
}

const WHAT_THEY_SEE: Record<string, string> = {
  CLIENT: 'their client portal',
  SALES: 'their salesperson panel, scoped to the clients assigned to them',
  SUB_ADMIN: 'the admin panel with exactly the modules they are granted',
};

/**
 * Swap this browser's session for another login's and land in their workspace.
 *
 * The admin's own tokens are stashed first, so the amber banner in the app
 * layout can restore them with "Back to Admin" — no re-login needed. Returns
 * false if the admin cancelled or the swap failed (the caller stays put).
 */
export async function loginAsUser(
  userId: string,
  label: string,
  role: ImpersonatableRole,
): Promise<boolean> {
  const sees = WHAT_THEY_SEE[role] ?? 'their workspace';
  if (
    !confirm(
      `Log in as "${label}"?\n\nYou'll see ${sees}. Use "Back to Admin" in the banner at the top to return to your own session.`,
    )
  ) {
    return false;
  }
  try {
    const res = await api.post<ImpersonateResponse>(
      `/auth/users/${userId}/impersonate`,
      {},
    );
    // Keep the admin session so the banner can offer a one-click return.
    stashAdminSession();
    setToken(res.accessToken);
    setRefreshToken(res.refreshToken);
    // Full reload so every provider picks up the new identity cleanly.
    window.location.href = landingFor(res.user.role);
    return true;
  } catch (e) {
    alert(e instanceof Error ? e.message : 'Could not log in as this account');
    return false;
  }
}
