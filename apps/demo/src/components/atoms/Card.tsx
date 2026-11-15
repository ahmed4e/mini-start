import type { ReactNode } from 'react'
import styles from './Card.module.css'

/** A bordered surface that groups related content. */
export function Card({ children }: { children: ReactNode }) {
  return <section className={styles.card}>{children}</section>
}
