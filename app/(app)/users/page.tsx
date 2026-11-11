'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

interface User {
  id: string
  email: string
  name: string | null
  role: string
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
}

async function fetchUsers(): Promise<User[]> {
  const res = await fetch('/api/users', { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to load users')
  return res.json()
}

async function deleteUser(id: string): Promise<void> {
  const res = await fetch('/api/users?id=' + encodeURIComponent(id), { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete user')
}

async function updateUser(id: string, body: { name?: string | null; role?: string | null; isActive?: boolean }): Promise<User> {
  const res = await fetch('/api/users?id=' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to update user')
  return res.json()
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState('VIEWER')
  const [editIsActive, setEditIsActive] = useState(true)

  useEffect(() => {
    fetchUsers()
      .then(setUsers)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load users')
        setIsLoading(false)
      })
      .finally(() => setIsLoading(false))
  }, [])

  async function saveUser(id: string) {
    const u = users.find((u) => u.id === id)
    if (!u) return
    await updateUser(id, { name: editName, role: editRole, isActive: editIsActive })
    setEditingId(null)
    setEditName('')
    setEditRole('VIEWER')
    setEditIsActive(true)
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, name: editName, role: editRole, isActive: editIsActive } : u)))
  }

  async function handleEdit(id: string) {
    const u = users.find((u) => u.id === id)
    if (!u) return
    setEditingId(id)
    setEditName(u.name || '')
    setEditRole(u.role)
    setEditIsActive(u.isActive)
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this user?')) return
    await deleteUser(id)
    setUsers((prev) => prev.filter((u) => u.id !== id))
  }

  async function handleActivate(id: string) {
    await updateUser(id, { isActive: true })
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, isActive: true } : u)))
  }

  async function handleDeactivate(id: string) {
    if (!confirm('Are you sure you want to deactivate this user?')) return
    await updateUser(id, { isActive: false })
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, isActive: false } : u)))
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
        <span className="ml-3 text-slate-400">Loading users…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-slate-400">
        <p>{error}</p>
        <Link href="/alerts" className="mt-4 px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors rounded-lg hover:bg-slate-800">
          ← Back to Alerts
        </Link>
      </div>
    )
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-slate-400">Manage user accounts and roles.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/alerts" className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors rounded-lg hover:bg-slate-800">
            ← Back to Alerts
          </Link>
        </div>
      </header>

      <div className="rounded-lg border border-slate-800 bg-slate-950/50 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/50 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Email</th>
              <th className="px-4 py-3 text-left font-medium">Role</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Last Login</th>
              <th className="px-4 py-3 text-left font-medium">Created</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {users.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">No users found.</td></tr>
            ) : (
              users.map((user) => {
                return (
                  <tr key={user.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-3 text-sm text-slate-200 font-medium">{user.name || 'Unnamed user'}</td>
                    <td className="px-4 py-3 text-xs text-slate-300 font-mono whitespace-nowrap">{user.email}</td>
                    <td className="px-4 py-3 text-xs font-mono">
                      <span className={'px-2 py-0.5 rounded text-xs font-medium ' + (user.role === 'ADMIN' ? 'bg-red-500/20 text-red-400' : user.role === 'MEMBER' ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-500/20 text-slate-400')}>{user.role}</span>
                    </td>
                    <td className="px-4 py-3 text-xs font-medium">
                      <span className={'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ' + (user.isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-500/20 text-slate-400')}>{user.isActive ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 font-mono whitespace-nowrap">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 text-xs text-slate-400 font-mono whitespace-nowrap">{new Date(user.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      {editingId === user.id ? (
                        <div className="flex items-center gap-2">
                          <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="text-xs rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="Name" />
                          <select value={editRole} onChange={(e) => setEditRole(e.target.value as any)} className="text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500">
                            <option value="ADMIN">Admin</option>
                            <option value="MEMBER">Member</option>
                            <option value="VIEWER">Viewer</option>
                          </select>
                          <input type="checkbox" checked={editIsActive} onChange={(e) => setEditIsActive(e.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-800" />
                          <label className="text-xs text-slate-300">Active</label>
                          <button type="button" onClick={() => saveUser(user.id)} className="text-xs text-slate-400 hover:text-blue-400 dark:hover:text-blue-300">Save</button>
                          <button type="button" onClick={() => setEditingId(null)} className="text-xs text-slate-400 hover:text-slate-200">Cancel</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          {user.isActive && (
                            <button type="button" onClick={() => handleEdit(user.id)} className="text-xs text-slate-400 hover:text-blue-400 dark:hover:text-blue-300">Edit</button>
                          )}
                          {user.isActive && user.role !== 'ADMIN' && (
                            <button type="button" onClick={() => handleDeactivate(user.id)} className="text-xs text-slate-400 hover:text-red-400 dark:hover:text-red-400">Deactivate</button>
                          )}
                          {!user.isActive && (
                            <button type="button" onClick={() => handleActivate(user.id)} className="text-xs text-slate-400 hover:text-emerald-400 dark:hover:text-emerald-300">Activate</button>
                          )}
                          {user.role !== 'ADMIN' && (
                            <button type="button" onClick={() => handleDelete(user.id)} className="text-xs text-slate-400 hover:text-red-400 dark:hover:text-red-400">Delete</button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 text-sm text-slate-500">
        <p className="mb-2 font-medium text-slate-300">Role reference:</p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li><span className="text-red-400 font-medium">ADMIN</span> — Full access to all settings and user management</li>
          <li><span className="text-blue-400 font-medium">MEMBER</span> — Can view and modify most settings</li>
          <li><span className="text-slate-400 font-medium">VIEWER</span> — Read-only access</li>
        </ul>
      </div>
    </section>
  )
}