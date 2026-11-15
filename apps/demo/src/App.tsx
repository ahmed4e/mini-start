import { BrowserRouter, NavLink, Route, Routes } from 'react-router'
import { AboutPage } from './components/pages/AboutPage'
import { HomePage } from './components/pages/HomePage'
import { NotFoundPage } from './components/pages/NotFoundPage'
import { PageLayout } from './components/templates/PageLayout'
import { ThemeToggle } from './components/molecules/ThemeToggle'

export function App() {
  return (
    <BrowserRouter>
      <PageLayout
        name="demo"
        nav={
          <>
            <NavLink to="/" end>
              Home
            </NavLink>
            <NavLink to="/about">About</NavLink>
          </>
        }
        actions={<ThemeToggle />}
      >
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </PageLayout>
    </BrowserRouter>
  )
}
