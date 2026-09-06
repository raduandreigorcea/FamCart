// The English catalog, and the source of truth for what a catalog IS.
//
// Every other file in this directory is annotated `const xx: Catalog` against a
// type derived from this one, so a key added here and forgotten there fails
// `npm run typecheck` rather than shipping a screen that says
// 'setup.language.title' to somebody. English is also the static import and the
// runtime fallback — the other five are fetched lazily — so this file must stay
// complete and must never be the one that lags.
//
// Keys are flat and dotted, not nested. Three reasons, all small and all real:
// the catalog-parity test is `Object.keys()` equality rather than a tree walk,
// `t()` needs no path resolution, and `keyof typeof en` types the whole thing
// in one line.
//
// Naming is `<surface>.<component-or-state>.<thing>`. Errors are the exception:
// they all live under a flat `error.*` regardless of which module raises them,
// because the same sentence is reused from several call sites and filing it
// under the first one to need it makes the second look like a duplicate.
//
// A value is either a string or a plural entry `{ one?, few?, many?, other }`.
// See tn() in lib/i18n for which categories a language actually asks for —
// they are not the same set per language, and Romanian in particular needs
// three where English needs two.
//
// Square brackets in a heading mark the word that takes the accent colour. See
// tAccent() in lib/i18n: the marker is inside the sentence so each translator
// can put the accented word where their grammar puts it, rather than having
// its position fixed by a split into two keys. The brackets are read off this
// template before any {placeholder} is filled in, so they are the translator's
// to place and nobody else's.

