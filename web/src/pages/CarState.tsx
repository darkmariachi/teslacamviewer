import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { carQuery } from '../api'
import { Car, ChevronRight } from 'lucide-react'
import { formatRelative } from '../lib/format'
import { Button, Card } from '../components/ui'

/**
 * car-logger's place in Admin → Car: what it would add when it isn't set up, and once it is, a short
 * summary that leads to the Car page.
 */
export default function CarState({ onSetUp }: { onSetUp: () => void }) {
  const car = useQuery(carQuery)
  if (!car.data) return null
  const c = car.data
  if (!c.configured) {
    return (
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <Car className="size-6 shrink-0 text-dim" />
        <p className="min-w-0 flex-1 text-sm text-dim">
          With car-logger on the teslausb Pi, the app also shows the car's battery, charging, locks, doors and tire pressures. See{' '}
          <a href="/help#car-logger" className="text-fg underline">
            Help
          </a>
          .
        </p>
        <Button size="sm" onClick={onSetUp}>
          Add the token
        </Button>
      </Card>
    )
  }
  const battery = c.now?.battery?.level
  return (
    <Link to="/car" className="block">
      <Card className="flex items-center gap-4 p-5 transition-colors hover:bg-raised">
        <Car className="size-6 shrink-0 text-dim" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{battery != null ? `Battery ${battery}%` : 'The car'}</p>
          <p className="text-sm text-dim">
            {c.now ? `Last reading ${formatRelative(c.lastReading)} from car-logger.` : 'car-logger is set up; no readings yet.'}
            {c.error && <span className="text-warn"> {c.error}</span>}
          </p>
        </div>
        <ChevronRight className="size-5 text-dim" />
      </Card>
    </Link>
  )
}
