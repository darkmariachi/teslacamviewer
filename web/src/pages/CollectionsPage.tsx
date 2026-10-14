import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderHeart, Plus } from 'lucide-react'
import { api, thumbUrl, type Collection } from '../api'
import { Button, EmptyState, Field, Modal, PageHeader, Spinner, inputClass } from '../components/ui'

export default function CollectionsPage() {
  const collections = useQuery({ queryKey: ['collections'], queryFn: api.collections })
  const [creating, setCreating] = useState(false)

  return (
    <>
      <PageHeader
        title="Collections"
        subtitle="Group events that belong together: an incident, a road trip, a parking lot that keeps causing trouble."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New collection
          </Button>
        }
      />
      {collections.isPending && <Spinner />}
      {collections.data?.length === 0 && (
        <EmptyState icon={<FolderHeart className="size-6" />} title="No collections yet">
          Create one here, then add events from their page or by selecting several in the events list.
        </EmptyState>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {collections.data?.map((c) => <CollectionCard key={c.id} collection={c} />)}
      </div>
      {creating && <CollectionForm onClose={() => setCreating(false)} />}
    </>
  )
}

function CollectionCard({ collection }: { collection: Collection }) {
  const covers = collection.covers
  return (
    <Link to={`/collections/${collection.id}`} className="group block">
      <div className="grid aspect-4/3 grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-xl bg-raised">
        {covers.length === 0 ? (
          <div className="col-span-2 row-span-2 flex items-center justify-center text-line-strong">
            <FolderHeart className="size-10" />
          </div>
        ) : (
          covers.map((id, i) => (
            <img
              key={id}
              src={thumbUrl(id)}
              alt=""
              loading="lazy"
              // One cover fills the tile, two split it, three give the first a full row.
              className={
                'size-full object-cover transition-opacity group-hover:opacity-90 ' +
                (covers.length === 1 ? 'col-span-2 row-span-2' : covers.length === 2 ? 'row-span-2' : covers.length === 3 && i === 0 ? 'col-span-2' : '')
              }
            />
          ))
        )}
      </div>
      <p className="mt-2.5 truncate px-0.5 text-sm font-semibold">{collection.name}</p>
      <p className="px-0.5 text-[13px] text-dim">
        {collection.count} {collection.count === 1 ? 'event' : 'events'}
      </p>
    </Link>
  )
}

export function CollectionForm({ collection, onClose }: { collection?: Collection; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(collection?.name ?? '')
  const [description, setDescription] = useState(collection?.description ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      if (collection) await api.updateCollection(collection.id, name, description)
      else await api.createCollection(name, description)
      await queryClient.invalidateQueries({ queryKey: ['collections'] })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setBusy(false)
    }
  }

  return (
    <Modal
      title={collection ? 'Edit collection' : 'New collection'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} disabled={!name.trim()} onClick={save}>
            {collection ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && save()} className={inputClass} />
        </Field>
        <Field label="Description" hint="Optional.">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputClass + ' h-auto py-2.5'} />
        </Field>
        {error && <p className="text-sm text-accent-hover">{error}</p>}
      </div>
    </Modal>
  )
}
