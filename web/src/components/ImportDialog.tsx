import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, FolderOpen, HardDrive, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, desktopBridge, uploadClip, type ImportCheck, type ImportStatus } from '../api'
import { formatBytes } from '../lib/format'
import { Button, Modal, ProgressBar, Spinner, Toggle } from './ui'

/**
 * Brings clips from the car's USB drive (or a copy of it) into the library. In the desktop app the
 * server copies the drive itself; in a browser the files are uploaded one by one.
 */
export function ImportDialog({ desktop, initialSource, onClose }: { desktop: boolean; initialSource?: string; onClose: () => void }) {
  return (
    <Modal title="Import clips" onClose={onClose} wide>
      {desktop ? <DesktopImport initialSource={initialSource} /> : <BrowserImport />}
    </Modal>
  )
}

function useRefreshLibrary() {
  const queryClient = useQueryClient()
  // New folders are indexed by a scan the import starts; give it a moment before reloading the list.
  return useCallback(
    () =>
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['events'] })
        queryClient.invalidateQueries({ queryKey: ['facets'] })
      }, 3000),
    [queryClient],
  )
}

function Intro() {
  return (
    <p className="text-sm text-dim">
      Plug the car's USB drive into this computer and choose it, or choose any folder with a copy of it. Clips you
      already imported are skipped. If teslausb archives your clips automatically, you don't need this.
    </p>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Browser: upload the files of a folder the user picks.

type Picked = { file: File; path: string }

function BrowserImport() {
  const input = useRef<HTMLInputElement>(null)
  const refreshLibrary = useRefreshLibrary()
  const [picked, setPicked] = useState<Picked[] | null>(null)
  const [check, setCheck] = useState<ImportCheck | null>(null)
  const [phase, setPhase] = useState<'pick' | 'checking' | 'ready' | 'uploading' | 'done'>('pick')
  const [sent, setSent] = useState(0)
  const [uploaded, setUploaded] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  // Leaving the dialog stops the upload.
  useEffect(() => () => abort.current?.abort(), [])

  async function onPick(files: FileList | null) {
    if (!files?.length) return
    const list = Array.from(files).map((file) => ({ file, path: file.webkitRelativePath || file.name }))
    setPicked(list)
    setError(null)
    setPhase('checking')
    try {
      const result = await api.importCheck(list.map((p) => ({ path: p.path, size: p.file.size })))
      setCheck(result)
      setPhase('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setPhase('pick')
    }
  }

  async function upload() {
    if (!picked || !check) return
    const byPath = new Map(picked.map((p) => [p.path, p.file]))
    const queue = check.missing.map((m) => ({ path: m.path, file: byPath.get(m.path)! })).filter((x) => x.file)
    const controller = new AbortController()
    abort.current = controller
    setPhase('uploading')
    setSent(0)
    setUploaded(0)
    setError(null)

    let finishedBytes = 0
    const inFlight = new Map<string, number>()
    const report = () => setSent(finishedBytes + [...inFlight.values()].reduce((a, b) => a + b, 0))
    let next = 0
    // Two at a time: enough to keep a home connection busy without starving the server.
    const worker = async () => {
      while (next < queue.length && !controller.signal.aborted) {
        const item = queue[next++]
        await uploadClip(item.file, item.path, (bytes) => {
          inFlight.set(item.path, bytes)
          report()
        }, controller.signal)
        inFlight.delete(item.path)
        finishedBytes += item.file.size
        report()
        setUploaded((n) => n + 1)
      }
    }
    try {
      await Promise.all([worker(), worker()])
      await api.importFinish()
      refreshLibrary()
      setPhase('done')
    } catch (e) {
      if (controller.signal.aborted) {
        setPhase('ready')
        return
      }
      controller.abort()
      // What arrived is kept; picking the folder again continues where this stopped.
      await api.importFinish().catch(() => {})
      setError(`${e instanceof Error ? e.message : 'The upload failed'}. Choose the folder again to continue where it stopped.`)
      setPhase('pick')
    }
  }

  return (
    <div className="space-y-4">
      <Intro />
      {/* webkitdirectory lets the browser pick a whole folder; every major browser supports it. */}
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        {...{ webkitdirectory: '', directory: '' }}
        onChange={(e) => {
          onPick(e.target.files)
          e.target.value = ''
        }}
      />

      {(phase === 'pick' || phase === 'checking') && (
        <div className="space-y-2">
          <Button variant="primary" icon={<FolderOpen className="size-4" />} busy={phase === 'checking'} onClick={() => input.current?.click()}>
            Choose the TeslaCam folder
          </Button>
          <p className="text-xs text-faint">
            Pick the drive's <code>TeslaCam</code> folder, or the drive itself. Your browser will ask to confirm uploading
            the files to this server.
          </p>
        </div>
      )}

      {phase === 'ready' && check && (
        <div className="space-y-3 rounded-xl border border-line p-4">
          {check.missing.length === 0 ? (
            <p className="text-sm">Everything in that folder is already in your library.</p>
          ) : (
            <p className="text-sm">
              <strong>{check.missing.length.toLocaleString()} new files</strong> ({formatBytes(check.missingBytes)}) to upload.
              {check.alreadyThere > 0 && <span className="text-dim"> {check.alreadyThere.toLocaleString()} are already in the library.</span>}
            </p>
          )}
          {check.ignored > 0 && (
            <p className="text-xs text-faint">
              {check.ignored === 1 ? "1 file that isn't a Tesla clip" : `${check.ignored.toLocaleString()} files that aren't Tesla clips`} will be left out.
            </p>
          )}
          <div className="flex gap-2">
            {check.missing.length > 0 && (
              <Button variant="primary" icon={<Upload className="size-4" />} onClick={upload}>
                Upload {formatBytes(check.missingBytes)}
              </Button>
            )}
            <Button variant="ghost" onClick={() => input.current?.click()}>
              Choose another folder
            </Button>
          </div>
        </div>
      )}

      {phase === 'uploading' && check && (
        <div className="space-y-2 rounded-xl border border-line p-4">
          <p className="tabular text-sm">
            Uploading {uploaded.toLocaleString()} of {check.missing.length.toLocaleString()} files · {formatBytes(sent)} of {formatBytes(check.missingBytes)}
          </p>
          <ProgressBar value={check.missingBytes ? sent / check.missingBytes : 0} />
          <p className="text-xs text-faint">Keep this window open until it finishes.</p>
          <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>
            Stop
          </Button>
        </div>
      )}

      {phase === 'done' && (
        <Done>
          Uploaded {uploaded === 1 ? '1 file' : `${uploaded.toLocaleString()} files`}. New events appear in the library within two minutes, and thumbnails follow
          shortly after.
        </Done>
      )}

      {error && <p className="text-sm text-accent-hover">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Desktop app: the server reads the drive directly.

function DesktopImport({ initialSource }: { initialSource?: string }) {
  const refreshLibrary = useRefreshLibrary()
  const drives = useQuery({ queryKey: ['import-drives'], queryFn: api.importDrives, refetchInterval: 4000 })
  const status = useQuery({
    queryKey: ['import-status'],
    queryFn: api.importStatus,
    refetchInterval: (q) => (q.state.data?.running ? 800 : false),
  })
  const [source, setSource] = useState<string | null>(null)
  const [plan, setPlan] = useState<{ files: number; bytes: number; alreadyThere: number; encrypted: number } | null>(null)
  const [deleteAfter, setDeleteAfter] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const wasRunning = useRef(false)

  const s = status.data
  useEffect(() => {
    if (wasRunning.current && s && !s.running) refreshLibrary()
    wasRunning.current = !!s?.running
  }, [s, refreshLibrary])

  async function choose(folder: string | null) {
    if (!folder) return
    setError(null)
    setPlan(null)
    setSource(folder)
    setBusy(true)
    try {
      setPlan(await api.importPlan(folder))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setSource(null)
    } finally {
      setBusy(false)
    }
  }

  // Opened from the notice that a drive was plugged in: go straight to that drive.
  useEffect(() => {
    if (initialSource) choose(initialSource)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSource])

  async function start() {
    if (!source) return
    setError(null)
    try {
      await api.importFolder(source, deleteAfter)
      setPlan(null)
      setSource(null)
      await status.refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  if (s?.running) return <Progress status={s} />

  return (
    <div className="space-y-4">
      <Intro />
      {s?.finishedUtc && !source && <Finished status={s} />}

      {!source && (
        <>
          <div className="space-y-2">
            <p className="label">Drives with Tesla clips</p>
            {drives.isPending ? (
              <Spinner />
            ) : drives.data && drives.data.length > 0 ? (
              drives.data.map((d) => (
                <button
                  key={d.path}
                  onClick={() => choose(d.path)}
                  className="flex w-full items-center gap-3 rounded-xl border border-line p-3 text-left transition-colors hover:border-line-strong hover:bg-raised"
                >
                  <HardDrive className="size-5 shrink-0 text-dim" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.name}</span>
                  <span className="text-xs text-faint">
                    {d.newFiles > 0 ? `${d.newFiles.toLocaleString()} new · ${formatBytes(d.newBytes)}` : 'Nothing new'}
                  </span>
                </button>
              ))
            ) : (
              <p className="text-sm text-faint">None found. Plug in the car's USB drive and it will appear here.</p>
            )}
          </div>
          <Button icon={<FolderOpen className="size-4" />} onClick={async () => choose((await desktopBridge()?.pickFolder('Choose the TeslaCam folder or the drive')) ?? null)}>
            Choose a folder…
          </Button>
        </>
      )}

      {source && (
        <div className="space-y-3 rounded-xl border border-line p-4">
          <p className="truncate text-sm font-medium">{source}</p>
          {busy || !plan ? (
            <Spinner />
          ) : plan.files === 0 ? (
            <p className="text-sm">Nothing new here: everything on it is already in your library.</p>
          ) : (
            <p className="text-sm">
              <strong>{plan.files.toLocaleString()} new files</strong> ({formatBytes(plan.bytes)}) to copy.
              {plan.alreadyThere > 0 && <span className="text-dim"> {plan.alreadyThere.toLocaleString()} are already in the library.</span>}
            </p>
          )}
          {plan && plan.encrypted > 0 && (
            <p className="flex items-start gap-2 rounded-lg bg-warn/10 p-3 text-[13px]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
              <span>
                {plan.encrypted === 1
                  ? "1 clip was encrypted by the car and can't be imported. It stays on the drive."
                  : `${plan.encrypted.toLocaleString()} clips were encrypted by the car and can't be imported. They stay on the drive.`}{' '}
                <Link to="/help#encryption" className="underline">
                  How to turn encryption off
                </Link>
              </span>
            </p>
          )}
          {plan && (
            <div className="flex items-start justify-between gap-4 border-t border-line pt-3">
              <div>
                <p className="text-[13px] font-medium">Clear the clips from the drive afterwards</p>
                <p className="mt-0.5 text-xs text-faint">
                  Frees the drive for the car. Only files that are safely in the library are removed.
                </p>
              </div>
              <Toggle label="Clear the clips from the drive afterwards" checked={deleteAfter} onChange={setDeleteAfter} />
            </div>
          )}
          <div className="flex gap-2">
            {plan && (plan.files > 0 || deleteAfter) && (
              <Button variant="primary" onClick={start}>
                {plan.files > 0 ? `Import ${formatBytes(plan.bytes)}` : 'Clear the drive'}
              </Button>
            )}
            <Button variant="ghost" onClick={() => { setSource(null); setPlan(null) }}>
              Back
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-accent-hover">{error}</p>}
    </div>
  )
}

function Progress({ status }: { status: ImportStatus }) {
  return (
    <div className="space-y-3">
      <p className="truncate text-sm text-dim">From {status.source}</p>
      <p className="tabular text-sm">
        Copying {status.doneFiles.toLocaleString()} of {status.totalFiles.toLocaleString()} files · {formatBytes(status.doneBytes)} of{' '}
        {formatBytes(status.totalBytes)}
      </p>
      <ProgressBar value={status.totalBytes ? status.doneBytes / status.totalBytes : 0} />
      <p className="text-xs text-faint">You can close this window; the copy carries on. Don't unplug the drive until it finishes.</p>
      <Button size="sm" variant="ghost" onClick={() => api.importCancel()}>
        Stop
      </Button>
    </div>
  )
}

function Finished({ status }: { status: ImportStatus }) {
  if (status.error) return <p className="text-sm text-accent-hover">The last import stopped: {status.error}</p>
  return (
    <Done>
      {status.canceled ? 'The last import was stopped after' : 'Last import:'} {status.doneFiles.toLocaleString()} files copied
      {status.failed > 0 && `, ${status.failed} could not be read`}
      {status.deleteAfter && `, ${status.deleted.toLocaleString()} cleared from the drive`}. It's safe to unplug the drive; new events
      appear within two minutes.
    </Done>
  )
}

function Done({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-ok/10 p-3 text-sm">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />
      <span>{children}</span>
    </p>
  )
}