export default {
  'common.back': 'Back',
  'common.ok': 'OK',
  'common.cancel': 'Cancel',
  'common.closeModal': 'Close modal',
  'common.confirm': 'Confirm',
  'common.continue': 'Continue',

  // The language picker itself. The six language names are NOT here: a language
  // is listed under its own name (see LOCALE_ENDONYMS in lib/locale), which is
  // the whole point — someone hunting for "Română" is not reading the English
  // catalog to find it.
  'language.groupLabel': 'Choose a language',

  'setup.language.eyebrow': 'Welcome 🌍',
  'setup.language.title': 'Pick your [language]',
  'setup.language.sub': 'You can change this any time in App Settings.',

  'setup.welcome.eyebrow': 'Welcome to FamCart 🛒',
  'setup.welcome.title': 'The list your whole [household] shares',
  'setup.welcome.sub':
    'Everyone adds, everyone checks off, and it all updates for the whole household the moment it happens, so nothing gets forgotten at the store.',
  'setup.welcome.cta': 'Get started',

  'setup.picker.eyebrowAdd': 'Add a household',
  'setup.picker.eyebrowNew': 'Welcome aboard 👋',
  'setup.picker.titleAdd': 'Add another [household]',
  'setup.picker.titleNew': 'Set up your [household]',
  // Two whole sentences rather than one plus an appended clause. The English
  // original built this by concatenating ', or create a new one.' onto a stem,
  // which only works because English puts the clause last.
  'setup.picker.subAdd': 'Join another household with their invite code.',
  'setup.picker.subAddOrCreate':
    'Join another household with their invite code, or create a new one.',
  'setup.picker.subNew':
    'Create a shared grocery list for your household, or join one using an invite code.',
  'setup.picker.createLabel': 'Create a household',
  'setup.picker.createDescription': 'Start a new list and get a shareable invite code',
  'setup.picker.joinLabel': 'Join a household',
  'setup.picker.joinDescription': 'Paste the invite code your household shared with you',

  'setup.create.eyebrow': 'New household',
  'setup.create.title': "What's your household name?",
  'setup.create.sub': 'This is how your household list will appear for everyone.',
  'setup.create.nameLabel': 'Household name',
  'setup.create.namePlaceholder': 'e.g. The Smiths',

  'setup.join.eyebrow': 'Join a household',
  'setup.join.title': 'Enter your invite code',
  'setup.join.sub': 'Ask a household member for their invite code.',
  'setup.join.codeLabel': 'Invite code',
  'setup.join.codePlaceholder': 'e.g. AB3K7XYZ',

  'settings.title': 'App Settings',
  'settings.subtitle': 'How FamCart looks and behaves on this device',
  'settings.close': 'Close app settings',
  'settings.appearance': 'Appearance',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.theme.system': 'System',
  'settings.notifications': 'Notifications',
  'settings.notifications.on': 'On',
  'settings.notifications.off': 'Off',
  'settings.language': 'Language',
  'settings.about': 'About',
  'settings.aboutHint': 'FamCart v{version}',

  'about.versionLine': 'v{version}',
  'about.close': 'Close about',
  'about.checkUpdates': 'Check for updates',
  'about.checking': 'Checking…',
  'about.upToDate': 'FamCart is up to date.',
  'about.checkFailed': "Couldn't reach GitHub to check. Try again when you're back online.",
  // The product-data credit, in three fragments because the shop names are
  // links and a link cannot be a {placeholder}. The names are proper nouns and
  // stay untranslated; only the connective text moves. All six languages keep
  // the "from A, B and C" order, which is what makes splitting it this way safe.
  //
  // There used to be a fourth fragment, ', under', because this was an ODbL
  // licence notice naming Open Food Facts and its two siblings. The catalog is
  // built from retailer listings now, so there is no licence to name.
  'about.creditLead': 'Product data from',
  'about.creditAnd': 'and',
  'about.creditEnd': '.',

  'error.genericTitle': 'Something went wrong',
  'error.offline': 'You appear to be offline. Check your connection and try again.',
  'error.nameTooLongTitle': 'Name Too Long',
  'error.householdNameTooLong': 'Household name must be {max} characters or fewer.',
  'error.ownOneHousehold':
    'You can only own one household. Leave or delete your current one before creating another.',
  'error.membershipCapCreate':
    'You can be part of at most {cap} households. Leave one before creating another.',
  'error.membershipCapJoin':
    'You can be part of at most {cap} households. Leave one before joining another.',
  'error.createHouseholdFailed': 'Failed to create household.',
  'error.joinHouseholdFailed': 'Failed to join household.',
  'error.inviteCodeInvalid': 'Invite code must be 8 characters, letters and numbers only.',
  'error.noHouseholdForCode': 'No household found with that invite code.',
  'error.notificationsBlocked':
    'Notifications are blocked for FamCart in your device or browser settings.',
  'error.notificationsFailed': 'Could not enable notifications. Please try again.',

  'list.meta.toBuy': 'To buy',
  'list.meta.checked': 'Checked',
  'list.meta.itemCount': { one: '{n} item', other: '{n} items' },
  'list.meta.leftCount': { one: '{n} left', other: '{n} left' },
  'list.filteredEmpty.checked': 'Nothing checked yet.',
  'list.filteredEmpty.active': 'Everything here is checked.',
  'list.filteredEmpty.shop': 'Nothing on this list is sold at {shop}.',
  'list.empty.titleShopped': 'All bought',
  'list.empty.titleNew': 'Nothing here yet',
  'list.empty.textShopped': 'Nothing left to pick up.',
  'list.empty.textNew': 'Add the first thing and everyone in the household sees it straight away.',
  'list.buyAgain': 'Buy again',
  'list.addProduct': 'Add {name}',
  'list.buyBar.checkedOut': 'Checked out!',
  'list.buyBar.slide': {
    one: 'Slide to check out {n} item',
    other: 'Slide to check out {n} items',
  },
  'list.buyBar.checkOut': { one: 'Check out {n} item', other: 'Check out {n} items' },

  'item.gotIt': 'Got it',
  'item.uncheck': 'Uncheck',
  'item.remove': 'Remove',
  'item.oneFewer': 'One fewer',
  'item.oneMore': 'One more',
  'item.quantity': 'Quantity {n}',
  'item.quantityDone': 'Quantity {n}. Done',
  'item.quantityChange': 'Quantity {n}. Change',

  'filter.buttonLabel': 'Filter items',
  'filter.buttonLabelFiltered': 'Filter items (filtered)',
  'filter.heading': 'Filters',
  'filter.hint': 'What this list shows',
  'filter.all.label': 'No filter',
  'filter.all.hint': 'Everything on the list',
  'filter.active.label': 'To buy',
  'filter.active.hint': 'Still to pick up',
  'filter.checked.label': 'Checked',
  'filter.checked.hint': 'In the cart, ready to check out',
  'filter.shopHeading': 'Shop',
  'filter.shopAny.label': 'Any shop',
  'filter.shopAny.hint': 'Everything, wherever it comes from',
  'filter.shopOne.hint': 'Sold at {shop}, plus anything we have no shop for',

  'add.inputLabel': 'Add an item',
  'add.inputPlaceholder': 'Add an item…',
  'add.scanLabel': 'Scan a barcode',
  'add.submitLabel': 'Add',
  'add.listRecents': 'Products you buy often',
  'add.listSuggestions': 'Product suggestions',
  'add.onYourList': 'on your list',
  'add.cantFind': "Can't find it?",
  'add.addYourOwn': 'Add your own',
  'add.typeToSearch': 'Type a product name to search.',
  'add.shopFilter': 'Filter by shop',
  'add.shopAll': 'All shops',
  'add.announced': '{name} added to your list',

  'custom.message':
    "Describe it and it goes straight on your list. We'll suggest it to your household next time.",
  'custom.productLabel': 'Product',
  'custom.productPlaceholder': 'Olive Oil 500ml',
  'custom.makerLabel': 'Manufacturer',
  'custom.makerPlaceholder': 'Bertolli',
  'custom.optional': 'optional',
  'custom.barcodeLabel': 'Barcode',
  'custom.barcodePlaceholder': '8 to 14 digits',
  'custom.barcodeNote': 'Saved with the product, so the next scan finds it.',
  'custom.barcodeInvalid': 'A barcode is 8 to 14 digits. Clear the field to skip it.',
  'custom.submit': 'Add to list',

  'scanner.pointCamera': 'Point the camera at a barcode',
  'scanner.starting': 'Starting the camera',
  'scanner.tryAgain': 'Try again',
  'scanner.notInCatalog': 'Not in the catalog',
  'scanner.lookingUp': 'Looking it up',
  'scanner.denied.title': 'FamCart has no camera access',
  'scanner.denied.detail': 'Allow the camera for this app, then try again.',
  'scanner.unavailable.title': "This device can't scan",
  'scanner.unavailable.detail': 'Add the item by name instead.',
  'scanner.error.title': "The camera didn't start",
  'scanner.error.detail': 'Another app may be using it.',
  'scanner.timeout.title': 'The camera never answered',
  'scanner.timeout.detail':
    "If nothing asked for camera access, check FamCart's camera permission in your device settings.",

  'common.save': 'Save',
  'common.saved': 'Saved',
  'common.avatarAlt': '{name} avatar',

  'topbar.history': 'Checkout history',
  'topbar.account': 'Your account',
  'topbar.avatarAlt': 'Your avatar',

  'account.title': 'Account Settings',
  'account.subtitle': 'Manage your profile and preferences',
  'account.close': 'Close account modal',
  'account.editProfile': 'Edit your profile: name, photo, password',
  'account.noEmail': 'No email available',
  'account.manageHousehold': 'Manage household',
  'account.householdFallback': 'Household',
  'account.invitePeople': 'Invite people',
  'account.memberCount': { one: '{n} member', other: '{n} members' },
  'account.appSettings': 'App settings',
  'account.appSettingsHint': 'Appearance, notifications, language',
  'account.current': 'Current',
  'account.joinOrCreate': 'Join or create a household',
  'account.reportIssue': 'Report an issue',
  'account.reportHint': 'Bugs and feedback',
  'account.signOut': 'Sign out',
  'account.signingOut': 'Signing out',

  'household.settingsIcon': 'Settings',
  'household.title': 'Household Settings',
  'household.close': 'Close settings',
  'household.sections': 'Settings sections',
  'household.tab.overview': 'Overview',
  'household.tab.preferences': 'Preferences',
  'household.tab.members': 'Members',
  'household.tab.danger': 'Danger Zone',

  'overview.summary': 'Household Summary',
  'overview.name': 'Household Name',
  'overview.createdBy': 'Created By',
  'overview.owner': 'Owner',
  'overview.totalMembers': 'Total Members',
  'overview.activeCount': '{n} active',
  'overview.inviteTitle': 'Invite New Members',
  'overview.inviteDesc': 'Share this code with your household members so they can join your list.',
  'overview.inviteCode': 'INVITE CODE',
  'overview.copyCode': 'Copy Code',
  'overview.copied': 'Copied!',

  'prefs.title': 'General Preferences',
  'prefs.nameTitle': 'Household Name',
  'prefs.nameDesc': 'Choose a name everyone in your household can recognize quickly.',
  'prefs.namePlaceholder': 'My Awesome Household',
  'prefs.emojiTitle': 'Household Emoji',
  'prefs.emojiDesc': 'Pick an emoji for your household. It shows in the top bar.',
  'prefs.limitTitle': 'Item Limit Per User',
  'prefs.limitDesc': 'Control how many active (unchecked) items each member can add.',
  'prefs.limitSlider': 'Item limit slider',

  'members.title': 'Household Members ({n})',
  'members.desc': 'Below are the people who have access to this shopping list.',
  'members.you': '(You)',
  'members.openActions': 'Open member actions',
  'members.promote': 'Promote to moderator',
  'members.promoteHint': 'Can manage items and members',
  'members.demote': 'Demote to member',
  'members.demoteHint': 'Removes moderator permissions',
  'members.remove': 'Remove from household',
  'members.removeHint': 'Loses access to the shopping list',
  'members.roleModerator': 'Moderator',
  'members.roleMember': 'Member',
  'members.confirmRemoveTitle': 'Remove Member?',
  'members.confirmRemoveMessage':
    'This person will immediately lose access to the household shopping list. They can join again with the invite code.',

  'danger.inviteTitle': 'Invite Code Administration',
  'danger.inviteDesc':
    'Immediately invalidates the current invite code. Existing members are unaffected, but future members must use the new code.',
  'danger.regenerate': 'Regenerate',
  'danger.regenerated': 'Regenerated',
  'danger.leaveTitle': 'Leave Household',
  'danger.leaveDesc':
    'This will remove you from the household. You will no longer have access to the shopping list.',
  'danger.deleteTitle': 'Delete Household',
  'danger.deleteDesc':
    'Permanently deletes [{name}], removes all members, and erases all shopping list data. This cannot be undone.',
  'danger.confirmRegenerateTitle': 'Regenerate Invite Code?',
  'danger.confirmRegenerateMessage':
    'This will immediately invalidate the current invite code. Existing members are unaffected, but anyone with the old code will no longer be able to join.',
  'danger.confirmLeaveTitle': 'Leave Household?',
  'danger.confirmLeaveMessage':
    'You will lose access to the shopping list and will need a new invite code to rejoin.',
  'danger.confirmDeleteTitle': 'Delete Household?',
  'danger.confirmDeleteMessage':
    'Deleting "{name}" will permanently remove all members, shopping list items, and history. This action cannot be undone.',

  'history.buttonLabel': 'Purchase history',
  'history.title': 'Checkout history',
  'history.subtitle': 'Your recent checkouts',
  'history.close': 'Close history',
  'history.empty': 'No checkouts yet. Items you check out will show up here.',
  'history.you': 'You',
  'history.someone': 'Someone',
  'history.today': 'Today',
  'history.yesterday': 'Yesterday',

  'error.roleUpdateFailed': "Could not update that member's role.",
  'error.removeMemberFailed': 'Could not remove that member.',
  'error.regenerateCodeFailed': 'Could not regenerate the invite code. Please try again.',
  'error.leaveHouseholdFailed': 'Could not leave the household.',
  'error.deleteHouseholdFailed': 'Could not delete the household.',
  'error.renameHouseholdFailed': 'Could not rename the household.',
  'error.saveEmojiFailed': 'Could not save the household emoji.',
  'error.saveLimitFailed': 'Could not save the item limit.',
  'error.loadHistoryFailed': 'Could not load history. Check your connection and try again.',

  'common.reload': 'Reload',
  'common.copy': 'Copy',

  'crash.text':
    'FamCart hit an error and had to stop. Your list is safe. It lives on the server, not in this page.',

  'notify.title': 'Turn on notifications?',
  'notify.message':
    'Know the moment someone in your household adds something to the list or checks items off, so nothing gets forgotten at the store.',
  'notify.notNow': 'Not now',
  'notify.turnOn': 'Turn on',

  'tour.skip': 'Skip tour',
  'tour.next': 'Next',
  'tour.start': 'Start shopping',
  'tour.inviteCodeLabel': 'Invite code',
  'tour.copyInviteCode': 'Copy invite code {code}',
  'tour.art.query': 'Avocados',
  'tour.art.avocado': 'Avocado',
  'tour.art.milk': 'Milk',
  'tour.art.bread': 'Bread',
  'tour.art.slide': 'Slide to check out',
  'tour.add.title': 'Add what you need',
  'tour.add.body':
    'Start typing and the matching products come up. Tap one and it goes straight onto the list.',
  'tour.swipe.title': 'Swipe to check or remove',
  'tour.swipe.body':
    'Swipe a row right once it is in your cart, or left to take it off the list. No small buttons to aim at.',
  'tour.checkout.title': 'Slide to check out',
  'tour.checkout.body':
    'Checked rows wait in the cart until you slide the bar at the bottom. That is what clears them and saves the trip to your history.',
  'tour.invite.title': 'Bring your household in',
  'tour.invite.body':
    'Share your invite code so everyone shops from the same list. Every change shows up for all of you the moment it happens.',

  'common.done': 'Done',
  'common.close': 'Close',
  'common.tryAgain': 'Try again',

  'login.tagline': 'Household Groceries, [fresh together daily]',
  'login.logoAlt': 'FamCart logo',
  'login.emailLabel': 'Email address',
  'login.emailPlaceholder': 'your@email.com',
  'login.codeHint': 'Enter the 6-digit code sent to',
  'login.codeGroupLabel': '6-digit verification code',
  'login.digitLabel': 'Digit {i} of {n}',
  'login.or': 'or',
  'login.alreadyTitle': "You're already signed in",
  'login.alreadyMessage': 'This device already has an active FamCart session.',
  'login.goToList': 'Go to my list',
  'login.errorTitle': 'Could not sign in',

  'error.oauthFailed': 'Could not sign in with that provider.',
  'error.noEmailCode': 'This account cannot sign in with an email code.',
  'error.generic': 'Something went wrong.',
  'error.verificationIncomplete': 'Verification incomplete. Please try again.',
  'error.invalidCode': 'Invalid code.',

  'offline.title': 'No connection',
  'offline.text':
    "FamCart can't reach the internet right now. Check your connection and your list will load as soon as you're back online.",
  'offline.stillOffline': 'Still no connection. Check your Wi-Fi or mobile data, then try again.',

  'update.availableTitle': 'Update available',
  'update.permissionTitle': 'One permission first',
  'update.readyToInstall': 'FamCart {version} is ready to install.',
  'update.currentVersion': "You're on {version}.",
  'update.permissionMessage':
    'Android only lets an app install updates once you allow it. Turn on [Allow from this source] for FamCart, then come back and press Update.',
  'update.downloadingMessage': 'Downloading FamCart {version}…',
  'update.installingMessage':
    'Android is taking over from here. Follow the install prompt to finish. Your list and household stay exactly as they are.',
  'update.failedMessage':
    "The update couldn't be downloaded. It may just be the connection. Try again, or get the APK from the releases page.",
  'update.progressLabel': 'Download progress',
  'update.later': 'Later',
  'update.install': 'Update',
  'update.notNow': 'Not now',
  'update.openSettings': 'Open settings',
  'update.downloading': 'Downloading…',
  'update.openReleases': 'Open releases',

  'report.title': 'Report an issue',
  'report.subtitle': 'Goes straight to the developer',
  'report.close': 'Close report',
  'report.sentTitle': 'Report sent',
  'report.sentBody': "Nothing else to do. Reports don't get a reply, but they do get read.",
  'report.kindGroupLabel': 'What kind of report is this?',
  'report.kindBug': "Something's broken",
  'report.kindIdea': 'Something could be better',
  'report.whereLabel': 'Where in the app?',
  'report.promptBug': 'What happened?',
  'report.promptIdea': 'What could be better?',
  'report.placeholderBug':
    'I ticked off milk and it came back on the list when I reopened the app.',
  'report.placeholderIdea': "It's not obvious how to remove someone from the household.",
  'report.charsLeft': '{n} characters left',
  'report.attachedTitle': 'Sent with your report',
  'report.send': 'Send',
  'report.sending': 'Sending',
  'report.failureTitle': 'Report not sent',
  'report.surface.list': 'Shopping list',
  'report.surface.add': 'Adding items',
  'report.surface.scan': 'Barcode scanner',
  'report.surface.history': 'Checkout & history',
  'report.surface.household': 'Household & members',
  'report.surface.notifications': 'Notifications',
  'report.surface.signin': 'Signing in',
  'report.surface.other': 'Somewhere else',
  'report.offlineFailure':
    "Nothing was sent because you're offline. Your text is still here, so try again once you're back.",
  'report.sendFailure':
    "Nothing was sent. The report couldn't reach us. Your text is still here, so try again. If it keeps failing, a browser privacy extension may be blocking it.",
  'report.diag.version': 'FamCart {version}, {platform}',
  'report.diag.pendingEdits': 'Has edits waiting to sync',
  'report.diag.ids': 'Your household and account IDs',

  'common.gotIt': 'Got it',

  'error.limitReachedTitle': 'Limit reached',
  'error.limitReached':
    'You reached your limit of {n} active items. Check or delete items before adding more.',
  'error.offlineSyncFailed': 'Some changes made offline could not be synced.',
  'error.loadHouseholdFailed': 'Could not load your household.',

  'sso.title': 'Almost there',
  'sso.text': 'Taking you back to the FamCart app…',
  'sso.open': 'Open FamCart',

  'setup.hero.avocado': 'Avocado',
  'setup.hero.milk': 'Milk',
  'setup.hero.bread': 'Bread',

  // ── The sweep the lint rule could not do ─────────────────────────────────
  // vue/no-bare-strings-in-template never flagged any of these, and could not
  // have: they came from src/lib modules, which it does not read, and from
  // expressions inside bindings, which it cannot see through. Filed together
  // because that is what they have in common.

  'common.memberFallback': 'Member',
  'account.fallbackName': 'Account',
  'topbar.householdSettings': '{name} settings',
  'members.sheetLabel': 'Actions for {name}',
  'members.sheetLabelGeneric': 'Actions for this member',
  'preferences.useEmoji': 'Use {emoji} for this household',
  'history.addedBy': 'Added by {name}',
  'history.addedThis': '{name} added this',

  // A list row's whole screen-reader label, written out four times rather than
  // assembled from a verb plus a sentence. "check" and "uncheck" differ by a
  // prefix in English and by clause position in half the other five, so
  // composing them would read as machine translation in exactly the place
  // nobody can see it.
  'item.swipeLabelCheck': '{name}. Swipe right to check, left to remove',
  'item.swipeLabelUncheck': '{name}. Swipe right to uncheck, left to remove',
  'item.swipeLabelCheckQty': '{name}, quantity {n}. Swipe right to check, left to remove',
  'item.swipeLabelUncheckQty': '{name}, quantity {n}. Swipe right to uncheck, left to remove',

  // The invite is read by somebody who may not use FamCart yet, so it is the
  // one message here whose reader is not the person who set the language. It
  // goes in the sender's language anyway: that is the language they are
  // writing the surrounding chat message in.
  'invite.shareTitle': 'Join {name} on FamCart',
  'invite.shareTitleGeneric': 'Join my household on FamCart',
  'invite.shareBody':
    'Join "{name}" on FamCart so we can share one shopping list. Your invite code is {code}.',
  'invite.shareBodyGeneric':
    'Join my household on FamCart so we can share one shopping list. Your invite code is {code}.',
  'invite.shareDialogTitle': 'Invite to FamCart',

  'error.loadListFailed': 'Could not load your list. Please try again.',
  'error.addItemFailed': 'Could not add that item.',
  'error.addItemGeneric': 'Failed to add item.',
  'error.addTooFast': 'You are adding items too quickly. Wait a minute and try again.',
  'error.updateItemFailed': 'Could not update that item.',
  'error.mergeItemsFailed': 'Could not merge those items.',
  'error.deleteItemFailed': 'Could not delete that item.',
  'error.checkoutFailed': 'Could not complete the checkout.',
  'error.itemNameTooLong': 'Item name must be {max} characters or fewer.',
  'error.notificationsFromSettings':
    'Could not enable notifications. You can try again from Account Settings.',
}
