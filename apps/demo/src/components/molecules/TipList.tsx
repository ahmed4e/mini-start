import type { Tip } from '../../hooks/useTips'
import styles from './TipList.module.css'

export function TipList({ tips }: { tips: Tip[] }) {
  return (
    <ul className={styles.tips}>
      {tips.map((tip) => (
        <li key={tip.id}>{tip.text}</li>
      ))}
    </ul>
  )
}
