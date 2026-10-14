import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FolderPlus, Plus } from 'lucide-react'
import { api } from '../api'
import { Button, Modal, Spinner, inputClass } from './ui'

interface Props {
  /** Collections the event(s) already belong to; shown as checked. */
  current?: number[]
  onPick: (collectionId: number, isMember: boolean) => Promise<unknown>
  onClose: () => void
}

/** Choose a collection, or make a new one on the spot. */
export function CollectionPicker({ current = [], onPick, onClose }: Props) {
  const queryClient = useQueryClient()
  const collections = useQuery({ queryKey: ['collections'], queryFn: api.collections })
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<number | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [members, setMembers] = useState(() => new Set(current))

  async function pick(id: number) {
    setBusy(id)
    setError(null)
    try {
      const isMember = members.has(id)
      await onPick(id, isMember)
      setMembers((prev) => {
        const next = new Set(prev)
        if (isMember) next.delete(id)
        else next.add(id)
        return next
      })
      queryClient.invalidateQueries({ queryKey: ['collections'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
    setBusy(null)
  }

  async function create() {
    if (!name.trim()) return
    setBusy('new')
    setError(null)
    try {
      const created = await api.createCollection(name.trim())
      setName('')
      await queryClient.invalidateQueries({ queryKey: ['collections'] })
      await pick(created.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
    setBusy(null)
  }

  return (
    <Modal title="Add to collection" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          create()
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New collection name" className={inputClass} />
        <Button type="submit" busy={busy === 'new'} disabled={!name.trim()} icon={<Plus className="size-4" />}>
          Create
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-accent-hover">{error}</p>}
      <div className="mt-4 space-y-1">
        {collections.isPending && <Spinner />}
        {collections.data?.length === 0 && (
          <p className="flex items-center gap-2 py-4 text-sm text-dim">
            <FolderPlus className="size-4" /> No collections yet. Create your first one above.
          </p>
        )}
        {collections.data?.map((c) => (
          <button
            key={c.id}
            onClick={() => pick(c.id)}
            disabled={busy !== null}
            className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-hover"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{c.name}</span>
              <span className="text-xs text-faint">{c.count} {c.count === 1 ? 'event' : 'events'}</span>
            </span>
            {busy === c.id ? <Spinner className="size-4" /> : members.has(c.id) ? <Check className="size-5 text-ok" /> : <Plus className="size-4 text-faint" />}
          </button>
        ))}
      </div>
    </Modal>
  )
}
