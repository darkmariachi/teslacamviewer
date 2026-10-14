import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FolderMinus, FolderOpen, Pencil, Trash2 } from 'lucide-react'
import { api } from '../api'
import { EventBrowser } from '../components/EventBrowser'
import { Button, ConfirmDialog, EmptyState, PageHeader, Spinner } from '../components/ui'
import { CollectionForm } from './CollectionsPage'

export default function CollectionPage() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const collections = useQuery({ queryKey: ['collections'], queryFn: api.collections })
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null)
  const collection = collections.data?.find((c) => c.id === id)

  if (collections.isPending) return <Spinner />
  if (!collection) {
    return (
      <EmptyState icon={<FolderOpen className="size-6" />} title="Collection not found">
        <Link to="/collections" className="text-fg underline">Back to collections</Link>
      </EmptyState>
    )
  }

  return (
    <>
      <Link to="/collections" className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-dim hover:text-fg">
        <ArrowLeft className="size-4" /> Collections
      </Link>
      <PageHeader
        title={collection.name}
        subtitle={collection.description || undefined}
        actions={
          <>
            <Button size="sm" icon={<Pencil className="size-4" />} onClick={() => setDialog('edit')}>
              Edit
            </Button>
            <Button size="sm" icon={<Trash2 className="size-4" />} onClick={() => setDialog('delete')}>
              Delete
            </Button>
          </>
        }
      />
      <EventBrowser
        fixed={{ collection: id }}
        empty={
          <EmptyState icon={<FolderOpen className="size-6" />} title="This collection is empty">
            Add events from their page, or select several in the events list and choose Collect.
          </EmptyState>
        }
        extraBulk={(ids, done) => (
          <Button
            size="sm"
            disabled={!ids.length}
            icon={<FolderMinus className="size-4" />}
            onClick={async () => {
              await Promise.all(ids.map((eventId) => api.removeFromCollection(id, eventId)))
              done()
            }}
          >
            Remove
          </Button>
        )}
      />
      {dialog === 'edit' && <CollectionForm collection={collection} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && (
        <ConfirmDialog
          title={`Delete "${collection.name}"?`}
          message="Only the collection is removed. The events and their clips stay in your library."
          confirmLabel="Delete collection"
          danger
          onConfirm={async () => {
            await api.deleteCollection(id)
            await queryClient.invalidateQueries({ queryKey: ['collections'] })
            navigate('/collections', { replace: true })
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  )
}
