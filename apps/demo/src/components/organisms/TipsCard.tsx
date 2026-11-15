import { Card } from '../atoms/Card'
import { TipList } from '../molecules/TipList'
import { useTips } from '../../hooks/useTips'

/** Asks for the tips and shows whichever state the request is in. */
export function TipsCard() {
  const { data, error, isPending } = useTips()
  return (
    <Card>
      <h2>Loaded with a query</h2>
      {isPending && <p className="muted">Loading…</p>}
      {error && <p className="muted">Could not load the tips: {error.message}</p>}
      {data && <TipList tips={data} />}
    </Card>
  )
}
