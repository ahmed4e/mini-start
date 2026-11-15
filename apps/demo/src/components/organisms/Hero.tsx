import styles from './Hero.module.css'

export function Hero({ name }: { name: string }) {
  return (
    <section className={styles.hero}>
      <h1>Welcome to {name}</h1>
      <p>
        Your app is running. Edit <code>src/components/pages/HomePage.tsx</code> and save to see this page
        update.
      </p>
    </section>
  )
}
