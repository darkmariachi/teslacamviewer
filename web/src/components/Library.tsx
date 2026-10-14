// Where the library lives and how clips get into it: the import dialog everyone can open, the desktop app's
// first-run choice, the notice when the car's drive is plugged in, and the warning when the library is missing.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FolderOpen, FolderPlus, HardDrive, ShieldAlert, X } from 'lucide-react'
import { api, authQuery, desktopBridge, type FolderInfo } from '../api'
import { formatBytes } from '../lib/format'
import { Button, Modal, Spinner } from './ui'
import { ImportDialog } from './ImportDialog'

// ---------------------------------------------------------------------------------------------------------------
// Opening the import dialog from anywhere.

const ImportContext = createContext<{ open: (source?: string) => void; isOpen: boolean }>({ open: () => {}, isOpen: false })

export function ImportProvider({ desktop, children }: { desktop: boolean; children: ReactNode }) {
  const [state, setState] = useState<{ source?: string } | null>(null)
  return (
    <ImportContext.Provider value={{ open: (source) => setState({ source }), isOpen: state != null }}>
      {children}
      {state && <ImportDialog desktop={desktop} initialSource={state.source} onClose={() => setState(null)} />}
    </ImportContext.Provider>
  )
}

export const useImport = () => useContext(ImportContext)

// ---------------------------------------------------------------------------------------------------------------
// Choosing a folder the user already keeps clips in.

type Step =
  | { kind: 'idle' }
  | { kind: 'checking'; folder: string }
  | { kind: 'confirm'; folder: string; info: FolderInfo }
  | { kind: 'switching' }
  | { kind: 'error'; message: string }

/**
 * Picks a folder, looks at what is in it, and warns before using it: about removable drives (the car's own
 * drive in particular), folders with no clips, and clips the car encrypted. Nothing is copied or moved.
 */
