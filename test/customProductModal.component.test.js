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
  return { name: inputs[0], maker: inputs[1], barcode: inputs[2] }
}

async function openWith(initialName = '', initialBarcode = '') {
  const wrapper = mount(CustomProductModal, {
    props: { open: false, initialName, initialBarcode },
  })
  await wrapper.setProps({ open: true })
  await flushPromises()
  return wrapper
}

const submitButton = (wrapper) => wrapper.find('.app-btn--primary')

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
      // Nothing scanned and nothing typed into the optional field. Sent as null
      // rather than omitted, the same way the maker is.
      barcode: null,
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
      barcode: null,
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

  // The optional barcode. It arrives filled from a scan the catalog could not
  // answer, and is typeable from scratch for a product on the counter — either
  // way it is what makes the next scan of that package find something.
  describe('the barcode', () => {
    it('opens with the code the scan found', async () => {
      const wrapper = await openWith('', '5941234567890')
      expect(fields(wrapper).barcode.element.value).toBe('5941234567890')
    })

    it('opens empty when the product was typed rather than scanned', async () => {
      const wrapper = await openWith('Branza de burduf')
      expect(fields(wrapper).barcode.element.value).toBe('')
    })

    it('sends a code typed in by hand', async () => {
      const wrapper = await openWith('Branza de burduf')
      await fields(wrapper).barcode.setValue('5941234567890')
      await wrapper.find('form').trigger('submit')

      expect(wrapper.emitted('submit')[0][0].barcode).toBe('5941234567890')
    })

    it('lets a scanned code be corrected before it is stored', async () => {
      // A misread digit would otherwise be saved against the product and send
      // every later scan of that package back to this same dialog.
      const wrapper = await openWith('Branza', '5941234567890')
      await fields(wrapper).barcode.setValue('5949999999999')
      await wrapper.find('form').trigger('submit')

      expect(wrapper.emitted('submit')[0][0].barcode).toBe('5949999999999')
    })

    it('lets a scanned code be cleared', async () => {
      const wrapper = await openWith('Branza', '5941234567890')
      await fields(wrapper).barcode.setValue('')
      await wrapper.find('form').trigger('submit')

      expect(wrapper.emitted('submit')[0][0].barcode).toBeNull()
    })

    it('refuses half a barcode rather than dropping it silently', async () => {
      // The server nulls out anything that is not 8-14 digits, which is right
      // for a fire-and-forget RPC and useless to someone watching the field:
      // they would think the code was saved.
      const wrapper = await openWith('Branza')
      await fields(wrapper).barcode.setValue('594')

      expect(submitButton(wrapper).attributes('disabled')).toBeDefined()
      expect(wrapper.find('.custom-product-hint').exists()).toBe(true)

      await wrapper.find('form').trigger('submit')
      expect(wrapper.emitted('submit')).toBeUndefined()
    })

    it('says nothing about an empty field, which is a valid answer', async () => {
      const wrapper = await openWith('Branza')
      expect(wrapper.find('.custom-product-hint').exists()).toBe(false)
      expect(submitButton(wrapper).attributes('disabled')).toBeUndefined()
    })

    it('starts clean on reopen, so a code cannot stick to the next product', async () => {
      const wrapper = await openWith('Branza', '5941234567890')

      await wrapper.setProps({ open: false })
      await wrapper.setProps({ open: true, initialName: 'Telemea', initialBarcode: '' })
      await flushPromises()

      expect(fields(wrapper).barcode.element.value).toBe('')
    })
  })

  it('cancels from the button and from a click outside the dialog', async () => {
    const wrapper = await openWith('Branza')
    await wrapper.find('.app-btn--secondary').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)

    await wrapper.find('.custom-product-overlay').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(2)
  })
})
