// German. See en.ts for what a catalog is and how keys are named.
//
// Worth knowing when editing the headings: German puts the accented noun in a
// different place than English does in several of these, which is exactly why
// the accent is a [marker] inside the sentence rather than a separate key.
import type { Catalog } from '../lib/i18n'

const de: Catalog = {
  'common.back': 'Zurück',
  'common.ok': 'OK',
  'common.cancel': 'Abbrechen',
  'common.closeModal': 'Dialog schließen',
  'common.confirm': 'Bestätigen',
  'common.continue': 'Weiter',

  'language.groupLabel': 'Sprache wählen',

  'setup.language.eyebrow': 'Willkommen 🌍',
  'setup.language.title': 'Wähle deine [Sprache]',
  'setup.language.sub': 'Du kannst das jederzeit in den App-Einstellungen ändern.',

  'setup.welcome.eyebrow': 'Willkommen bei FamCart 🛒',
  'setup.welcome.title': 'Die Liste für den ganzen [Haushalt]',
  'setup.welcome.sub':
    'Alle tragen ein, alle haken ab, und alles wird für den ganzen Haushalt sofort aktualisiert, damit im Laden nichts vergessen wird.',
  'setup.welcome.cta': 'Los geht’s',

  'setup.picker.eyebrowAdd': 'Haushalt hinzufügen',
  'setup.picker.eyebrowNew': 'Schön, dass du da bist 👋',
  'setup.picker.titleAdd': 'Noch einen [Haushalt] hinzufügen',
  'setup.picker.titleNew': 'Richte deinen [Haushalt] ein',
  'setup.picker.subAdd': 'Tritt mit dem Einladungscode einem weiteren Haushalt bei.',
  'setup.picker.subAddOrCreate':
    'Tritt mit dem Einladungscode einem weiteren Haushalt bei oder erstelle einen neuen.',
  'setup.picker.subNew':
    'Erstelle eine gemeinsame Einkaufsliste für deinen Haushalt oder tritt mit einem Einladungscode einem bestehenden bei.',
  'setup.picker.createLabel': 'Haushalt erstellen',
  'setup.picker.createDescription': 'Starte eine neue Liste und erhalte einen Einladungscode',
  'setup.picker.joinLabel': 'Haushalt beitreten',
  'setup.picker.joinDescription': 'Füge den Einladungscode deines Haushalts ein',

  'setup.create.eyebrow': 'Neuer Haushalt',
  'setup.create.title': 'Wie heißt dein Haushalt?',
  'setup.create.sub': 'So erscheint eure Haushaltsliste für alle.',
  'setup.create.nameLabel': 'Name des Haushalts',
  'setup.create.namePlaceholder': 'z. B. Familie Müller',

  'setup.join.eyebrow': 'Haushalt beitreten',
  'setup.join.title': 'Gib deinen Einladungscode ein',
  'setup.join.sub': 'Frag ein Mitglied des Haushalts nach dem Einladungscode.',
  'setup.join.codeLabel': 'Einladungscode',
  'setup.join.codePlaceholder': 'z. B. AB3K7XYZ',

  'settings.title': 'App-Einstellungen',
  'settings.subtitle': 'Wie FamCart auf diesem Gerät aussieht und sich verhält',
  'settings.close': 'App-Einstellungen schließen',
  'settings.appearance': 'Darstellung',
  'settings.theme.light': 'Hell',
  'settings.theme.dark': 'Dunkel',
  'settings.theme.system': 'System',
  'settings.notifications': 'Mitteilungen',
  'settings.notifications.on': 'An',
  'settings.notifications.off': 'Aus',
  'settings.language': 'Sprache',
  'settings.about': 'Über',
  'settings.aboutHint': 'FamCart v{version}',

  'about.versionLine': 'v{version}',
  'about.close': 'Über schließen',
  'about.checkUpdates': 'Nach Updates suchen',
  'about.checking': 'Wird gesucht…',
  'about.upToDate': 'FamCart ist auf dem neuesten Stand.',
  'about.checkFailed':
    'GitHub war nicht erreichbar. Versuche es erneut, wenn du wieder online bist.',
  'about.creditLead': 'Produktdaten von',
  'about.creditAnd': 'und',
  'about.creditEnd': '.',

  'error.genericTitle': 'Etwas ist schiefgelaufen',
  'error.offline': 'Du scheinst offline zu sein. Prüfe deine Verbindung und versuche es erneut.',
  'error.nameTooLongTitle': 'Name zu lang',
  'error.householdNameTooLong': 'Der Name des Haushalts darf höchstens {max} Zeichen lang sein.',
  'error.ownOneHousehold':
    'Du kannst nur einen Haushalt besitzen. Verlasse oder lösche deinen aktuellen, bevor du einen neuen erstellst.',
  'error.membershipCapCreate':
    'Du kannst höchstens {cap} Haushalten angehören. Verlasse einen, bevor du einen neuen erstellst.',
  'error.membershipCapJoin':
    'Du kannst höchstens {cap} Haushalten angehören. Verlasse einen, bevor du einem weiteren beitrittst.',
  'error.createHouseholdFailed': 'Haushalt konnte nicht erstellt werden.',
  'error.joinHouseholdFailed': 'Beitritt zum Haushalt fehlgeschlagen.',
  'error.inviteCodeInvalid':
    'Der Einladungscode muss aus 8 Zeichen bestehen, nur Buchstaben und Zahlen.',
  'error.noHouseholdForCode': 'Kein Haushalt mit diesem Einladungscode gefunden.',
  'error.notificationsBlocked':
    'Mitteilungen sind für FamCart in deinen Geräte- oder Browsereinstellungen blockiert.',
  'error.notificationsFailed':
    'Mitteilungen konnten nicht aktiviert werden. Bitte versuche es erneut.',

  'list.meta.toBuy': 'Einzukaufen',
  'list.meta.checked': 'Abgehakt',
  'list.meta.itemCount': { one: '{n} Artikel', other: '{n} Artikel' },
  'list.meta.leftCount': { one: '{n} übrig', other: '{n} übrig' },
  'list.filteredEmpty.checked': 'Noch nichts abgehakt.',
  'list.filteredEmpty.active': 'Hier ist alles abgehakt.',
  'list.empty.titleShopped': 'Alles gekauft',
  'list.empty.titleNew': 'Noch nichts hier',
  'list.empty.textShopped': 'Es ist nichts mehr abzuholen.',
  'list.empty.textNew': 'Trag das Erste ein, und alle im Haushalt sehen es sofort.',
  'list.buyAgain': 'Wieder kaufen',
  'list.addProduct': '{name} hinzufügen',
  'list.buyBar.checkedOut': 'Abgeschlossen!',
  'list.buyBar.slide': {
    one: 'Wischen, um {n} Artikel abzuschließen',
    other: 'Wischen, um {n} Artikel abzuschließen',
  },
  'list.buyBar.checkOut': { one: '{n} Artikel abschließen', other: '{n} Artikel abschließen' },

  'item.gotIt': 'Hab ich',
  'item.uncheck': 'Abwählen',
  'item.remove': 'Entfernen',
  'item.oneFewer': 'Einer weniger',
  'item.oneMore': 'Einer mehr',
  'item.quantity': 'Menge {n}',
  'item.quantityDone': 'Menge {n}. Fertig',
  'item.quantityChange': 'Menge {n}. Ändern',

  'filter.buttonLabel': 'Artikel filtern',
  'filter.buttonLabelFiltered': 'Artikel filtern (gefiltert)',
  'filter.heading': 'Filter',
  'filter.hint': 'Was diese Liste zeigt',
  'filter.all.label': 'Kein Filter',
  'filter.all.hint': 'Alles auf der Liste',
  'filter.active.label': 'Einzukaufen',
  'filter.active.hint': 'Noch abzuholen',
  'filter.checked.label': 'Abgehakt',
  'filter.checked.hint': 'Im Wagen, bereit zum Abschluss',

  'add.inputLabel': 'Artikel hinzufügen',
  'add.inputPlaceholder': 'Artikel hinzufügen…',
  'add.scanLabel': 'Barcode scannen',
  'add.submitLabel': 'Hinzufügen',
  'add.listRecents': 'Produkte, die du oft kaufst',
  'add.listSuggestions': 'Produktvorschläge',
  'add.onYourList': 'auf deiner Liste',
  'add.cantFind': 'Nicht gefunden?',
  'add.addYourOwn': 'Selbst hinzufügen',
  'add.typeToSearch': 'Tippe einen Produktnamen ein, um zu suchen.',
  'add.announced': '{name} zu deiner Liste hinzugefügt',

  'custom.message':
    'Beschreib es, und es landet direkt auf deiner Liste. Beim nächsten Mal schlagen wir es deinem Haushalt vor.',
  'custom.productLabel': 'Produkt',
  'custom.productPlaceholder': 'Olivenöl 500 ml',
  'custom.makerLabel': 'Hersteller',
  'custom.makerPlaceholder': 'Bertolli',
  'custom.optional': 'optional',
  'custom.barcodeLabel': 'Barcode',
  'custom.barcodePlaceholder': '8 bis 14 Ziffern',
  'custom.barcodeNote': 'Wird beim Produkt gespeichert, damit der nächste Scan es findet.',
  'custom.barcodeInvalid':
    'Ein Barcode hat 8 bis 14 Ziffern. Leere das Feld, um ihn zu überspringen.',
  'custom.submit': 'Zur Liste hinzufügen',

  'scanner.pointCamera': 'Richte die Kamera auf einen Barcode',
  'scanner.starting': 'Kamera wird gestartet',
  'scanner.tryAgain': 'Erneut versuchen',
  'scanner.notInCatalog': 'Nicht im Katalog',
  'scanner.lookingUp': 'Wird nachgeschlagen',
  'scanner.denied.title': 'FamCart hat keinen Kamerazugriff',
  'scanner.denied.detail': 'Erlaube der App die Kamera und versuche es erneut.',
  'scanner.unavailable.title': 'Dieses Gerät kann nicht scannen',
  'scanner.unavailable.detail': 'Füge den Artikel stattdessen über den Namen hinzu.',
  'scanner.error.title': 'Die Kamera ist nicht gestartet',
  'scanner.error.detail': 'Vielleicht benutzt sie eine andere App.',
  'scanner.timeout.title': 'Die Kamera hat nie geantwortet',
  'scanner.timeout.detail':
    'Wenn nichts nach Kamerazugriff gefragt hat, prüfe die Kameraberechtigung von FamCart in den Geräteeinstellungen.',

  'common.save': 'Speichern',
  'common.saved': 'Gespeichert',
  'common.avatarAlt': 'Avatar von {name}',

  'topbar.history': 'Einkaufsverlauf',
  'topbar.account': 'Dein Konto',
  'topbar.avatarAlt': 'Dein Avatar',

  'account.title': 'Kontoeinstellungen',
  'account.subtitle': 'Verwalte dein Profil und deine Einstellungen',
  'account.close': 'Kontofenster schließen',
  'account.editProfile': 'Profil bearbeiten: Name, Foto, Passwort',
  'account.noEmail': 'Keine E-Mail vorhanden',
  'account.manageHousehold': 'Haushalt verwalten',
  'account.householdFallback': 'Haushalt',
  'account.invitePeople': 'Leute einladen',
  'account.memberCount': { one: '{n} Mitglied', other: '{n} Mitglieder' },
  'account.appSettings': 'App-Einstellungen',
  'account.appSettingsHint': 'Darstellung, Mitteilungen, Sprache',
  'account.current': 'Aktuell',
  'account.joinOrCreate': 'Haushalt beitreten oder erstellen',
  'account.reportIssue': 'Problem melden',
  'account.reportHint': 'Fehler und Feedback',
  'account.signOut': 'Abmelden',
  'account.signingOut': 'Wird abgemeldet',

  'household.settingsIcon': 'Einstellungen',
  'household.title': 'Haushaltseinstellungen',
  'household.close': 'Einstellungen schließen',
  'household.sections': 'Einstellungsbereiche',
  'household.tab.overview': 'Übersicht',
  'household.tab.preferences': 'Einstellungen',
  'household.tab.members': 'Mitglieder',
  'household.tab.danger': 'Gefahrenzone',

  'overview.summary': 'Haushaltsübersicht',
  'overview.name': 'Name des Haushalts',
  'overview.createdBy': 'Erstellt von',
  'overview.owner': 'Eigentümer',
  'overview.totalMembers': 'Mitglieder gesamt',
  'overview.activeCount': '{n} aktiv',
  'overview.inviteTitle': 'Neue Mitglieder einladen',
  'overview.inviteDesc':
    'Teile diesen Code mit deinem Haushalt, damit sie deiner Liste beitreten können.',
  'overview.inviteCode': 'EINLADUNGSCODE',
  'overview.copyCode': 'Code kopieren',
  'overview.copied': 'Kopiert!',

  'prefs.title': 'Allgemeine Einstellungen',
  'prefs.nameTitle': 'Name des Haushalts',
  'prefs.nameDesc': 'Wähle einen Namen, den alle im Haushalt sofort erkennen.',
  'prefs.namePlaceholder': 'Mein toller Haushalt',
  'prefs.emojiTitle': 'Haushalts-Emoji',
  'prefs.emojiDesc': 'Wähle ein Emoji für deinen Haushalt. Es erscheint in der oberen Leiste.',
  'prefs.limitTitle': 'Artikellimit pro Person',
  'prefs.limitDesc':
    'Lege fest, wie viele aktive (nicht abgehakte) Artikel jedes Mitglied hinzufügen darf.',
  'prefs.limitSlider': 'Regler für das Artikellimit',

  'members.title': 'Haushaltsmitglieder ({n})',
  'members.desc': 'Unten stehen die Personen, die Zugriff auf diese Einkaufsliste haben.',
  'members.you': '(Du)',
  'members.openActions': 'Mitgliedsaktionen öffnen',
  'members.promote': 'Zum Moderator machen',
  'members.promoteHint': 'Kann Artikel und Mitglieder verwalten',
  'members.demote': 'Zum Mitglied zurückstufen',
  'members.demoteHint': 'Entzieht die Moderatorrechte',
  'members.remove': 'Aus dem Haushalt entfernen',
  'members.removeHint': 'Verliert den Zugriff auf die Einkaufsliste',
  'members.roleModerator': 'Moderator',
  'members.roleMember': 'Mitglied',
  'members.confirmRemoveTitle': 'Mitglied entfernen?',
  'members.confirmRemoveMessage':
    'Diese Person verliert sofort den Zugriff auf die Einkaufsliste des Haushalts. Mit dem Einladungscode kann sie wieder beitreten.',

  'danger.inviteTitle': 'Verwaltung des Einladungscodes',
  'danger.inviteDesc':
    'Macht den aktuellen Einladungscode sofort ungültig. Bestehende Mitglieder bleiben unberührt, neue müssen den neuen Code nutzen.',
  'danger.regenerate': 'Neu erzeugen',
  'danger.regenerated': 'Neu erzeugt',
  'danger.leaveTitle': 'Haushalt verlassen',
  'danger.leaveDesc':
    'Damit wirst du aus dem Haushalt entfernt. Du hast dann keinen Zugriff mehr auf die Einkaufsliste.',
  'danger.deleteTitle': 'Haushalt löschen',
  'danger.deleteDesc':
    'Löscht [{name}] endgültig, entfernt alle Mitglieder und löscht alle Listendaten. Das lässt sich nicht rückgängig machen.',
  'danger.confirmRegenerateTitle': 'Einladungscode neu erzeugen?',
  'danger.confirmRegenerateMessage':
    'Der aktuelle Einladungscode wird sofort ungültig. Bestehende Mitglieder bleiben unberührt, aber mit dem alten Code kann niemand mehr beitreten.',
  'danger.confirmLeaveTitle': 'Haushalt verlassen?',
  'danger.confirmLeaveMessage':
    'Du verlierst den Zugriff auf die Einkaufsliste und brauchst einen neuen Einladungscode, um zurückzukehren.',
  'danger.confirmDeleteTitle': 'Haushalt löschen?',
  'danger.confirmDeleteMessage':
    'Beim Löschen von „{name}“ werden alle Mitglieder, Artikel und der Verlauf endgültig entfernt. Das lässt sich nicht rückgängig machen.',

  'history.buttonLabel': 'Kaufverlauf',
  'history.title': 'Einkaufsverlauf',
  'history.subtitle': 'Deine letzten Einkäufe',
  'history.close': 'Verlauf schließen',
  'history.empty': 'Noch keine Einkäufe. Abgeschlossene Artikel erscheinen hier.',
  'history.you': 'Du',
  'history.someone': 'Jemand',
  'history.today': 'Heute',
  'history.yesterday': 'Gestern',

  'error.roleUpdateFailed': 'Die Rolle des Mitglieds konnte nicht geändert werden.',
  'error.removeMemberFailed': 'Das Mitglied konnte nicht entfernt werden.',
  'error.regenerateCodeFailed':
    'Der Einladungscode konnte nicht neu erzeugt werden. Bitte versuche es erneut.',
  'error.leaveHouseholdFailed': 'Der Haushalt konnte nicht verlassen werden.',
  'error.deleteHouseholdFailed': 'Der Haushalt konnte nicht gelöscht werden.',
  'error.renameHouseholdFailed': 'Der Haushalt konnte nicht umbenannt werden.',
  'error.saveEmojiFailed': 'Das Haushalts-Emoji konnte nicht gespeichert werden.',
  'error.saveLimitFailed': 'Das Artikellimit konnte nicht gespeichert werden.',
  'error.loadHistoryFailed':
    'Der Verlauf konnte nicht geladen werden. Prüfe deine Verbindung und versuche es erneut.',

  'common.reload': 'Neu laden',
  'common.copy': 'Kopieren',

  'crash.text':
    'FamCart ist auf einen Fehler gestoßen und musste anhalten. Deine Liste ist sicher — sie liegt auf dem Server, nicht auf dieser Seite.',

  'notify.title': 'Mitteilungen einschalten?',
  'notify.message':
    'Erfahre sofort, wenn jemand im Haushalt etwas auf die Liste setzt oder abhakt, damit im Laden nichts vergessen wird.',
  'notify.notNow': 'Jetzt nicht',
  'notify.turnOn': 'Einschalten',

  'tour.skip': 'Tour überspringen',
  'tour.next': 'Weiter',
  'tour.start': 'Einkaufen starten',
  'tour.inviteCodeLabel': 'Einladungscode',
  'tour.copyInviteCode': 'Einladungscode {code} kopieren',
  'tour.art.query': 'Avocados',
  'tour.art.avocado': 'Avocado',
  'tour.art.milk': 'Milch',
  'tour.art.bread': 'Brot',
  'tour.art.slide': 'Wischen zum Abschließen',
  'tour.add.title': 'Trag ein, was du brauchst',
  'tour.add.body':
    'Fang an zu tippen, und die passenden Produkte erscheinen. Tipp eines an, und es landet direkt auf der Liste.',
  'tour.swipe.title': 'Wischen zum Abhaken oder Entfernen',
  'tour.swipe.body':
    'Wisch eine Zeile nach rechts, sobald sie im Wagen liegt, oder nach links, um sie von der Liste zu nehmen. Keine kleinen Knöpfe zum Treffen.',
  'tour.checkout.title': 'Wischen zum Abschließen',
  'tour.checkout.body':
    'Abgehakte Zeilen warten im Wagen, bis du die Leiste unten wischst. Das räumt sie ab und speichert den Einkauf in deinem Verlauf.',
  'tour.invite.title': 'Hol deinen Haushalt dazu',
  'tour.invite.body':
    'Teile deinen Einladungscode, damit alle von derselben Liste einkaufen. Jede Änderung erscheint bei allen im selben Moment.',

  'common.done': 'Fertig',
  'common.close': 'Schließen',
  'common.tryAgain': 'Erneut versuchen',

  'login.tagline': 'Einkäufe für den Haushalt, [täglich frisch, gemeinsam]',
  'login.logoAlt': 'FamCart-Logo',
  'login.emailLabel': 'E-Mail-Adresse',
  'login.emailPlaceholder': 'du@email.de',
  'login.codeHint': 'Gib den 6-stelligen Code ein, der an folgende Adresse ging:',
  'login.codeGroupLabel': '6-stelliger Bestätigungscode',
  'login.digitLabel': 'Ziffer {i} von {n}',
  'login.or': 'oder',
  'login.alreadyTitle': 'Du bist bereits angemeldet',
  'login.alreadyMessage': 'Auf diesem Gerät läuft bereits eine FamCart-Sitzung.',
  'login.goToList': 'Zu meiner Liste',
  'login.errorTitle': 'Anmeldung fehlgeschlagen',

  'error.oauthFailed': 'Die Anmeldung mit diesem Anbieter ist fehlgeschlagen.',
  'error.noEmailCode': 'Dieses Konto kann sich nicht per E-Mail-Code anmelden.',
  'error.generic': 'Etwas ist schiefgelaufen.',
  'error.verificationIncomplete': 'Bestätigung unvollständig. Bitte versuche es erneut.',
  'error.invalidCode': 'Ungültiger Code.',

  'offline.title': 'Keine Verbindung',
  'offline.text':
    'FamCart erreicht das Internet gerade nicht. Prüfe deine Verbindung — die Liste lädt, sobald du wieder online bist.',
  'offline.stillOffline':
    'Immer noch keine Verbindung. Prüfe WLAN oder mobile Daten und versuche es erneut.',

  'update.availableTitle': 'Update verfügbar',
  'update.permissionTitle': 'Zuerst eine Berechtigung',
  'update.readyToInstall': 'FamCart {version} kann installiert werden.',
  'update.currentVersion': 'Du hast {version}.',
  'update.permissionMessage':
    'Android lässt eine App Updates erst installieren, wenn du es erlaubst. Aktiviere [Aus dieser Quelle zulassen] für FamCart, komm zurück und drücke Aktualisieren.',
  'update.downloadingMessage': 'FamCart {version} wird geladen…',
  'update.installingMessage':
    'Ab hier übernimmt Android. Folge der Installationsaufforderung. Deine Liste und dein Haushalt bleiben genau so, wie sie sind.',
  'update.failedMessage':
    'Das Update konnte nicht geladen werden. Vielleicht liegt es nur an der Verbindung. Versuche es erneut, oder hol dir die APK von der Releases-Seite.',
  'update.progressLabel': 'Download-Fortschritt',
  'update.later': 'Später',
  'update.install': 'Aktualisieren',
  'update.notNow': 'Jetzt nicht',
  'update.openSettings': 'Einstellungen öffnen',
  'update.downloading': 'Wird geladen…',
  'update.openReleases': 'Releases öffnen',

  'report.title': 'Problem melden',
  'report.subtitle': 'Geht direkt an den Entwickler',
  'report.close': 'Meldung schließen',
  'report.sentTitle': 'Meldung gesendet',
  'report.sentBody': 'Sonst ist nichts zu tun. Meldungen werden nicht beantwortet, aber gelesen.',
  'report.kindGroupLabel': 'Um welche Art von Meldung geht es?',
  'report.kindBug': 'Etwas ist kaputt',
  'report.kindIdea': 'Etwas könnte besser sein',
  'report.whereLabel': 'Wo in der App?',
  'report.promptBug': 'Was ist passiert?',
  'report.promptIdea': 'Was könnte besser sein?',
  'report.placeholderBug':
    'Ich habe Milch abgehakt, und beim erneuten Öffnen der App war sie wieder auf der Liste.',
  'report.placeholderIdea':
    'Es ist nicht offensichtlich, wie man jemanden aus dem Haushalt entfernt.',
  'report.charsLeft': 'Noch {n} Zeichen',
  'report.attachedTitle': 'Wird mit deiner Meldung gesendet',
  'report.send': 'Senden',
  'report.sending': 'Wird gesendet',
  'report.failureTitle': 'Meldung nicht gesendet',
  'report.surface.list': 'Einkaufsliste',
  'report.surface.add': 'Artikel hinzufügen',
  'report.surface.scan': 'Barcode-Scanner',
  'report.surface.history': 'Abschluss & Verlauf',
  'report.surface.household': 'Haushalt & Mitglieder',
  'report.surface.notifications': 'Mitteilungen',
  'report.surface.signin': 'Anmeldung',
  'report.surface.other': 'Woanders',
  'report.offlineFailure':
    'Es wurde nichts gesendet, weil du offline bist. Dein Text ist noch da — versuch es erneut, sobald du zurück bist.',
  'report.sendFailure':
    'Es wurde nichts gesendet. Die Meldung hat uns nicht erreicht. Dein Text ist noch da, versuch es erneut. Wenn es weiter fehlschlägt, blockiert es womöglich eine Privatsphäre-Erweiterung im Browser.',
  'report.diag.version': 'FamCart {version}, {platform}',
  'report.diag.pendingEdits': 'Hat Änderungen, die noch synchronisiert werden',
  'report.diag.ids': 'Deine Haushalts- und Konto-IDs',

  'common.gotIt': 'Verstanden',

  'error.limitReachedTitle': 'Limit erreicht',
  'error.limitReached':
    'Du hast dein Limit von {n} aktiven Artikeln erreicht. Hake Artikel ab oder lösche welche, bevor du weitere hinzufügst.',
  'error.offlineSyncFailed':
    'Einige offline gemachte Änderungen konnten nicht synchronisiert werden.',
  'error.loadHouseholdFailed': 'Dein Haushalt konnte nicht geladen werden.',

  'sso.title': 'Fast geschafft',
  'sso.text': 'Du wirst zur FamCart-App zurückgebracht…',
  'sso.open': 'FamCart öffnen',

  'setup.hero.avocado': 'Avocado',
  'setup.hero.milk': 'Milch',
  'setup.hero.bread': 'Brot',

  'common.memberFallback': 'Mitglied',
  'account.fallbackName': 'Konto',
  'topbar.householdSettings': 'Einstellungen für {name}',
  'members.sheetLabel': 'Aktionen für {name}',
  'members.sheetLabelGeneric': 'Aktionen für dieses Mitglied',
  'preferences.useEmoji': '{emoji} für diesen Haushalt verwenden',
  'history.addedBy': 'Hinzugefügt von {name}',
  'history.addedThis': '{name} hat das hinzugefügt',

  'item.swipeLabelCheck': '{name}. Nach rechts wischen zum Abhaken, nach links zum Löschen',
  'item.swipeLabelUncheck':
    '{name}. Nach rechts wischen, um das Häkchen zu entfernen, nach links zum Löschen',
  'item.swipeLabelCheckQty':
    '{name}, Menge {n}. Nach rechts wischen zum Abhaken, nach links zum Löschen',
  'item.swipeLabelUncheckQty':
    '{name}, Menge {n}. Nach rechts wischen, um das Häkchen zu entfernen, nach links zum Löschen',

  'invite.shareTitle': 'Tritt {name} auf FamCart bei',
  'invite.shareTitleGeneric': 'Tritt meinem Haushalt auf FamCart bei',
  'invite.shareBody':
    'Tritt „{name}” auf FamCart bei, damit wir eine gemeinsame Einkaufsliste haben. Dein Einladungscode ist {code}.',
  'invite.shareBodyGeneric':
    'Tritt meinem Haushalt auf FamCart bei, damit wir eine gemeinsame Einkaufsliste haben. Dein Einladungscode ist {code}.',
  'invite.shareDialogTitle': 'Zu FamCart einladen',

  'error.loadListFailed': 'Deine Liste konnte nicht geladen werden. Bitte versuche es erneut.',
  'error.addItemFailed': 'Der Artikel konnte nicht hinzugefügt werden.',
  'error.addItemGeneric': 'Hinzufügen des Artikels fehlgeschlagen.',
  'error.addTooFast':
    'Du fügst zu schnell Artikel hinzu. Warte eine Minute und versuche es erneut.',
  'error.updateItemFailed': 'Der Artikel konnte nicht aktualisiert werden.',
  'error.mergeItemsFailed': 'Die Artikel konnten nicht zusammengeführt werden.',
  'error.deleteItemFailed': 'Der Artikel konnte nicht gelöscht werden.',
  'error.checkoutFailed': 'Der Einkauf konnte nicht abgeschlossen werden.',
  'error.itemNameTooLong': 'Der Artikelname darf höchstens {max} Zeichen lang sein.',
  'error.notificationsFromSettings':
    'Benachrichtigungen konnten nicht aktiviert werden. Du kannst es in den Kontoeinstellungen erneut versuchen.',
}

export default de
