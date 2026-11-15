import { type Theme, useTheme } from '../../hooks/useTheme'
import styles from './ThemeToggle.module.css'

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const LABEL: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' }

/** Cycles system → light → dark. */
export function ThemeToggle() {
  const [theme, setTheme] = useTheme()
  return (
    <button type="button" className={styles.toggle} onClick={() => setTheme(NEXT[theme])}>
      Theme: {LABEL[theme]}
    </button>
  )
}
