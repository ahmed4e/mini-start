import { Link } from 'react-router'
import { Card } from '../atoms/Card'

export function NotFoundPage() {
  return (
    <Card>
      <h1>Page not found</h1>
      <p className="muted">There is no page at this address.</p>
      <Link to="/">Back home</Link>
    </Card>
  )
}
