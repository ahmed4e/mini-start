import { useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'theme'

function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

/**
 * The chosen theme, remembered across visits. "system" follows the device.
 * The choice is written to <html data-theme>, which src/styles.css reads.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(storedTheme)

  useEffect(() => {
    const root = document.documentElement
    try {
      if (theme === 'system') {
        delete root.dataset.theme
        localStorage.removeItem(STORAGE_KEY)
      } else {
        root.dataset.theme = theme
        localStorage.setItem(STORAGE_KEY, theme)
      }
    } catch {
      // Storage can be blocked; the theme still applies for this visit.
    }
  }, [theme])

  return [theme, setTheme] as const
}
