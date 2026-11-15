import type { ReactNode } from 'react'
import { Link } from 'react-router'
import styles from './SiteHeader.module.css'

interface Props {
  name: string
  /** Links, shown next to the name. */
  children?: ReactNode
  /** Controls, pushed to the far side. */
  actions?: ReactNode
}

/** The bar at the top of every page. */
export function SiteHeader({ name, children, actions }: Props) {
  return (
    <header className={styles.header}>
      <Link to="/" className={styles.brand}>
        {name}
      </Link>
      {children && <nav>{children}</nav>}
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  )
}
