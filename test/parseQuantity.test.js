// A count typed with the name. The failure that matters is the silent one: a
// product renamed because a number in its name was read as a count.
import { describe, it, expect } from 'vitest'
import { parseQuantity } from '../src/lib/productSearch'

describe('parseQuantity', () => {
  it.each([
    ['6 ouă', 'ouă', 6],
    ['6x ouă', 'ouă', 6],
    ['6 x ouă', 'ouă', 6],
    ['ouă x6', 'ouă', 6],
    ['ouă × 6', 'ouă', 6],
    ['12 iaurt grecesc', 'iaurt grecesc', 12],
  ])('reads %s as %s ×%i', (text, name, quantity) => {
    expect(parseQuantity(text)).toEqual({ name, quantity })
  })

  it.each(['Cola 2', 'Vitamina B12', 'Pampers 4', 'Lapte 1.5%', '7up', 'Apa 0.5 L', 'lapte'])(
    'leaves %s alone',
    (text) => {
      expect(parseQuantity(text)).toEqual({ name: text, quantity: 1 })
    },
  )

  it('ignores a count of zero or past the cap', () => {
    expect(parseQuantity('0 mere')).toEqual({ name: '0 mere', quantity: 1 })
    expect(parseQuantity('1000 mere')).toEqual({ name: '1000 mere', quantity: 1 })
  })
})
