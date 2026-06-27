import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api, type TeamsView } from '../lib/api'

const inputCls =
  'rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]'
const chipCls =
  'inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)] px-2 py-0.5 text-xs text-[var(--color-accent)]'

/** Member-facing team management: a team-admin (team_members.role='admin') adds
 *  and removes members of the team(s) they administer. Read-only for teams they
 *  only belong to. Uses /api/teams (not the admin endpoints). */
export function TeamAdmin() {
  const [v, setV] = useState<TeamsView | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try { setV(await api.teams()) } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load teams') }
  }
  useEffect(() => { void load() }, [])

  async function run(fn: () => Promise<unknown>) {
    setError(null)
    try { await fn(); await load() } catch (e) { setError(e instanceof Error ? e.message : 'Action failed') }
  }

  const email = (id: string) => v?.users.find((u) => u.id === id)?.email ?? id

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Teams</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Manage membership of the teams you administer. Members of a team can read the mail granted
            to it.
          </p>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!v && !error && <p className="text-sm text-[var(--color-muted)]">Loading…</p>}
        {v?.teams.length === 0 && <p className="text-sm text-[var(--color-muted)]">You're not on any teams.</p>}

        {v?.teams.map((t) => {
          const members = v.members.filter((m) => m.team_id === t.id)
          const memberIds = new Set(members.map((m) => m.user_id))
          const isAdmin = t.myRole === 'admin'
          return (
            <section key={t.id} className="rounded-lg border border-[var(--color-border)] p-4 space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="font-medium">{t.name}</h2>
                {isAdmin && <span className="rounded-full bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)] px-2 py-0.5 text-xs text-[var(--color-accent)]">you manage this</span>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                {members.length === 0 && <span className="text-xs text-[var(--color-muted)]">No members yet —</span>}
                {members.map((m) => (
                  <span key={m.user_id} className={chipCls}>
                    {email(m.user_id)}{m.role === 'admin' ? ' (admin)' : ''}
                    {isAdmin && (
                      <button onClick={() => run(() => api.teamRemoveMember(t.id, m.user_id))} title="Remove"><X size={11} /></button>
                    )}
                  </span>
                ))}
                {isAdmin && (
                  <select
                    className={inputCls}
                    value=""
                    onChange={(e) => { if (e.target.value) void run(() => api.teamAddMember(t.id, e.target.value)) }}
                  >
                    <option value="">Add member…</option>
                    {v.users.filter((u) => !memberIds.has(u.id)).map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
                  </select>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
