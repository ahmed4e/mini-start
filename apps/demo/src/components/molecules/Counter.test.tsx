import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Counter } from './Counter'

test('shows the count and reports a click', async () => {
  const onIncrement = vi.fn()
  render(<Counter count={1} onIncrement={onIncrement} />)

  expect(screen.getByText('Clicked 1 time')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Add one' }))
  expect(onIncrement).toHaveBeenCalledOnce()
})
