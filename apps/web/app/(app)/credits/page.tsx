'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui';

interface Account {
  balance: number;
  pricePerEmail: number;
}
interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export default function CreditsPage() {
  const { user } = useAuth();
  const [mine, setMine] = useState<Account | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const isAdmin = user?.role === 'SUPER_ADMIN';

  function load() {
    api.get<Account>('/credits/me').then(setMine).catch(() => {});
    if (isAdmin) api.get<User[]>('/users').then(setUsers).catch(() => {});
  }
  useEffect(load, [isAdmin]);

  async function adjust(userId: string, sign: number) {
    const amt = Number(amounts[userId] ?? 0) * sign;
    if (!amt) return;
    setError('');
    try {
      await api.post(`/credits/${userId}/adjust`, {
        delta: amt,
        reason: sign > 0 ? 'Admin grant' : 'Admin deduction',
      });
      setAmounts({ ...amounts, [userId]: '' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div>
      <PageHeader
        title="Balance & Credits"
        subtitle="Sending consumes credits when enabled"
      />

      <div className="mb-6 max-w-sm card p-6">
        <div className="text-sm text-slate-500">My balance</div>
        <div className="mt-1 text-4xl font-semibold text-brand-700">
          {mine?.balance ?? 0}
        </div>
        <div className="mt-1 text-xs text-slate-400">credits</div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
          {error}
        </p>
      )}

      {isAdmin && (
        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3 font-medium">
            Manage user credits
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3">User</th>
                <th className="px-5 py-3">Amount</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-5 py-3">
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-slate-400">{u.email}</div>
                  </td>
                  <td className="px-5 py-3">
                    <input
                      type="number"
                      className="input w-32"
                      placeholder="0"
                      value={amounts[u.id] ?? ''}
                      onChange={(e) =>
                        setAmounts({ ...amounts, [u.id]: e.target.value })
                      }
                    />
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex gap-2">
                      <button
                        className="btn-primary px-3 py-1 text-xs"
                        onClick={() => adjust(u.id, 1)}
                      >
                        Grant
                      </button>
                      <button
                        className="btn-ghost px-3 py-1 text-xs"
                        onClick={() => adjust(u.id, -1)}
                      >
                        Deduct
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
