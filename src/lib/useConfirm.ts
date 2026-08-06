import { ref, type Ref } from 'vue'

// A confirm dialog you can await.
//
// The app has two ways of driving ConfirmModal. Most callers keep their own
// `open` ref and split the decision across a handler somewhere else, which
// means the action and its confirmation are written in different places and
// read in neither. This is the other way: `if (!(await confirm({...}))) return`
// — the question and what depends on the answer stay on the same line.
//
// It lived inside HouseholdSettingsModal, which is where all seven of its callers
// were. It is here so the settings panels can share one dialog once they are
// separate components, and so the pattern is available to the views that still
// do it the long way.

export interface ConfirmOptions {
  title: string
  message: string
  /** Styles the dialog for a destructive action. */
  danger?: boolean
  confirmText?: string
  cancelText?: string
  /** False for an acknowledgement, where there is nothing to cancel. */
  showCancel?: boolean
}

export interface ConfirmState extends Required<ConfirmOptions> {
  open: boolean
}

export interface UseConfirm {
  /** Bind straight to ConfirmModal's props. */
  state: Ref<ConfirmState>
  /** Ask, and resolve with what the user chose. */
  confirm: (options: ConfirmOptions) => Promise<boolean>
  /** Wire to ConfirmModal's @confirm / @cancel. */
  resolveWith: (result: boolean) => void
}

const CLOSED: ConfirmState = {
  open: false,
  title: '',
  message: '',
  danger: false,
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  showCancel: true,
}

export function useConfirm(): UseConfirm {
  const state = ref<ConfirmState>({ ...CLOSED })
  // The pending promise's continuation. Held outside the state object so
  // resetting the state cannot drop it on the floor mid-question.
  let resolver: ((value: boolean) => void) | null = null

  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // A second question while one is open would strand the first caller
      // awaiting forever. Answer it "no" and let the new one through.
      if (resolver) {
        const previous = resolver
        resolver = null
        previous(false)
      }
      resolver = resolve
      state.value = { ...CLOSED, ...options, open: true }
    })
  }

  function resolveWith(result: boolean): void {
    const resolve = resolver
    resolver = null
    state.value = { ...CLOSED }
    if (resolve) resolve(result)
  }

  return { state, confirm, resolveWith }
}
