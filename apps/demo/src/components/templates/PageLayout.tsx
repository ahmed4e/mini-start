import type { ReactNode } from 'react'
import { SiteHeader } from '../organisms/SiteHeader'
import styles from './PageLayout.module.css'

interface Props {
  name: string
  nav?: ReactNode
  actions?: ReactNode
  children: ReactNode
}

/** The frame every page shares: the site header and the content column. */
export function PageLayout({ name, nav, actions, children }: Props) {
  return (
    <>
      <SiteHeader name={name} actions={actions}>
        {nav}
      </SiteHeader>
      <main className={styles.container}>{children}</main>
    </>
  )
}
