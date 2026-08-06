import { describe, it, expect } from 'vitest'
import { UserFacingError, userMessage } from '../src/lib/errorMessages.ts'

describe('userMessage', () => {
  it('shows a UserFacingError message as written', () => {
    const error = new UserFacingError('You can only own one household.')
    expect(userMessage(error, 'Failed to create household.')).toBe('You can only own one household.')
  })

  it('masks raw Postgres error text with the fallback', () => {
    const error = {
      message: 'duplicate key value violates unique constraint "households_one_per_owner"',
      code: '23505',
    }
    expect(userMessage(error, 'Failed to create household.')).toBe('Failed to create household.')
  })

  it('masks permission-denied text, which names the table', () => {
    const error = { message: 'permission denied for table shopping_list_items' }
    expect(userMessage(error, 'Could not update that item.')).toBe('Could not update that item.')
  })

  it('masks a plain Error, so only a tagged one is ever trusted', () => {
    expect(userMessage(new Error('relation "profiles" does not exist'), 'Failed.')).toBe('Failed.')
  })

  it('falls back for null/undefined errors', () => {
    expect(userMessage(null, 'Failed.')).toBe('Failed.')
    expect(userMessage(undefined, 'Failed.')).toBe('Failed.')
  })

  it('keeps UserFacingError instanceof Error, so existing catch/throw paths still work', () => {
    expect(new UserFacingError('x')).toBeInstanceOf(Error)
  })
})
