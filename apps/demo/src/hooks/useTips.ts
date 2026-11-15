import { useQuery } from '@tanstack/react-query'
import { getJson } from '../lib/api'

export interface Tip {
  id: number
  text: string
}

/** Loads the tips once and caches them. Components get data, loading and error state. */
export function useTips() {
  return useQuery({
    queryKey: ['tips'],
    queryFn: () => getJson<Tip[]>('/tips.json'),
  })
}