export function ChooseLibraryFolder({ onDone, onCancel }: { onDone?: () => void; onCancel: () => void }) {
  const bridge = desktopBridge()
  const [step, setStep] = useState<Step>({ kind: 'idle' })

  async function pick() {
    const folder = await bridge?.pickFolder('Choose the folder that holds your TeslaCam clips')
    if (!folder) return
    setStep({ kind: 'checking', folder })
    try {
      setStep({ kind: 'confirm', folder, info: await api.importInspect(folder) })
    } catch (e) {
      setStep({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong' })
    }
  }

  async function use(folder: string) {
    setStep({ kind: 'switching' })
    onDone?.()
    // The app restarts its server on the new folder and reloads this window.
    if (!(await bridge?.setLibraryFolder(folder))) setStep({ kind: 'error', message: "That folder can't be used. Check that it still exists." })
  }

  // Pick straight away: this component only appears after someone asked to choose a folder.
  useEffect(() => {
    pick()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Modal title="Use a folder you already have" onClose={onCancel}>
      <div className="space-y-4 text-sm">
        {step.kind === 'idle' && (
          <Button icon={<FolderOpen className="size-4" />} onClick={pick}>
            Choose a folder…
          </Button>
        )}
        {(step.kind === 'checking' || step.kind === 'switching') && (
          <p className="flex items-center gap-2 text-dim">
            <Spinner className="size-4" /> {step.kind === 'checking' ? 'Looking at the folder…' : 'Opening the library…'}
          </p>
        )}
        {step.kind === 'error' && <p className="text-accent-hover">{step.message}</p>}
        {step.kind === 'confirm' && <Confirm folder={step.folder} info={step.info} onUse={() => use(step.folder)} onPickAgain={pick} />}
      </div>
    </Modal>
  )
}

function Confirm({ folder, info, onUse, onPickAgain }: { folder: string; info: FolderInfo; onUse: () => void; onPickAgain: () => void }) {
  if (info.isLibrary) {
    return (
      <>
        <p>That is already your library folder.</p>
        <Button variant="ghost" onClick={onPickAgain}>
          Choose another folder
        </Button>
      </>
    )
  }
  return (
    <>
      <p className="break-all font-medium">{folder}</p>
      {info.clipRoot ? (
        <p className="text-dim">
          {info.events > 0 ? `Found ${info.events.toLocaleString()} ${info.events === 1 ? 'event' : 'events'}.` : 'Found the TeslaCam folders, with no events in them yet.'} They
          stay where they are; nothing is copied or moved.
        </p>
      ) : (
        <p className="text-dim">
          No Tesla clips were found here. You can still use it: clips you import from the car's drive will be copied into it.
        </p>
      )}
      {info.removable && (
        <Warning>
          This folder is on a removable drive{info.clipRoot ? ', possibly the car’s own' : ''}. The library is only available while
          it is plugged in, and the car keeps recording onto its own drive. To keep clips safe, choose a folder on this computer
          and import from the drive instead.
        </Warning>
      )}
      {info.encrypted > 0 && (
        <Warning>
          {info.encrypted.toLocaleString()} clips here were encrypted by the car and can't be shown.{' '}
          <Link to="/help#encryption" className="underline">
            Why?
          </Link>
        </Warning>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={onUse}>
          {info.removable ? 'Use it anyway' : 'Use this folder'}
        </Button>
        <Button variant="ghost" onClick={onPickAgain}>
          Choose another folder
        </Button>
      </div>
    </>
  )
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-warn/10 p-3 text-[13px]">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
      <span>{children}</span>
    </p>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// The desktop app's first run: a new library, or a folder the user already has.

export function Welcome() {
  const bridge = desktopBridge()
  const [show, setShow] = useState(false)
  const [defaultFolder, setDefaultFolder] = useState('')
  const [choosing, setChoosing] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!bridge) return
    bridge.isFirstRun().then(setShow)
    bridge.defaultLibraryFolder().then(setDefaultFolder)
  }, [bridge])

  if (!bridge || !show) return null

  async function startNew() {
    setBusy(true)
    await bridge!.finishFirstRun()
    await bridge!.useDefaultLibraryFolder()
    setShow(false)
  }

  if (choosing) {
    return <ChooseLibraryFolder onDone={() => bridge.finishFirstRun()} onCancel={() => setChoosing(false)} />
  }

  return (
    <Modal title="Welcome to TeslaCam Viewer" onClose={startNew} wide>
      <div className="space-y-4 text-sm">
        <p className="text-dim">Where should your clips live?</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice
            icon={<FolderPlus className="size-5" />}
            title="Start a new library"
            onClick={startNew}
            disabled={busy}
          >
            Clips you import from the car's USB drive are copied to <span className="break-all text-fg">{defaultFolder}</span>.
          </Choice>
          <Choice icon={<FolderOpen className="size-5" />} title="Use a folder I already have" onClick={() => setChoosing(true)} disabled={busy}>
            Point the app at the folder where you keep your TeslaCam clips. Nothing is copied or moved.
          </Choice>
        </div>
        <p className="text-xs text-faint">
          Either way, when you plug in the car's USB drive the app offers to import the new clips into your library. You can
          change the folder later in Admin → Library.
        </p>
      </div>
    </Modal>
  )
}

function Choice({ icon, title, children, onClick, disabled }: { icon: ReactNode; title: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col gap-2 rounded-xl border border-line p-4 text-left transition-colors hover:border-line-strong hover:bg-raised disabled:opacity-50"
    >
      <span className="flex items-center gap-2 font-semibold text-fg">
        <span className="text-accent-hover">{icon}</span>
        {title}
      </span>
      <span className="text-[13px] text-dim">{children}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// The car's drive was plugged in.

/**
 * Desktop app only: when a drive with new clips appears, or was already plugged in when the app opened, offer to
 * import it. Each drive is offered once per set of new files, so "Not now" stays quiet until something changes.
 */
export function DriveNotice() {
  const { open, isOpen } = useImport()
  const drives = useQuery({ queryKey: ['import-drives'], queryFn: api.importDrives, refetchInterval: 5000 })
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  if (isOpen) return null
  const key = (d: { path: string; newFiles: number; encrypted: number }) => `${d.path}|${d.newFiles}|${d.encrypted}`
  const drive = drives.data?.find((d) => (d.newFiles > 0 || d.encrypted > 0) && !dismissed.has(key(d)))
  if (!drive) return null
  const dismiss = () => setDismissed(new Set(dismissed).add(key(drive)))

  return (
    <div className="rise fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 w-[min(380px,calc(100vw-2rem))] rounded-2xl border border-line-strong bg-raised/95 p-4 shadow-2xl backdrop-blur lg:bottom-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-accent-hover">{drive.newFiles > 0 ? <HardDrive className="size-5" /> : <ShieldAlert className="size-5" />}</span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="truncate font-semibold">{drive.name}</p>
          {drive.newFiles > 0 ? (
            <p className="text-dim">
              {drive.newFiles.toLocaleString()} new {drive.newFiles === 1 ? 'file' : 'files'} ({formatBytes(drive.newBytes)}) to bring into your library.
            </p>
          ) : (
            <p className="text-dim">
              Its clips are encrypted by the car, so they can't be imported.{' '}
              <Link to="/help#encryption" onClick={dismiss} className="text-fg underline">
                How to fix it
              </Link>
            </p>
          )}
          {drive.newFiles > 0 && (
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  dismiss()
                  open(drive.path)
                }}
              >
                Import
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss}>
                Not now
              </Button>
            </div>
          )}
        </div>
        <button aria-label="Dismiss" onClick={dismiss} className="text-faint hover:text-fg">
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// The library folder went missing.

/** Shown while the clip folder can't be found: an unplugged drive, an unmounted share, a renamed folder. */
export function LibraryMissing({ folder, desktop }: { folder: string | null; desktop: boolean }) {
  const queryClient = useQueryClient()
  const [choosing, setChoosing] = useState(false)
  return (
    <div className="mb-5 flex flex-wrap items-start gap-3 rounded-card border border-warn/40 bg-warn/5 p-4 text-sm">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{desktop ? 'Your library folder isn’t available' : 'The clip folder isn’t available'}</p>
        {desktop ? (
          <p className="text-dim">
            <span className="break-all text-fg">{folder ?? 'The folder'}</span> can't be found. If it's on a drive, plug it back in;
            the library comes back by itself. Nothing in the library is deleted while it's missing.
          </p>
        ) : (
          <p className="text-dim">
            The server can’t find its clip folder. Check that the drive or share is mounted into the container. Nothing in the
            library is deleted while it’s missing.
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => queryClient.invalidateQueries({ queryKey: authQuery.queryKey })}>
          Check again
        </Button>
        {desktop && (
          <Button size="sm" onClick={() => setChoosing(true)}>
            Choose another folder
          </Button>
        )}
      </div>
      {choosing && <ChooseLibraryFolder onCancel={() => setChoosing(false)} />}
    </div>
  )
}
