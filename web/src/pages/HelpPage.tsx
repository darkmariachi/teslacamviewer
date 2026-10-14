import { useEffect, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { authQuery } from '../api'
import { Card, PageHeader } from '../components/ui'

const SECTIONS = [
  { id: 'getting-clips-in', title: 'Getting clips in' },
  { id: 'library-folder', title: 'Your library folder' },
  { id: 'encryption', title: "The car's dashcam settings" },
  { id: 'watching', title: 'Watching an event' },
  { id: 'saving-space', title: 'Saving space' },
  { id: 'teslausb', title: 'teslausb' },
  { id: 'phone', title: 'Using it from a phone' },
  { id: 'privacy', title: 'Privacy' },
  { id: 'troubleshooting', title: 'Troubleshooting' },
]

/** The user guide, inside the app. The README covers installing; this covers using it. */
export default function HelpPage() {
  const desktop = useQuery(authQuery).data?.desktop ?? false
  const location = useLocation()

  // Links such as /help#teslausb land on their section.
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView()
  }, [location.hash])

  return (
    <>
      <PageHeader title="Help" subtitle="How to get clips in, find what matters, and keep the library tidy." />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="hidden lg:block">
          <ul className="sticky top-[calc(2rem+var(--tb))] space-y-1 text-sm">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="block rounded-md px-2 py-1.5 text-dim hover:bg-raised hover:text-fg">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="max-w-3xl space-y-5">
          <Section id="getting-clips-in" title="Getting clips in">
            <p>
              Your Tesla saves its recordings on the USB drive in the glovebox, in a folder called <Code>TeslaCam</Code>. There
              are three ways to bring them here:
            </p>
            <ol>
              <li>
                <strong>Import from the USB drive.</strong> Take the drive out of the car and plug it into{' '}
                {desktop ? 'this computer' : 'the computer you are using'}, then choose <strong>Import</strong> on the Events page.
                {desktop
                  ? ' The drive is listed as soon as it is plugged in. You can have its clips cleared afterwards, so the car has room again.'
                  : ' Choose the drive or its TeslaCam folder, and the new clips are uploaded to the server.'}{' '}
                Clips that are already in the library are skipped, so importing the same drive twice is harmless.
              </li>
              <li>
                <strong>Automatically, with teslausb.</strong> A small computer in the car pretends to be the USB drive and copies
                new clips to your network whenever the car gets home. See <a href="#teslausb">teslausb</a> below.
              </li>
              <li>
                <strong>Copy them yourself.</strong>{' '}
                {desktop
                  ? 'Copy the SentryClips, SavedClips or RecentClips folders into the library folder shown in Admin → Library.'
                  : 'Copy the SentryClips, SavedClips or RecentClips folders into the clip folder the server was set up with.'}{' '}
                The folder is checked every few minutes; Admin → Library → Scan now checks straight away. Dragging the drive's
                whole TeslaCam folder in works too.
              </li>
            </ol>
            <p>
              Sentry events and saved clips each become one event. Recent clips (the car's rolling dashcam footage) are grouped
              into drives wherever recording stopped for a while.
            </p>
          </Section>

          <Section id="library-folder" title="Your library folder">
            {desktop ? (
              <>
                <p>
                  The library is one folder of clips. When the app first opens it asks whether to start a new one or to use a
                  folder where you already keep your clips; nothing is copied or moved in that case. Admin → Library shows the
                  folder and can switch to another. Each folder keeps its own notes, favorites and collections, so switching
                  back loses nothing.
                </p>
                <p>
                  When the car's USB drive is plugged in, or was already plugged in when the app opened, the app offers to import
                  whatever on it is new. Importing never adds a clip twice: anything already in the library is skipped, wherever
                  it came from.
                </p>
              </>
            ) : (
              <p>
                The library is the clip folder the server was set up with. Everything in it is shown, including a TeslaCam folder
                dropped inside it.
              </p>
            )}
            <p>
              <strong>If you copied or moved clips while the app was closed,</strong> they are picked up when it opens: the folder
              is read again at start. If the drive is still plugged in, only what didn't make it across is offered for import, and
              "Clear the clips from the drive afterwards" then removes what is safely in the library. A copy that was interrupted
              is finished by importing again, since a file with the wrong size is copied again.
            </p>
            <p>
              <strong>If the folder goes missing,</strong> for example because it is on a drive that is unplugged, the app says so
              and keeps everything it knows. The library comes back by itself when the folder does. A folder on the car's own
              drive is a poor home for the library for the same reason: choose one on {desktop ? 'this computer' : 'the server'} and
              import from the drive instead.
            </p>
          </Section>

          <Section id="encryption" title="The car's dashcam settings">
            <p>
              Newer Tesla software can encrypt dashcam recordings (Controls → Safety → <strong>Encrypt Dashcam Recordings</strong>).
              Encrypted clips go into an <Code>EncryptedClips</Code> folder that only the car, or Tesla's own website, can open, so
              they can't be shown here. Turn the setting off if you want your clips in this library. Recordings made while it was
              on stay encrypted.
            </p>
            <p>Don't use "Format USB Drive" in the car if you use teslausb: it would wipe the drive teslausb manages.</p>
          </Section>

          <Section id="watching" title="Watching an event">
            <ul>
              <li>Every camera plays in sync on one timeline. Click a camera to make it the large view, or switch to Merged.</li>
              <li>The red mark on the timeline is the moment the car was triggered, and playback starts just before it.</li>
              <li>Hovering an event card plays the car's own few seconds around the trigger, when the car saved them.</li>
              <li>The scissors select a range to export, from one camera or as a grid.</li>
            </ul>
            <table className="mt-3 w-full text-left text-[13px]">
              <tbody className="divide-y divide-line">
                {[
                  ['Space', 'Play / pause'],
                  ['← →', '5 seconds back / forward (with Shift: 1 second)'],
                  ['1 – 6', 'Choose a camera'],
                  ['G', 'Merged view'],
                  ['T', 'Jump to the trigger'],
                  ['F', 'Full screen'],
                ].map(([key, action]) => (
                  <tr key={key}>
                    <td className="w-28 py-1.5 font-mono text-fg">{key}</td>
                    <td className="py-1.5">{action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section id="saving-space" title="Saving space">
            <ul>
              <li>
                <strong>Trim.</strong> Newer cars save ten minutes of lead-up with each Sentry event. Trim (in an event's menu, or
                for many events in selection mode) keeps only the minutes around the trigger. Admin → Settings sets how much.
              </li>
              <li>
                <strong>Delete.</strong> Deleted events go to a trash folder inside the clip folder and can be restored from Admin
                → Trash until the retention period ends. Admin → Trash can also clear out old events, always keeping favorites
                and anything in a collection.
              </li>
              <li>
                <strong>Sentry at home.</strong> If Sentry stays on at home, mark an event there with "This is home" (in its menu)
                and turn on the clean-up in Admin → Settings. Sentry events at home then go to the trash after a few days, except
                favorites, events in a collection and bumps.
              </li>
              <li>
                <strong>Merged videos</strong> take extra space. Admin → Settings chooses which events get one automatically.
              </li>
            </ul>
          </Section>

          <Section id="teslausb" title="teslausb">
            <p>
              <a href="https://github.com/marcone/teslausb" target="_blank" rel="noreferrer">teslausb</a> runs on a Raspberry Pi
              plugged into the car's USB port. It stores the car's recordings and, whenever the car is on your home Wi-Fi, copies
              new ones to a shared folder. Point this app's clip folder at that share.
            </p>
            <ol>
              <li>Turn on Admin → Settings → teslausb. A Car tab appears in Admin.</li>
              <li>
                In Admin → Car, enter teslausb's address (usually <Code>http://teslausb.local</Code>). The app then shows whether
                the car is home, its Wi-Fi, temperature, power and storage.
              </li>
              <li>
                Copy the two webhook lines shown there into teslausb's <Code>teslausb_setup_variables.conf</Code> and run its setup
                again, so every upload is announced here and new clips appear right away.
              </li>
            </ol>
            <p>
              Cars switch the USB port off shortly after you walk away, which can stop an upload halfway. Leaving Sentry on at
              home keeps the port powered; the Sentry at home clean-up then removes the walk-past recordings for you.
            </p>
          </Section>

          <Section id="phone" title="Using it from a phone">
            {desktop ? (
              <p>
                The desktop app only answers on this computer, so other devices can't open it. To watch from your phone or
                anywhere else, run the server version on a computer that stays on, such as a NAS or home server. The README
                explains how.
              </p>
            ) : (
              <>
                <p>
                  On your home network, open the same address on your phone; the app is made for small screens too. Add it to your
                  home screen to open it like an app.
                </p>
                <p>
                  Away from home, the safest way in is a private network such as{' '}
                  <a href="https://tailscale.com" target="_blank" rel="noreferrer">
                    Tailscale
                  </a>{' '}
                  on the server and your phone: nothing is opened to the internet. If you would rather publish it, put it behind a
                  reverse proxy with HTTPS. The app has a password and slows down repeated wrong guesses, but footage of your car and
                  its surroundings deserves care.
                </p>
              </>
            )}
          </Section>

          <Section id="privacy" title="Privacy">
            <p>Your clips never leave {desktop ? 'this computer' : 'your server'}. There is no account, no analytics and no telemetry.</p>
            <ul>
              <li>Map tiles come from OpenFreeMap, which sees the area of the map you are looking at.</li>
              {desktop && <li>The app asks GitHub whether a newer version exists, and downloads it if so.</li>}
              <li>If you set a webhook, new Sentry events are announced to the address you entered.</li>
              <li>If you use teslausb, the app talks to it on your home network.</li>
            </ul>
          </Section>

          <Section id="troubleshooting" title="Troubleshooting">
            <dl className="space-y-3">
              <Item q="New clips don't show up.">
                Folders that are still being written are skipped for 90 seconds. Admin → Library → Scan now looks again straight away,
                and shows an error if the clip folder can't be read.
              </Item>
              <Item q="A clip doesn't play.">
                Some cars record in HEVC, which not every browser plays. The event's page offers to make compatible copies; the
                originals are not changed.
              </Item>
              <Item q="Processing is slow.">
                Merged videos are the slow part. Admin → Processing shows whether a graphics chip is used; Admin → Settings can lower
                the resolution, pick which events are merged and limit heavy work to the night.
              </Item>
              <Item q="The library is empty after choosing a folder.">
                The app looks for SentryClips, SavedClips or RecentClips in the folder, or in a TeslaCam folder inside it. Clips
                in an EncryptedClips folder can't be shown; see the car's dashcam settings above.
              </Item>
              <Item q="Import can't find the drive.">
                {desktop
                  ? 'Check that the drive opens in your file manager and has a TeslaCam folder, then choose it with "Choose a folder…".'
                  : 'Choose the TeslaCam folder itself rather than a file inside it. Very large imports are easier with the desktop app or by copying the folders to the server.'}
              </Item>
            </dl>
            <p>
              Still stuck? Open an issue on{' '}
              <a href="https://github.com/darkmariachi/teslacamviewer/issues" target="_blank" rel="noreferrer">
                GitHub
              </a>
              .
            </p>
          </Section>

          <p className="pb-4 text-xs text-faint">
            TeslaCam Viewer is an independent, open-source project. It is not affiliated with Tesla or teslausb.{' '}
            <Link to="/" className="underline">
              Back to events
            </Link>
          </p>
        </div>
      </div>
    </>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card className="scroll-mt-20 p-5 sm:p-6">
      <section id={id} className="space-y-3 text-sm leading-relaxed text-dim [&_a]:text-fg [&_a]:underline [&_li]:mt-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:text-fg [&_ul]:list-disc [&_ul]:pl-5">
        <h2 className="text-[17px] font-semibold text-fg">{title}</h2>
        {children}
      </section>
    </Card>
  )
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-raised px-1 py-0.5 font-mono text-[12px] text-fg">{children}</code>
}

function Item({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-medium text-fg">{q}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}
