// @vitest-environment happy-dom
//
// The escape hatch for products the catalog doesn't have. It is the only way to
// give a hand-typed item a maker, so the maker must survive the round trip, and
// a reopen must never carry a previous product's maker onto a new one.
import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import CustomProductModal from '../src/components/CustomProductModal.vue'

function fields(wrapper) {
  const inputs = wrapper.findAll('input')
  return { name: inputs[0], maker: inputs[1] }
}

async function openWith(initialName = '') {
  const wrapper = mount(CustomProductModal, { props: { open: false, initialName } })
  await wrapper.setProps({ open: true })
  await flushPromises()
  return wrapper
}

describe('CustomProductModal', () => {
  it('renders nothing while closed', () => {
    const wrapper = mount(CustomProductModal, { props: { open: false } })
    expect(wrapper.find('.custom-product-dialog').exists()).toBe(false)
  })

  it('prefills the product with what was already typed', async () => {
    const wrapper = await openWith('Branza de burduf')
    expect(fields(wrapper).name.element.value).toBe('Branza de burduf')
  })

  it('submits the product and the maker together', async () => {
    const wrapper = await openWith('Branza de burduf')
    await fields(wrapper).maker.setValue('Piata Obor')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.emitted('submit')[0][0]).toEqual({
      name: 'Branza de burduf',
      maker: 'Piata Obor',
    })
  })

  it('treats a blank maker as none rather than an empty string', async () => {
    const wrapper = await openWith('Branza de burduf')
    await fields(wrapper).maker.setValue('   ')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.emitted('submit')[0][0].maker).toBeNull()
  })

  it('trims surrounding whitespace off both fields', async () => {
    const wrapper = await openWith('')
    await fields(wrapper).name.setValue('  Branza de burduf  ')
    await fields(wrapper).maker.setValue('  Piata Obor  ')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.emitted('submit')[0][0]).toEqual({
      name: 'Branza de burduf',
      maker: 'Piata Obor',
    })
  })

  it('cannot be submitted without a product name', async () => {
    const wrapper = await openWith('   ')
    expect(wrapper.find('.app-btn--primary').attributes('disabled')).toBeDefined()

    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('caps the fields at the lengths the DB rows accept', async () => {
    const wrapper = await openWith('')
    expect(fields(wrapper).name.attributes('maxlength')).toBe('120')
    expect(fields(wrapper).maker.attributes('maxlength')).toBe('60')
  })

  it('starts clean on reopen, so a maker cannot stick to the next product', async () => {
    const wrapper = mount(CustomProductModal, { props: { open: false, initialName: 'Branza' } })
    await wrapper.setProps({ open: true })
    await flushPromises()
    await fields(wrapper).maker.setValue('Piata Obor')

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true, initialName: 'Telemea' })
    await flushPromises()

    expect(fields(wrapper).name.element.value).toBe('Telemea')
    expect(fields(wrapper).maker.element.value).toBe('')
  })

  it('cancels from the button and from a click outside the dialog', async () => {
    const wrapper = await openWith('Branza')
    await wrapper.find('.app-btn--secondary').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)

    await wrapper.find('.custom-product-overlay').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(2)
  })
})
