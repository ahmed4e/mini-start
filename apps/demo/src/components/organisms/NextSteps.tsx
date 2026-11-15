import { Card } from '../atoms/Card'
import styles from './NextSteps.module.css'

export function NextSteps() {
  return (
    <Card>
      <h2>Next steps</h2>
      <ul className={styles.steps}>
        <li>
          Change this page: edit <code>src/components/pages/HomePage.tsx</code>.
        </li>
        <li>
          Add a component: put it in <code>atoms</code>, <code>molecules</code> or <code>organisms</code>, by how much it is made of.
        </li>
        <li>
          Style it: each component's styles are in the <code>.module.css</code> file next to it. Colors
          are in <code>src/styles.css</code>.
        </li>
        <li>
          Ship it: <code>pnpm build</code> writes the site to{' '}
          <code>dist</code>.
        </li>
      </ul>
    </Card>
  )
}
