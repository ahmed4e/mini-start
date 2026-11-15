import { CounterCard } from '../organisms/CounterCard'
import { Hero } from '../organisms/Hero'
import { NextSteps } from '../organisms/NextSteps'
import { TipsCard } from '../organisms/TipsCard'

export function HomePage() {
  return (
    <>
      <Hero name="demo" />
      <CounterCard />
      <TipsCard />
      <NextSteps />
    </>
  )
}
