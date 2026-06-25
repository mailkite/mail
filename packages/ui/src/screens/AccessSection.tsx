import { useEffect, useState, type FormEvent } from 'react'
import { Trash2, X } from 'lucide-react'
import { api, type AccessView, type GrantSubject } from '../lib/api'
import { Button } from '../components/Button'

const inputCls =
  'rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]'
const chipCls =
  'inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)] px-2 py-0.5 text-xs text-[var(--color-accent)]'

/** Admin "Access" surface: provision addresses, create teams, and grant who can
 *  see which mailbox (docs/acl.md). */
export function AccessSection() {
  const [v, setV] = useState<AccessView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addr, setAddr] = useState('')
  const [label, setLabel] = useState('')
  const [teamName, setTeamName] = useState('')

  const load = async () => {
    try { setV(await api.access()) } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load access') }
  }
  useEffect(() => { void load() }, [])

  async function run(fn: () => Promise<unknown>) {
    setError(null)
    try { await fn(); await load() } catch (e) { setError(e instanceof Error ? e.message : 'Action failed') }
  }

  if (!v) return <section><h2 className="text-lg font-semibold">Access</h2><p className="text-sm text-[var(--color-muted)]">{error ?? 'Loading…'}</p></section>

  const userEmail = (id: string) => v.users.find((u) => u.id === id)?.email ?? id
  const teamName_ = (id: string) => v.teams.find((t) => t.id === id)?.name ?? id

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Access</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Provision mailbox addresses and grant who can see them — directly to a user or to a team.
          The owner (admin) sees all; everyone else sees only what's granted.
        </p>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Addresses + their grants */}
      <form
        onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => api.provisionAddress(addr.trim(), label.trim() || undefined)).then(() => { setAddr(''); setLabel('') }) }}
        className="flex gap-2"
      >
        <input className={`${inputCls} flex-[2]`} placeholder="support@yourdomain.com" value={addr} onChange={(e) => setAddr(e.target.value)} required type="email" />
        <input className={`${inputCls} flex-1`} placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Button type="submit" disabled={!addr.trim()}>Provision</Button>
      </form>

      <div className="rounded-lg border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
        {v.addresses.length === 0 && <p className="p-3 text-sm text-[var(--color-muted)]">No addresses yet.</p>}
        {v.addresses.map((a) => {
          const grants = v.grants.filter((g) => g.address_id === a.id)
          return (
            <div key={a.id} className="p-3 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">{a.address}</span>
                {a.label && <span className="text-xs text-[var(--color-muted)]">{a.label}</span>}
                <button onClick={() => run(() => api.removeAddress(a.id))} title="Remove address" className="ml-auto text-[var(--color-muted)] hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {grants.length === 0 && <span className="text-xs text-[var(--color-muted)]">No one yet —</span>}
                {grants.map((g) => {
                  const who: GrantSubject = g.user_id ? { userId: g.user_id } : { teamId: g.team_id! }
                  return (
                    <span key={(g.user_id ?? '') + (g.team_id ?? '')} className={chipCls}>
                      {g.user_id ? userEmail(g.user_id) : `team: ${teamName_(g.team_id!)}`}
                      <button onClick={() => run(() => api.revoke(a.id, who))} title="Revoke"><X size={11} /></button>
                    </span>
                  )
                })}
                <select
                  className={`${inputCls} py-1 text-xs`}
                  value=""
                  onChange={(e) => {
                    const [kind, id] = e.target.value.split(':')
                    if (id) void run(() => api.grant(a.id, kind === 'u' ? { userId: id } : { teamId: id }))
                  }}
                >
                  <option value="">Grant to…</option>
                  <optgroup label="Users">
                    {v.users.map((u) => <option key={u.id} value={`u:${u.id}`}>{u.email}</option>)}
                  </optgroup>
                  <optgroup label="Teams">
                    {v.teams.map((t) => <option key={t.id} value={`t:${t.id}`}>{t.name}</option>)}
                  </optgroup>
                </select>
              </div>
            </div>
          )
        })}
      </div>

      {/* Teams + members */}
      <form
        onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => api.createAccessTeam(teamName.trim())).then(() => setTeamName('')) }}
        className="flex gap-2"
      >
        <input className={`${inputCls} flex-1`} placeholder="New team name (e.g. Support)" value={teamName} onChange={(e) => setTeamName(e.target.value)} required />
        <Button type="submit" disabled={!teamName.trim()}>Create team</Button>
      </form>

      <div className="rounded-lg border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
        {v.teams.length === 0 && <p className="p-3 text-sm text-[var(--color-muted)]">No teams yet.</p>}
        {v.teams.map((t) => {
          const members = v.members.filter((m) => m.team_id === t.id)
          const memberIds = new Set(members.map((m) => m.user_id))
          return (
            <div key={t.id} className="p-3 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">{t.name}</span>
                <button onClick={() => run(() => api.removeTeam(t.id))} title="Delete team" className="ml-auto text-[var(--color-muted)] hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {members.length === 0 && <span className="text-xs text-[var(--color-muted)]">No members —</span>}
                {members.map((m) => (
                  <span key={m.user_id} className={chipCls}>
                    {userEmail(m.user_id)}
                    <button onClick={() => run(() => api.removeTeamMember(t.id, m.user_id))} title="Remove"><X size={11} /></button>
                  </span>
                ))}
                <select
                  className={`${inputCls} py-1 text-xs`}
                  value=""
                  onChange={(e) => { if (e.target.value) void run(() => api.addTeamMember(t.id, e.target.value)) }}
                >
                  <option value="">Add member…</option>
                  {v.users.filter((u) => !memberIds.has(u.id)).map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
                </select>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
