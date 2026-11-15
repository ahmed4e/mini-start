import { Card } from '../atoms/Card'
import { Counter } from '../molecules/Counter'
import { useCounterStore } from '../../stores/counterStore'

/** Reads the count from the store and hands it to <Counter>, which only displays it. */
export function CounterCard() {
  const count = useCounterStore((state) => state.count)
  const increment = useCounterStore((state) => state.increment)
  return (
    <Card>
      <h2>Try it</h2>
      <p className="muted">The count lives in a store, so every component that asks for it sees the same number.</p>
      <Counter count={count} onIncrement={increment} />
    </Card>
  )
}
