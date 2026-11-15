import { Button } from '../atoms/Button'
import styles from './Counter.module.css'

/** Shows a count and asks for one more. It holds no state: the parent owns the number. */
export function Counter({ count, onIncrement }: { count: number; onIncrement: () => void }) {
  return (
    <div className={styles.counter}>
      <Button onClick={onIncrement}>Add one</Button>
      <span>
        Clicked {count} {count === 1 ? 'time' : 'times'}
      </span>
    </div>
  )
}
