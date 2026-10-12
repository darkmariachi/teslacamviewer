import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { Button, Field, inputClass } from '../components/ui'

/** Sign-in, or on first run the screen where the owner chooses the password. */
export default function LoginPage({ setup }: { setup: boolean }) {
  const queryClient = useQueryClient()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (setup && password !== repeat) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await (setup ? api.setup(password) : api.login(password))
      await queryClient.refetchQueries({ queryKey: ['auth'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgb(232_33_39/0.16),transparent)]" />
      <form onSubmit={submit} className="rise relative w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center gap-5">
          <svg viewBox="0 0 64 64" className="size-14" aria-hidden>
            <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" strokeWidth="4" />
            <circle cx="32" cy="32" r="9" fill="var(--color-accent)" />
          </svg>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-[0.3em]">TESLACAM</h1>
            <p className="mt-2 text-sm text-dim">{setup ? 'Choose a password to protect your clips.' : 'Sign in to view your clips.'}</p>
          </div>
        </div>
        <div className="space-y-4">
          <Field label={setup ? 'New password' : 'Password'} hint={setup ? 'At least 8 characters.' : undefined}>
            <input
              type="password"
              autoFocus
              autoComplete={setup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass + ' h-12'}
            />
          </Field>
          {setup && (
            <Field label="Repeat password">
              <input
                type="password"
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                className={inputClass + ' h-12'}
              />
            </Field>
          )}
          {error && <p className="text-sm text-accent-hover">{error}</p>}
          <Button type="submit" variant="primary" busy={busy} disabled={!password} className="h-12 w-full">
            {setup ? 'Set password' : 'Sign in'}
          </Button>
        </div>
      </form>
    </div>
  )
}
