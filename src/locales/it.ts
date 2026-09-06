// Italian. See en.ts for what a catalog is and how keys are named.
//
// Italian has a `many` plural category, but Intl only selects it at exact
// millions, which a shopping list will never reach. The entries here carry
// one/other and let tn()'s `other` fallback cover it.
import type { Catalog } from '../lib/i18n'

const it: Catalog = {
  'common.back': 'Indietro',
  'common.ok': 'OK',
  'common.cancel': 'Annulla',
  'common.closeModal': 'Chiudi la finestra',
  'common.confirm': 'Conferma',
  'common.continue': 'Continua',

  'language.groupLabel': 'Scegli una lingua',

  'setup.language.eyebrow': 'Benvenuto 🌍',
  'setup.language.title': 'Scegli la tua [lingua]',
  'setup.language.sub': 'Puoi cambiarla in qualsiasi momento nelle Impostazioni dell’app.',

  'setup.welcome.eyebrow': 'Benvenuto su FamCart 🛒',
  'setup.welcome.title': 'La lista condivisa da tutta la [famiglia]',
  'setup.welcome.sub':
    'Tutti aggiungono, tutti spuntano, e tutto si aggiorna per l’intera famiglia nel momento stesso in cui accade, così al negozio non si dimentica nulla.',
  'setup.welcome.cta': 'Inizia',

  'setup.picker.eyebrowAdd': 'Aggiungi una famiglia',
  'setup.picker.eyebrowNew': 'Benvenuto a bordo 👋',
  'setup.picker.titleAdd': 'Aggiungi un’altra [famiglia]',
  'setup.picker.titleNew': 'Configura la tua [famiglia]',
  'setup.picker.subAdd': 'Unisciti a un’altra famiglia con il loro codice di invito.',
  'setup.picker.subAddOrCreate':
    'Unisciti a un’altra famiglia con il loro codice di invito, oppure creane una nuova.',
  'setup.picker.subNew':
    'Crea una lista della spesa condivisa per la tua famiglia, oppure uniscine a una con un codice di invito.',
  'setup.picker.createLabel': 'Crea una famiglia',
  'setup.picker.createDescription': 'Avvia una nuova lista e ottieni un codice di invito',
  'setup.picker.joinLabel': 'Unisciti a una famiglia',
  'setup.picker.joinDescription': 'Incolla il codice di invito che la tua famiglia ha condiviso',

  'setup.create.eyebrow': 'Nuova famiglia',
  'setup.create.title': 'Come si chiama la tua famiglia?',
  'setup.create.sub': 'È così che la lista della tua famiglia apparirà a tutti.',
  'setup.create.nameLabel': 'Nome della famiglia',
  'setup.create.namePlaceholder': 'es. I Rossi',

  'setup.join.eyebrow': 'Unisciti a una famiglia',
  'setup.join.title': 'Inserisci il tuo codice di invito',
  'setup.join.sub': 'Chiedi il codice di invito a un membro della famiglia.',
  'setup.join.codeLabel': 'Codice di invito',
  'setup.join.codePlaceholder': 'es. AB3K7XYZ',

  'settings.title': 'Impostazioni dell’app',
  'settings.subtitle': 'Come appare e si comporta FamCart su questo dispositivo',
  'settings.close': 'Chiudi le impostazioni dell’app',
  'settings.appearance': 'Aspetto',
  'settings.theme.light': 'Chiaro',
  'settings.theme.dark': 'Scuro',
  'settings.theme.system': 'Sistema',
  'settings.notifications': 'Notifiche',
  'settings.notifications.on': 'Attive',
  'settings.notifications.off': 'Disattive',
  'settings.language': 'Lingua',
  'settings.about': 'Informazioni',
  'settings.aboutHint': 'FamCart v{version}',

  'about.versionLine': 'v{version}',
  'about.close': 'Chiudi Informazioni',
  'about.checkUpdates': 'Cerca aggiornamenti',
  'about.checking': 'Ricerca…',
  'about.upToDate': 'FamCart è aggiornato.',
  'about.checkFailed':
    'Impossibile contattare GitHub. Riprova quando sei di nuovo online.',
  'about.creditLead': 'Dati sui prodotti da',
  'about.creditAnd': 'e',
  'about.creditEnd': '.',

  'error.genericTitle': 'Qualcosa è andato storto',
  'error.offline': 'Sembra che tu sia offline. Controlla la connessione e riprova.',
  'error.nameTooLongTitle': 'Nome troppo lungo',
  'error.householdNameTooLong': 'Il nome della famiglia deve avere al massimo {max} caratteri.',
  'error.ownOneHousehold':
    'Puoi possedere una sola famiglia. Abbandona o elimina quella attuale prima di crearne un’altra.',
  'error.membershipCapCreate':
    'Puoi far parte di al massimo {cap} famiglie. Abbandonane una prima di crearne un’altra.',
  'error.membershipCapJoin':
    'Puoi far parte di al massimo {cap} famiglie. Abbandonane una prima di unirti a un’altra.',
  'error.createHouseholdFailed': 'Impossibile creare la famiglia.',
  'error.joinHouseholdFailed': 'Impossibile unirsi alla famiglia.',
  'error.inviteCodeInvalid':
    'Il codice di invito deve avere 8 caratteri, solo lettere e numeri.',
  'error.noHouseholdForCode': 'Nessuna famiglia trovata con quel codice di invito.',
  'error.notificationsBlocked':
    'Le notifiche sono bloccate per FamCart nelle impostazioni del dispositivo o del browser.',
  'error.notificationsFailed': 'Impossibile attivare le notifiche. Riprova.',

  'list.meta.toBuy': 'Da comprare',
  'list.meta.checked': 'Spuntati',
  'list.meta.itemCount': { one: '{n} articolo', other: '{n} articoli' },
  'list.meta.leftCount': { one: '{n} rimasto', other: '{n} rimasti' },
  'list.filteredEmpty.checked': 'Non hai ancora spuntato nulla.',
  'list.filteredEmpty.active': 'Qui è tutto spuntato.',
  'list.filteredEmpty.shop': 'Niente in questa lista si vende da {shop}.',
  'list.empty.titleShopped': 'Tutto comprato',
  'list.empty.titleNew': 'Ancora niente qui',
  'list.empty.textShopped': 'Non resta niente da prendere.',
  'list.empty.textNew': 'Aggiungi la prima cosa e tutta la famiglia la vede subito.',
  'list.buyAgain': 'Compra di nuovo',
  'list.addProduct': 'Aggiungi {name}',
  'list.buyBar.checkedOut': 'Completato!',
  'list.buyBar.slide': {
    one: 'Scorri per completare {n} articolo',
    other: 'Scorri per completare {n} articoli',
  },
  'list.buyBar.checkOut': { one: 'Completa {n} articolo', other: 'Completa {n} articoli' },

  'item.gotIt': 'Preso',
  'item.uncheck': 'Deseleziona',
  'item.remove': 'Rimuovi',
  'item.oneFewer': 'Uno in meno',
  'item.oneMore': 'Uno in più',
  'item.quantity': 'Quantità {n}',
  'item.quantityDone': 'Quantità {n}. Fatto',
  'item.quantityChange': 'Quantità {n}. Modifica',

  'filter.buttonLabel': 'Filtra gli articoli',
  'filter.buttonLabelFiltered': 'Filtra gli articoli (filtrato)',
  'filter.heading': 'Filtri',
  'filter.hint': 'Cosa mostra questa lista',
  'filter.all.label': 'Nessun filtro',
  'filter.all.hint': 'Tutto quello che è in lista',
  'filter.active.label': 'Da comprare',
  'filter.active.hint': 'Ancora da prendere',
  'filter.checked.label': 'Spuntati',
  'filter.checked.hint': 'Nel carrello, pronti da completare',
  'filter.shopHeading': 'Negozio',
  'filter.shopAny.label': 'Qualsiasi negozio',
  'filter.shopAny.hint': 'Tutto, da qualunque parte venga',

  'add.inputLabel': 'Aggiungi un articolo',
  'add.inputPlaceholder': 'Aggiungi un articolo…',
  'add.scanLabel': 'Scansiona un codice a barre',
  'add.submitLabel': 'Aggiungi',
  'add.listRecents': 'Prodotti che compri spesso',
  'add.listSuggestions': 'Suggerimenti di prodotti',
  'add.onYourList': 'nella tua lista',
  'add.cantFind': 'Non lo trovi?',
  'add.addYourOwn': 'Aggiungilo tu',
  'add.typeToSearch': 'Scrivi il nome di un prodotto per cercare.',
  'add.shopFilter': 'Filtra per negozio',
  'add.shopAll': 'Tutti i negozi',
  'add.announced': '{name} aggiunto alla tua lista',

  'custom.message':
    'Descrivilo e finisce dritto nella tua lista. La prossima volta lo suggeriremo alla tua famiglia.',
  'custom.productLabel': 'Prodotto',
  'custom.productPlaceholder': 'Olio d’oliva 500 ml',
  'custom.makerLabel': 'Produttore',
  'custom.makerPlaceholder': 'Bertolli',
  'custom.optional': 'facoltativo',
  'custom.barcodeLabel': 'Codice a barre',
  'custom.barcodePlaceholder': 'da 8 a 14 cifre',
  'custom.barcodeNote': 'Salvato con il prodotto, così la prossima scansione lo trova.',
  'custom.barcodeInvalid': 'Un codice a barre ha da 8 a 14 cifre. Svuota il campo per saltarlo.',
  'custom.submit': 'Aggiungi alla lista',

  'scanner.pointCamera': 'Punta la fotocamera su un codice a barre',
  'scanner.starting': 'Avvio della fotocamera',
  'scanner.tryAgain': 'Riprova',
  'scanner.notInCatalog': 'Non è nel catalogo',
  'scanner.lookingUp': 'Ricerca in corso',
  'scanner.denied.title': 'FamCart non ha accesso alla fotocamera',
  'scanner.denied.detail': 'Consenti la fotocamera a questa app, poi riprova.',
  'scanner.unavailable.title': 'Questo dispositivo non può scansionare',
  'scanner.unavailable.detail': 'Aggiungi l’articolo per nome.',
  'scanner.error.title': 'La fotocamera non è partita',
  'scanner.error.detail': 'Forse la sta usando un’altra app.',
  'scanner.timeout.title': 'La fotocamera non ha risposto',
  'scanner.timeout.detail':
    'Se nulla ha chiesto l’accesso alla fotocamera, controlla il permesso fotocamera di FamCart nelle impostazioni del dispositivo.',

  'common.save': 'Salva',
  'common.saved': 'Salvato',
  'common.avatarAlt': 'Avatar di {name}',

  'topbar.history': 'Cronologia degli acquisti',
  'topbar.account': 'Il tuo account',
  'topbar.avatarAlt': 'Il tuo avatar',

  'account.title': 'Impostazioni account',
  'account.subtitle': 'Gestisci il tuo profilo e le preferenze',
  'account.close': 'Chiudi la finestra dell’account',
  'account.editProfile': 'Modifica il tuo profilo: nome, foto, password',
  'account.noEmail': 'Nessuna e-mail disponibile',
  'account.manageHousehold': 'Gestisci la famiglia',
  'account.householdFallback': 'Famiglia',
  'account.invitePeople': 'Invita persone',
  'account.memberCount': { one: '{n} membro', other: '{n} membri' },
  'account.appSettings': 'Impostazioni dell’app',
  'account.appSettingsHint': 'Aspetto, notifiche, lingua',
  'account.current': 'Attuale',
  'account.joinOrCreate': 'Unisciti o crea una famiglia',
  'account.reportIssue': 'Segnala un problema',
  'account.reportHint': 'Bug e feedback',
  'account.signOut': 'Esci',
  'account.signingOut': 'Uscita in corso',

  'household.settingsIcon': 'Impostazioni',
  'household.title': 'Impostazioni della famiglia',
  'household.close': 'Chiudi le impostazioni',
  'household.sections': 'Sezioni delle impostazioni',
  'household.tab.overview': 'Panoramica',
  'household.tab.preferences': 'Preferenze',
  'household.tab.members': 'Membri',
  'household.tab.danger': 'Zona pericolosa',

  'overview.summary': 'Riepilogo della famiglia',
  'overview.name': 'Nome della famiglia',
  'overview.createdBy': 'Creata da',
  'overview.owner': 'Proprietario',
  'overview.totalMembers': 'Membri totali',
  'overview.activeCount': '{n} attivi',
  'overview.inviteTitle': 'Invita nuovi membri',
  'overview.inviteDesc':
    'Condividi questo codice con la tua famiglia così possono unirsi alla tua lista.',
  'overview.inviteCode': 'CODICE DI INVITO',
  'overview.copyCode': 'Copia il codice',
  'overview.copied': 'Copiato!',

  'prefs.title': 'Preferenze generali',
  'prefs.nameTitle': 'Nome della famiglia',
  'prefs.nameDesc': 'Scegli un nome che tutti in famiglia riconoscano subito.',
  'prefs.namePlaceholder': 'La mia fantastica famiglia',
  'prefs.emojiTitle': 'Emoji della famiglia',
  'prefs.emojiDesc': 'Scegli un emoji per la tua famiglia. Appare nella barra in alto.',
  'prefs.limitTitle': 'Limite di articoli per persona',
  'prefs.limitDesc': 'Stabilisci quanti articoli attivi (non spuntati) può aggiungere ogni membro.',
  'prefs.limitSlider': 'Cursore del limite di articoli',

  'members.title': 'Membri della famiglia ({n})',
  'members.desc': 'Qui sotto ci sono le persone che hanno accesso a questa lista della spesa.',
  'members.you': '(Tu)',
  'members.openActions': 'Apri le azioni del membro',
  'members.promote': 'Promuovi a moderatore',
  'members.promoteHint': 'Può gestire articoli e membri',
  'members.demote': 'Retrocedi a membro',
  'members.demoteHint': 'Rimuove i permessi da moderatore',
  'members.remove': 'Rimuovi dalla famiglia',
  'members.removeHint': 'Perde l’accesso alla lista della spesa',
  'members.roleModerator': 'Moderatore',
  'members.roleMember': 'Membro',
  'members.confirmRemoveTitle': 'Rimuovere il membro?',
  'members.confirmRemoveMessage':
    'Questa persona perderà subito l’accesso alla lista della famiglia. Potrà rientrare con il codice di invito.',

  'danger.inviteTitle': 'Gestione del codice di invito',
  'danger.inviteDesc':
    'Invalida subito il codice attuale. I membri esistenti non sono toccati, ma i nuovi dovranno usare il nuovo codice.',
  'danger.regenerate': 'Rigenera',
  'danger.regenerated': 'Rigenerato',
  'danger.leaveTitle': 'Lascia la famiglia',
  'danger.leaveDesc':
    'Verrai rimosso dalla famiglia e non avrai più accesso alla lista della spesa.',
  'danger.deleteTitle': 'Elimina la famiglia',
  'danger.deleteDesc':
    'Elimina definitivamente [{name}], rimuove tutti i membri e cancella tutti i dati della lista. Non si può annullare.',
  'danger.confirmRegenerateTitle': 'Rigenerare il codice di invito?',
  'danger.confirmRegenerateMessage':
    'Il codice attuale sarà invalidato subito. I membri esistenti non sono toccati, ma nessuno potrà più entrare con il vecchio codice.',
  'danger.confirmLeaveTitle': 'Lasciare la famiglia?',
  'danger.confirmLeaveMessage':
    'Perderai l’accesso alla lista della spesa e ti servirà un nuovo codice per rientrare.',
  'danger.confirmDeleteTitle': 'Eliminare la famiglia?',
  'danger.confirmDeleteMessage':
    'Eliminare «{name}» rimuoverà definitivamente tutti i membri, gli articoli e la cronologia. Non si può annullare.',

  'history.buttonLabel': 'Cronologia degli acquisti',
  'history.title': 'Cronologia degli acquisti',
  'history.subtitle': 'I tuoi acquisti recenti',
  'history.close': 'Chiudi la cronologia',
  'history.empty': 'Ancora nessun acquisto. Gli articoli completati compariranno qui.',
  'history.you': 'Tu',
  'history.someone': 'Qualcuno',
  'history.today': 'Oggi',
  'history.yesterday': 'Ieri',

  'error.roleUpdateFailed': 'Non è stato possibile aggiornare il ruolo del membro.',
  'error.removeMemberFailed': 'Non è stato possibile rimuovere il membro.',
  'error.regenerateCodeFailed': 'Non è stato possibile rigenerare il codice di invito. Riprova.',
  'error.leaveHouseholdFailed': 'Non è stato possibile lasciare la famiglia.',
  'error.deleteHouseholdFailed': 'Non è stato possibile eliminare la famiglia.',
  'error.renameHouseholdFailed': 'Non è stato possibile rinominare la famiglia.',
  'error.saveEmojiFailed': 'Non è stato possibile salvare l’emoji della famiglia.',
  'error.saveLimitFailed': 'Non è stato possibile salvare il limite di articoli.',
  'error.loadHistoryFailed':
    'Non è stato possibile caricare la cronologia. Controlla la connessione e riprova.',

  'common.reload': 'Ricarica',
  'common.copy': 'Copia',

  'crash.text':
    'FamCart ha incontrato un errore e ha dovuto fermarsi. La tua lista è al sicuro: vive sul server, non in questa pagina.',

  'notify.title': 'Attivare le notifiche?',
  'notify.message':
    'Scopri nel momento in cui qualcuno in famiglia aggiunge qualcosa alla lista o spunta articoli, così al negozio non si dimentica nulla.',
  'notify.notNow': 'Non ora',
  'notify.turnOn': 'Attiva',

  'tour.skip': 'Salta il tour',
  'tour.next': 'Avanti',
  'tour.start': 'Inizia a fare la spesa',
  'tour.inviteCodeLabel': 'Codice di invito',
  'tour.copyInviteCode': 'Copia il codice di invito {code}',
  'tour.art.query': 'Avocado',
  'tour.art.avocado': 'Avocado',
  'tour.art.milk': 'Latte',
  'tour.art.bread': 'Pane',
  'tour.art.slide': 'Scorri per completare',
  'tour.add.title': 'Aggiungi quello che ti serve',
  'tour.add.body':
    'Inizia a digitare e compaiono i prodotti corrispondenti. Toccane uno e finisce dritto nella lista.',
  'tour.swipe.title': 'Scorri per spuntare o rimuovere',
  'tour.swipe.body':
    'Scorri una riga verso destra quando è nel carrello, o verso sinistra per toglierla dalla lista. Nessun pulsantino da centrare.',
  'tour.checkout.title': 'Scorri per completare',
  'tour.checkout.body':
    'Le righe spuntate aspettano nel carrello finché non scorri la barra in basso. È questo che le svuota e salva il giro nella tua cronologia.',
  'tour.invite.title': 'Coinvolgi la tua famiglia',
  'tour.invite.body':
    'Condividi il tuo codice di invito così tutti fanno la spesa dalla stessa lista. Ogni modifica compare per tutti nel momento stesso in cui accade.',

  'common.done': 'Fatto',
  'common.close': 'Chiudi',
  'common.tryAgain': 'Riprova',

  'login.tagline': 'La spesa di casa, [fresca insieme ogni giorno]',
  'login.logoAlt': 'Logo FamCart',
  'login.emailLabel': 'Indirizzo e-mail',
  'login.emailPlaceholder': 'tu@email.com',
  'login.codeHint': 'Inserisci il codice a 6 cifre inviato a',
  'login.codeGroupLabel': 'Codice di verifica a 6 cifre',
  'login.digitLabel': 'Cifra {i} di {n}',
  'login.or': 'o',
  'login.alreadyTitle': 'Hai già effettuato l’accesso',
  'login.alreadyMessage': 'Questo dispositivo ha già una sessione FamCart attiva.',
  'login.goToList': 'Vai alla mia lista',
  'login.errorTitle': 'Accesso non riuscito',

  'error.oauthFailed': 'Non è stato possibile accedere con quel provider.',
  'error.noEmailCode': 'Questo account non può accedere con un codice via e-mail.',
  'error.generic': 'Qualcosa è andato storto.',
  'error.verificationIncomplete': 'Verifica incompleta. Riprova.',
  'error.invalidCode': 'Codice non valido.',

  'offline.title': 'Nessuna connessione',
  'offline.text':
    'FamCart non riesce a raggiungere internet in questo momento. Controlla la connessione e la lista si caricherà appena torni online.',
  'offline.stillOffline':
    'Ancora nessuna connessione. Controlla il Wi-Fi o i dati mobili, poi riprova.',

  'update.availableTitle': 'Aggiornamento disponibile',
  'update.permissionTitle': 'Prima un permesso',
  'update.readyToInstall': 'FamCart {version} è pronta per l’installazione.',
  'update.currentVersion': 'Tu hai la {version}.',
  'update.permissionMessage':
    'Android permette a un’app di installare aggiornamenti solo dopo il tuo consenso. Attiva [Consenti da questa origine] per FamCart, poi torna e premi Aggiorna.',
  'update.downloadingMessage': 'Download di FamCart {version}…',
  'update.installingMessage':
    'Da qui in poi ci pensa Android. Segui la richiesta di installazione per finire. La tua lista e la tua famiglia restano esattamente come sono.',
  'update.failedMessage':
    'Non è stato possibile scaricare l’aggiornamento. Potrebbe essere solo la connessione. Riprova, oppure prendi l’APK dalla pagina delle release.',
  'update.progressLabel': 'Avanzamento del download',
  'update.later': 'Più tardi',
  'update.install': 'Aggiorna',
  'update.notNow': 'Non ora',
  'update.openSettings': 'Apri le impostazioni',
  'update.downloading': 'Download…',
  'update.openReleases': 'Apri le release',

  'report.title': 'Segnala un problema',
  'report.subtitle': 'Va dritto allo sviluppatore',
  'report.close': 'Chiudi la segnalazione',
  'report.sentTitle': 'Segnalazione inviata',
  'report.sentBody':
    'Non c’è altro da fare. Le segnalazioni non ricevono risposta, ma vengono lette.',
  'report.kindGroupLabel': 'Che tipo di segnalazione è?',
  'report.kindBug': 'Qualcosa è rotto',
  'report.kindIdea': 'Qualcosa potrebbe essere migliore',
  'report.whereLabel': 'Dove nell’app?',
  'report.promptBug': 'Cosa è successo?',
  'report.promptIdea': 'Cosa potrebbe essere migliore?',
  'report.placeholderBug':
    'Ho spuntato il latte ed è tornato nella lista quando ho riaperto l’app.',
  'report.placeholderIdea': 'Non è ovvio come rimuovere qualcuno dalla famiglia.',
  'report.charsLeft': '{n} caratteri rimasti',
  'report.attachedTitle': 'Inviato con la tua segnalazione',
  'report.send': 'Invia',
  'report.sending': 'Invio',
  'report.failureTitle': 'Segnalazione non inviata',
  'report.surface.list': 'Lista della spesa',
  'report.surface.add': 'Aggiunta di articoli',
  'report.surface.scan': 'Scanner di codici a barre',
  'report.surface.history': 'Completamento e cronologia',
  'report.surface.household': 'Famiglia e membri',
  'report.surface.notifications': 'Notifiche',
  'report.surface.signin': 'Accesso',
  'report.surface.other': 'Da un’altra parte',
  'report.offlineFailure':
    'Non è stato inviato nulla perché sei offline. Il tuo testo è ancora qui, quindi riprova quando torni online.',
  'report.sendFailure':
    'Non è stato inviato nulla. La segnalazione non è arrivata. Il tuo testo è ancora qui, quindi riprova. Se continua a fallire, potrebbe bloccarla un’estensione per la privacy del browser.',
  'report.diag.version': 'FamCart {version}, {platform}',
  'report.diag.pendingEdits': 'Ha modifiche in attesa di sincronizzazione',
  'report.diag.ids': 'Gli ID della tua famiglia e del tuo account',

  'common.gotIt': 'Ho capito',

  'error.limitReachedTitle': 'Limite raggiunto',
  'error.limitReached':
    'Hai raggiunto il limite di {n} articoli attivi. Spunta o elimina articoli prima di aggiungerne altri.',
  'error.offlineSyncFailed': 'Alcune modifiche fatte offline non sono state sincronizzate.',
  'error.loadHouseholdFailed': 'Non è stato possibile caricare la tua famiglia.',

  'sso.title': 'Ci siamo quasi',
  'sso.text': 'Ti riportiamo all’app FamCart…',
  'sso.open': 'Apri FamCart',

  'setup.hero.avocado': 'Avocado',
  'setup.hero.milk': 'Latte',
  'setup.hero.bread': 'Pane',

  'common.memberFallback': 'Membro',
  'account.fallbackName': 'Account',
  'topbar.householdSettings': 'Impostazioni di {name}',
  'members.sheetLabel': 'Azioni per {name}',
  'members.sheetLabelGeneric': 'Azioni per questo membro',
  'preferences.useEmoji': 'Usa {emoji} per questa famiglia',
  'history.addedBy': 'Aggiunto da {name}',
  'history.addedThis': '{name} ha aggiunto questo',

  'item.swipeLabelCheck': '{name}. Scorri a destra per spuntare, a sinistra per rimuovere',
  'item.swipeLabelUncheck':
    '{name}. Scorri a destra per togliere la spunta, a sinistra per rimuovere',
  'item.swipeLabelCheckQty':
    '{name}, quantità {n}. Scorri a destra per spuntare, a sinistra per rimuovere',
  'item.swipeLabelUncheckQty':
    '{name}, quantità {n}. Scorri a destra per togliere la spunta, a sinistra per rimuovere',

  'invite.shareTitle': 'Unisciti a {name} su FamCart',
  'invite.shareTitleGeneric': 'Unisciti alla mia famiglia su FamCart',
  'invite.shareBody':
    'Unisciti a «{name}» su FamCart così condividiamo una lista della spesa. Il tuo codice di invito è {code}.',
  'invite.shareBodyGeneric':
    'Unisciti alla mia famiglia su FamCart così condividiamo una lista della spesa. Il tuo codice di invito è {code}.',
  'invite.shareDialogTitle': 'Invita su FamCart',

  'error.loadListFailed': 'Non è stato possibile caricare la lista. Riprova.',
  'error.addItemFailed': 'Non è stato possibile aggiungere il prodotto.',
  'error.addItemGeneric': 'Aggiunta del prodotto non riuscita.',
  'error.addTooFast': 'Stai aggiungendo prodotti troppo in fretta. Aspetta un minuto e riprova.',
  'error.updateItemFailed': 'Non è stato possibile aggiornare il prodotto.',
  'error.mergeItemsFailed': 'Non è stato possibile unire quei prodotti.',
  'error.deleteItemFailed': 'Non è stato possibile eliminare il prodotto.',
  'error.checkoutFailed': 'Non è stato possibile completare la spesa.',
  'error.itemNameTooLong': 'Il nome del prodotto deve avere al massimo {max} caratteri.',
  'error.notificationsFromSettings':
    'Non è stato possibile attivare le notifiche. Puoi riprovare dalle Impostazioni account.',
}

export default it
