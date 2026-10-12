import { EventBrowser } from '../components/EventBrowser'
import { PageHeader } from '../components/ui'

export default function EventsPage() {
  return (
    <>
      <PageHeader title="Events" />
      <EventBrowser />
    </>
  )
}
