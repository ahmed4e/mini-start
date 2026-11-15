import { create } from 'zustand'

interface CounterStore {
  count: number
  increment: () => void
}

/** The counter's state, shared by every component that asks for it. */
export const useCounterStore = create<CounterStore>()((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
}))
