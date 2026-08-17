// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import InputRow from '../src/components/InputRow.vue'

// InputRow wraps its <input> in a styled <div>, which is where undeclared
// attributes land by default — silently doing nothing. That is not hypothetical:
// `required` and `autofocus` were once lost exactly this way and the household
// setup screen quietly stopped focusing its field, with nothing failing. These
// cover the fall-through staying pointed at the input.
describe('InputRow attribute fall-through', () => {
  it('puts bare required/autofocus on the input, not the wrapper', () => {
    const wrapper = mount(InputRow, { attrs: { required: '', autofocus: '' } })
    const input = wrapper.find('input')
    expect(input.attributes('required')).toBeDefined()
    expect(input.attributes('autofocus')).toBeDefined()
    expect(wrapper.find('.input-row').attributes('required')).toBeUndefined()
  })

  // The point of inheritAttrs:false over a prop per attribute: the next one
  // added works without anyone having to notice it needs declaring.
  it('carries an undeclared attribute through to the input too', () => {
    const wrapper = mount(InputRow, { attrs: { inputmode: 'numeric' } })
    expect(wrapper.find('input').attributes('inputmode')).toBe('numeric')
  })
})
