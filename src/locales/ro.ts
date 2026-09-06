// Romanian. See en.ts for what a catalog is and how keys are named.
//
// The plural entries carry three forms where English carries two, and the third
// is the one a translator unfamiliar with the rule will get wrong: `few` covers
// 0 and 2-19, `other` starts at 20 AND takes the "de" ("20 de produse", not
// "20 produse"). Intl.PluralRules picks between them; test/localeCatalogs
// checks the forms exist.
import type { Catalog } from '../lib/i18n'

const ro: Catalog = {
  'common.back': 'Înapoi',
  'common.ok': 'OK',
  'common.cancel': 'Anulează',
  'common.closeModal': 'Închide fereastra',
  'common.confirm': 'Confirmă',
  'common.continue': 'Continuă',

  'language.groupLabel': 'Alege o limbă',

  'setup.language.eyebrow': 'Bun venit 🌍',
  'setup.language.title': 'Alege-ți [limba]',
  'setup.language.sub': 'O poți schimba oricând din Setările aplicației.',

  'setup.welcome.eyebrow': 'Bun venit la FamCart 🛒',
  'setup.welcome.title': 'Lista pe care o împarte toată [gospodăria]',
  'setup.welcome.sub':
    'Toată lumea adaugă, toată lumea bifează, iar totul se actualizează pentru toată gospodăria în clipa în care se întâmplă, ca să nu se uite nimic la magazin.',
  'setup.welcome.cta': 'Începe',

  'setup.picker.eyebrowAdd': 'Adaugă o gospodărie',
  'setup.picker.eyebrowNew': 'Bine ai venit 👋',
  'setup.picker.titleAdd': 'Adaugă altă [gospodărie]',
  'setup.picker.titleNew': 'Configurează-ți [gospodăria]',
  'setup.picker.subAdd': 'Alătură-te altei gospodării cu codul lor de invitație.',
  'setup.picker.subAddOrCreate':
    'Alătură-te altei gospodării cu codul lor de invitație sau creează una nouă.',
  'setup.picker.subNew':
    'Creează o listă de cumpărături comună pentru gospodăria ta sau alătură-te uneia folosind un cod de invitație.',
  'setup.picker.createLabel': 'Creează o gospodărie',
  'setup.picker.createDescription': 'Începe o listă nouă și primești un cod de invitație',
  'setup.picker.joinLabel': 'Alătură-te unei gospodării',
  'setup.picker.joinDescription': 'Lipește codul de invitație primit de la gospodăria ta',

  'setup.create.eyebrow': 'Gospodărie nouă',
  'setup.create.title': 'Cum se numește gospodăria ta?',
  'setup.create.sub': 'Așa va apărea lista gospodăriei pentru toată lumea.',
  'setup.create.nameLabel': 'Numele gospodăriei',
  'setup.create.namePlaceholder': 'ex. Familia Popescu',

  'setup.join.eyebrow': 'Alătură-te unei gospodării',
  'setup.join.title': 'Introdu codul de invitație',
  'setup.join.sub': 'Cere codul de invitație unui membru al gospodăriei.',
  'setup.join.codeLabel': 'Cod de invitație',
  'setup.join.codePlaceholder': 'ex. AB3K7XYZ',

  'settings.title': 'Setările aplicației',
  'settings.subtitle': 'Cum arată și cum se comportă FamCart pe acest dispozitiv',
  'settings.close': 'Închide setările aplicației',
  'settings.appearance': 'Aspect',
  'settings.theme.light': 'Luminos',
  'settings.theme.dark': 'Întunecat',
  'settings.theme.system': 'Sistem',
  'settings.notifications': 'Notificări',
  'settings.notifications.on': 'Pornit',
  'settings.notifications.off': 'Oprit',
  'settings.language': 'Limbă',
  'settings.about': 'Despre',
  'settings.aboutHint': 'FamCart v{version}',

  'about.versionLine': 'v{version}',
  'about.close': 'Închide fereastra Despre',
  'about.checkUpdates': 'Caută actualizări',
  'about.checking': 'Se caută…',
  'about.upToDate': 'FamCart este la zi.',
  'about.checkFailed':
    'Nu s-a putut contacta GitHub pentru verificare. Încearcă din nou când ești online.',
  'about.creditLead': 'Date despre produse de la',
  'about.creditAnd': 'și',
  'about.creditEnd': '.',

  'error.genericTitle': 'Ceva nu a mers bine',
  'error.offline': 'Se pare că ești offline. Verifică conexiunea și încearcă din nou.',
  'error.nameTooLongTitle': 'Nume prea lung',
  'error.householdNameTooLong': 'Numele gospodăriei trebuie să aibă cel mult {max} caractere.',
  'error.ownOneHousehold':
    'Poți deține o singură gospodărie. Părăsește-o sau șterge-o pe cea actuală înainte de a crea alta.',
  'error.membershipCapCreate':
    'Poți face parte din cel mult {cap} gospodării. Părăsește una înainte de a crea alta.',
  'error.membershipCapJoin':
    'Poți face parte din cel mult {cap} gospodării. Părăsește una înainte de a te alătura alteia.',
  'error.createHouseholdFailed': 'Crearea gospodăriei a eșuat.',
  'error.joinHouseholdFailed': 'Alăturarea la gospodărie a eșuat.',
  'error.inviteCodeInvalid':
    'Codul de invitație trebuie să aibă 8 caractere, doar litere și cifre.',
  'error.noHouseholdForCode': 'Nu există nicio gospodărie cu acest cod de invitație.',
  'error.notificationsBlocked':
    'Notificările sunt blocate pentru FamCart în setările dispozitivului sau ale browserului.',
  'error.notificationsFailed': 'Notificările nu au putut fi activate. Încearcă din nou.',

  'list.meta.toBuy': 'De cumpărat',
  'list.meta.checked': 'Bifate',
  'list.meta.itemCount': { one: '{n} produs', few: '{n} produse', other: '{n} de produse' },
  'list.meta.leftCount': { one: '{n} rămas', few: '{n} rămase', other: '{n} rămase' },
  'list.filteredEmpty.checked': 'Nu ai bifat nimic încă.',
  'list.filteredEmpty.active': 'Totul de aici este bifat.',
  'list.filteredEmpty.shop': 'Nimic din lista asta nu se vinde la {shop}.',
  'list.empty.titleShopped': 'Totul cumpărat',
  'list.empty.titleNew': 'Nimic aici încă',
  'list.empty.textShopped': 'Nu mai e nimic de luat.',
  'list.empty.textNew': 'Adaugă primul lucru și toată lumea din gospodărie îl vede imediat.',
  'list.buyAgain': 'Cumpără din nou',
  'list.addProduct': 'Adaugă {name}',
  'list.buyBar.checkedOut': 'Finalizat!',
  'list.buyBar.slide': {
    one: 'Glisează pentru a finaliza {n} produs',
    few: 'Glisează pentru a finaliza {n} produse',
    other: 'Glisează pentru a finaliza {n} de produse',
  },
  'list.buyBar.checkOut': {
    one: 'Finalizează {n} produs',
    few: 'Finalizează {n} produse',
    other: 'Finalizează {n} de produse',
  },

  'item.gotIt': 'Am luat',
  'item.uncheck': 'Debifează',
  'item.remove': 'Șterge',
  'item.oneFewer': 'Unul mai puțin',
  'item.oneMore': 'Încă unul',
  'item.quantity': 'Cantitate {n}',
  'item.quantityDone': 'Cantitate {n}. Gata',
  'item.quantityChange': 'Cantitate {n}. Modifică',

  'filter.buttonLabel': 'Filtrează produsele',
  'filter.buttonLabelFiltered': 'Filtrează produsele (filtrat)',
  'filter.heading': 'Filtre',
  'filter.hint': 'Ce afișează lista',
  'filter.all.label': 'Fără filtru',
  'filter.all.hint': 'Tot ce e pe listă',
  'filter.active.label': 'De cumpărat',
  'filter.active.hint': 'Rămase de luat',
  'filter.checked.label': 'Bifate',
  'filter.checked.hint': 'În coș, gata de finalizare',
  'filter.shopHeading': 'Magazin',
  'filter.shopAny.label': 'Orice magazin',
  'filter.shopAny.hint': 'Tot, indiferent de unde vine',
  'filter.shopOne.hint': 'Se vinde la {shop}, plus ce nu știm de unde se ia',

  'add.inputLabel': 'Adaugă un produs',
  'add.inputPlaceholder': 'Adaugă un produs…',
  'add.scanLabel': 'Scanează un cod de bare',
  'add.submitLabel': 'Adaugă',
  'add.listRecents': 'Produse pe care le cumperi des',
  'add.listSuggestions': 'Sugestii de produse',
  'add.onYourList': 'pe lista ta',
  'add.cantFind': 'Nu îl găsești?',
  'add.addYourOwn': 'Adaugă-l tu',
  'add.typeToSearch': 'Scrie numele unui produs pentru a căuta.',
  'add.shopFilter': 'Filtrează după magazin',
  'add.shopAll': 'Toate magazinele',
  'add.announced': '{name} adăugat pe lista ta',

  'custom.message':
    'Descrie-l și ajunge direct pe lista ta. Data viitoare îl vom sugera gospodăriei tale.',
  'custom.productLabel': 'Produs',
  'custom.productPlaceholder': 'Ulei de măsline 500ml',
  'custom.makerLabel': 'Producător',
  'custom.makerPlaceholder': 'Bertolli',
  'custom.optional': 'opțional',
  'custom.barcodeLabel': 'Cod de bare',
  'custom.barcodePlaceholder': '8 până la 14 cifre',
  'custom.barcodeNote': 'Se salvează cu produsul, ca următoarea scanare să îl găsească.',
  'custom.barcodeInvalid': 'Un cod de bare are între 8 și 14 cifre. Golește câmpul ca să îl sari.',
  'custom.submit': 'Adaugă pe listă',

  'scanner.pointCamera': 'Îndreaptă camera spre un cod de bare',
  'scanner.starting': 'Se pornește camera',
  'scanner.tryAgain': 'Încearcă din nou',
  'scanner.notInCatalog': 'Nu e în catalog',
  'scanner.lookingUp': 'Se caută',
  'scanner.denied.title': 'FamCart nu are acces la cameră',
  'scanner.denied.detail': 'Permite camera pentru această aplicație, apoi încearcă din nou.',
  'scanner.unavailable.title': 'Acest dispozitiv nu poate scana',
  'scanner.unavailable.detail': 'Adaugă produsul după nume.',
  'scanner.error.title': 'Camera nu a pornit',
  'scanner.error.detail': 'Poate o folosește altă aplicație.',
  'scanner.timeout.title': 'Camera nu a răspuns',
  'scanner.timeout.detail':
    'Dacă nimic nu a cerut acces la cameră, verifică permisiunea de cameră a FamCart în setările dispozitivului.',

  'common.save': 'Salvează',
  'common.saved': 'Salvat',
  'common.avatarAlt': 'Avatarul {name}',

  'topbar.history': 'Istoricul cumpărăturilor',
  'topbar.account': 'Contul tău',
  'topbar.avatarAlt': 'Avatarul tău',

  'account.title': 'Setările contului',
  'account.subtitle': 'Gestionează-ți profilul și preferințele',
  'account.close': 'Închide fereastra contului',
  'account.editProfile': 'Editează-ți profilul: nume, poză, parolă',
  'account.noEmail': 'Niciun e-mail disponibil',
  'account.manageHousehold': 'Gestionează gospodăria',
  'account.householdFallback': 'Gospodărie',
  'account.invitePeople': 'Invită persoane',
  'account.memberCount': { one: '{n} membru', few: '{n} membri', other: '{n} de membri' },
  'account.appSettings': 'Setările aplicației',
  'account.appSettingsHint': 'Aspect, notificări, limbă',
  'account.current': 'Curentă',
  'account.joinOrCreate': 'Alătură-te sau creează o gospodărie',
  'account.reportIssue': 'Raportează o problemă',
  'account.reportHint': 'Erori și sugestii',
  'account.signOut': 'Deconectează-te',
  'account.signingOut': 'Se deconectează',

  'household.settingsIcon': 'Setări',
  'household.title': 'Setările gospodăriei',
  'household.close': 'Închide setările',
  'household.sections': 'Secțiunile setărilor',
  'household.tab.overview': 'Prezentare',
  'household.tab.preferences': 'Preferințe',
  'household.tab.members': 'Membri',
  'household.tab.danger': 'Zonă periculoasă',

  'overview.summary': 'Sumarul gospodăriei',
  'overview.name': 'Numele gospodăriei',
  'overview.createdBy': 'Creată de',
  'overview.owner': 'Proprietar',
  'overview.totalMembers': 'Total membri',
  'overview.activeCount': '{n} activi',
  'overview.inviteTitle': 'Invită membri noi',
  'overview.inviteDesc': 'Trimite acest cod membrilor gospodăriei ca să se alăture listei tale.',
  'overview.inviteCode': 'COD DE INVITAȚIE',
  'overview.copyCode': 'Copiază codul',
  'overview.copied': 'Copiat!',

  'prefs.title': 'Preferințe generale',
  'prefs.nameTitle': 'Numele gospodăriei',
  'prefs.nameDesc': 'Alege un nume pe care toți din gospodărie îl recunosc repede.',
  'prefs.namePlaceholder': 'Gospodăria mea grozavă',
  'prefs.emojiTitle': 'Emoji-ul gospodăriei',
  'prefs.emojiDesc': 'Alege un emoji pentru gospodărie. Apare în bara de sus.',
  'prefs.limitTitle': 'Limită de produse per membru',
  'prefs.limitDesc': 'Stabilește câte produse active (nebifate) poate adăuga fiecare membru.',
  'prefs.limitSlider': 'Cursor pentru limita de produse',

  'members.title': 'Membrii gospodăriei ({n})',
  'members.desc': 'Mai jos sunt persoanele care au acces la această listă de cumpărături.',
  'members.you': '(Tu)',
  'members.openActions': 'Deschide acțiunile pentru membru',
  'members.promote': 'Promovează la moderator',
  'members.promoteHint': 'Poate gestiona produsele și membrii',
  'members.demote': 'Retrogradează la membru',
  'members.demoteHint': 'Elimină permisiunile de moderator',
  'members.remove': 'Elimină din gospodărie',
  'members.removeHint': 'Pierde accesul la lista de cumpărături',
  'members.roleModerator': 'Moderator',
  'members.roleMember': 'Membru',
  'members.confirmRemoveTitle': 'Elimini membrul?',
  'members.confirmRemoveMessage':
    'Persoana va pierde imediat accesul la lista gospodăriei. Se poate alătura din nou cu codul de invitație.',

  'danger.inviteTitle': 'Administrarea codului de invitație',
  'danger.inviteDesc':
    'Invalidează imediat codul actual. Membrii existenți nu sunt afectați, dar cei viitori trebuie să folosească noul cod.',
  'danger.regenerate': 'Regenerează',
  'danger.regenerated': 'Regenerat',
  'danger.leaveTitle': 'Părăsește gospodăria',
  'danger.leaveDesc':
    'Vei fi eliminat din gospodărie. Nu vei mai avea acces la lista de cumpărături.',
  'danger.deleteTitle': 'Șterge gospodăria',
  'danger.deleteDesc':
    'Șterge definitiv [{name}], elimină toți membrii și șterge toate datele listei. Această acțiune nu poate fi anulată.',
  'danger.confirmRegenerateTitle': 'Regenerezi codul de invitație?',
  'danger.confirmRegenerateMessage':
    'Codul actual va fi invalidat imediat. Membrii existenți nu sunt afectați, dar nimeni cu codul vechi nu se va mai putea alătura.',
  'danger.confirmLeaveTitle': 'Părăsești gospodăria?',
  'danger.confirmLeaveMessage':
    'Vei pierde accesul la lista de cumpărături și vei avea nevoie de un cod nou ca să revii.',
  'danger.confirmDeleteTitle': 'Ștergi gospodăria?',
  'danger.confirmDeleteMessage':
    'Ștergerea „{name}” va elimina definitiv toți membrii, produsele și istoricul. Această acțiune nu poate fi anulată.',

  'history.buttonLabel': 'Istoricul cumpărăturilor',
  'history.title': 'Istoricul finalizărilor',
  'history.subtitle': 'Finalizările tale recente',
  'history.close': 'Închide istoricul',
  'history.empty': 'Încă nicio finalizare. Produsele finalizate vor apărea aici.',
  'history.you': 'Tu',
  'history.someone': 'Cineva',
  'history.today': 'Azi',
  'history.yesterday': 'Ieri',

  'error.roleUpdateFailed': 'Rolul membrului nu a putut fi actualizat.',
  'error.removeMemberFailed': 'Membrul nu a putut fi eliminat.',
  'error.regenerateCodeFailed': 'Codul de invitație nu a putut fi regenerat. Încearcă din nou.',
  'error.leaveHouseholdFailed': 'Nu ai putut părăsi gospodăria.',
  'error.deleteHouseholdFailed': 'Gospodăria nu a putut fi ștearsă.',
  'error.renameHouseholdFailed': 'Gospodăria nu a putut fi redenumită.',
  'error.saveEmojiFailed': 'Emoji-ul gospodăriei nu a putut fi salvat.',
  'error.saveLimitFailed': 'Limita de produse nu a putut fi salvată.',
  'error.loadHistoryFailed':
    'Istoricul nu a putut fi încărcat. Verifică conexiunea și încearcă din nou.',

  'common.reload': 'Reîncarcă',
  'common.copy': 'Copiază',

  'crash.text':
    'FamCart a întâmpinat o eroare și a trebuit să se oprească. Lista ta este în siguranță. Ea se află pe server, nu în această pagină.',

  'notify.title': 'Activezi notificările?',
  'notify.message':
    'Află pe loc când cineva din gospodărie adaugă ceva pe listă sau bifează produse, ca să nu se uite nimic la magazin.',
  'notify.notNow': 'Nu acum',
  'notify.turnOn': 'Activează',

  'tour.skip': 'Sari peste tur',
  'tour.next': 'Următorul',
  'tour.start': 'Începe cumpărăturile',
  'tour.inviteCodeLabel': 'Cod de invitație',
  'tour.copyInviteCode': 'Copiază codul de invitație {code}',
  'tour.art.query': 'Avocado',
  'tour.art.avocado': 'Avocado',
  'tour.art.milk': 'Lapte',
  'tour.art.bread': 'Pâine',
  'tour.art.slide': 'Glisează pentru a finaliza',
  'tour.add.title': 'Adaugă ce ai nevoie',
  'tour.add.body':
    'Începe să scrii și apar produsele potrivite. Atinge unul și ajunge direct pe listă.',
  'tour.swipe.title': 'Glisează pentru a bifa sau șterge',
  'tour.swipe.body':
    'Glisează un rând spre dreapta odată ce e în coș, sau spre stânga ca să îl scoți de pe listă. Fără butoane mici de nimerit.',
  'tour.checkout.title': 'Glisează pentru a finaliza',
  'tour.checkout.body':
    'Rândurile bifate așteaptă în coș până glisezi bara de jos. Asta le șterge și salvează drumul în istoricul tău.',
  'tour.invite.title': 'Adu-ți gospodăria alături',
  'tour.invite.body':
    'Trimite codul de invitație ca toți să cumpere de pe aceeași listă. Fiecare schimbare apare la toți în clipa în care se întâmplă.',

  'common.done': 'Gata',
  'common.close': 'Închide',
  'common.tryAgain': 'Încearcă din nou',

  'login.tagline': 'Cumpărături pentru gospodărie, [proaspete împreună zilnic]',
  'login.logoAlt': 'Logoul FamCart',
  'login.emailLabel': 'Adresă de e-mail',
  'login.emailPlaceholder': 'tu@email.com',
  'login.codeHint': 'Introdu codul de 6 cifre trimis la',
  'login.codeGroupLabel': 'Cod de verificare din 6 cifre',
  'login.digitLabel': 'Cifra {i} din {n}',
  'login.or': 'sau',
  'login.alreadyTitle': 'Ești deja conectat',
  'login.alreadyMessage': 'Acest dispozitiv are deja o sesiune FamCart activă.',
  'login.goToList': 'Mergi la lista mea',
  'login.errorTitle': 'Conectarea nu a reușit',

  'error.oauthFailed': 'Conectarea cu acest furnizor nu a reușit.',
  'error.noEmailCode': 'Acest cont nu se poate conecta cu un cod pe e-mail.',
  'error.generic': 'Ceva nu a mers bine.',
  'error.verificationIncomplete': 'Verificare incompletă. Încearcă din nou.',
  'error.invalidCode': 'Cod invalid.',

  'offline.title': 'Fără conexiune',
  'offline.text':
    'FamCart nu poate ajunge la internet acum. Verifică conexiunea și lista se va încărca de îndată ce revii online.',
  'offline.stillOffline':
    'Tot fără conexiune. Verifică Wi-Fi sau datele mobile, apoi încearcă din nou.',

  'update.availableTitle': 'Actualizare disponibilă',
  'update.permissionTitle': 'Mai întâi o permisiune',
  'update.readyToInstall': 'FamCart {version} este gata de instalare.',
  'update.currentVersion': 'Tu ai {version}.',
  'update.permissionMessage':
    'Android permite unei aplicații să instaleze actualizări doar după ce îi dai voie. Activează [Permite din această sursă] pentru FamCart, apoi revino și apasă Actualizează.',
  'update.downloadingMessage': 'Se descarcă FamCart {version}…',
  'update.installingMessage':
    'De aici preia Android. Urmează pașii de instalare pentru a termina. Lista și gospodăria ta rămân exact cum sunt.',
  'update.failedMessage':
    'Actualizarea nu a putut fi descărcată. Poate fi doar conexiunea. Încearcă din nou sau ia APK-ul din pagina de versiuni.',
  'update.progressLabel': 'Progresul descărcării',
  'update.later': 'Mai târziu',
  'update.install': 'Actualizează',
  'update.notNow': 'Nu acum',
  'update.openSettings': 'Deschide setările',
  'update.downloading': 'Se descarcă…',
  'update.openReleases': 'Deschide versiunile',

  'report.title': 'Raportează o problemă',
  'report.subtitle': 'Ajunge direct la dezvoltator',
  'report.close': 'Închide raportul',
  'report.sentTitle': 'Raport trimis',
  'report.sentBody': 'Nu mai ai nimic de făcut. Rapoartele nu primesc răspuns, dar sunt citite.',
  'report.kindGroupLabel': 'Ce fel de raport este acesta?',
  'report.kindBug': 'Ceva e stricat',
  'report.kindIdea': 'Ceva ar putea fi mai bun',
  'report.whereLabel': 'Unde în aplicație?',
  'report.promptBug': 'Ce s-a întâmplat?',
  'report.promptIdea': 'Ce ar putea fi mai bun?',
  'report.placeholderBug': 'Am bifat laptele și a revenit pe listă când am redeschis aplicația.',
  'report.placeholderIdea': 'Nu e evident cum se scoate cineva din gospodărie.',
  'report.charsLeft': '{n} caractere rămase',
  'report.attachedTitle': 'Trimis împreună cu raportul',
  'report.send': 'Trimite',
  'report.sending': 'Se trimite',
  'report.failureTitle': 'Raportul nu a fost trimis',
  'report.surface.list': 'Lista de cumpărături',
  'report.surface.add': 'Adăugarea produselor',
  'report.surface.scan': 'Scanerul de coduri',
  'report.surface.history': 'Finalizare și istoric',
  'report.surface.household': 'Gospodărie și membri',
  'report.surface.notifications': 'Notificări',
  'report.surface.signin': 'Conectarea',
  'report.surface.other': 'În altă parte',
  'report.offlineFailure':
    'Nu s-a trimis nimic pentru că ești offline. Textul tău e încă aici, așa că încearcă din nou când revii.',
  'report.sendFailure':
    'Nu s-a trimis nimic. Raportul nu a ajuns la noi. Textul tău e încă aici, deci încearcă din nou. Dacă tot nu merge, o extensie de confidențialitate din browser poate să îl blocheze.',
  'report.diag.version': 'FamCart {version}, {platform}',
  'report.diag.pendingEdits': 'Are modificări în așteptare de sincronizare',
  'report.diag.ids': 'ID-urile gospodăriei și contului tău',

  'common.gotIt': 'Am înțeles',

  'error.limitReachedTitle': 'Limită atinsă',
  'error.limitReached':
    'Ai atins limita de {n} produse active. Bifează sau șterge produse înainte de a adăuga altele.',
  'error.offlineSyncFailed': 'Unele modificări făcute offline nu au putut fi sincronizate.',
  'error.loadHouseholdFailed': 'Gospodăria ta nu a putut fi încărcată.',

  'sso.title': 'Aproape gata',
  'sso.text': 'Te ducem înapoi în aplicația FamCart…',
  'sso.open': 'Deschide FamCart',

  'setup.hero.avocado': 'Avocado',
  'setup.hero.milk': 'Lapte',
  'setup.hero.bread': 'Pâine',

  'common.memberFallback': 'Membru',
  'account.fallbackName': 'Cont',
  'topbar.householdSettings': 'Setări pentru {name}',
  'members.sheetLabel': 'Acțiuni pentru {name}',
  'members.sheetLabelGeneric': 'Acțiuni pentru acest membru',
  'preferences.useEmoji': 'Folosește {emoji} pentru această gospodărie',
  'history.addedBy': 'Adăugat de {name}',
  'history.addedThis': '{name} a adăugat acest produs',

  'item.swipeLabelCheck': '{name}. Glisează la dreapta pentru a bifa, la stânga pentru a șterge',
  'item.swipeLabelUncheck': '{name}. Glisează la dreapta pentru a debifa, la stânga pentru a șterge',
  'item.swipeLabelCheckQty':
    '{name}, cantitate {n}. Glisează la dreapta pentru a bifa, la stânga pentru a șterge',
  'item.swipeLabelUncheckQty':
    '{name}, cantitate {n}. Glisează la dreapta pentru a debifa, la stânga pentru a șterge',

  'invite.shareTitle': 'Alătură-te gospodăriei {name} pe FamCart',
  'invite.shareTitleGeneric': 'Alătură-te gospodăriei mele pe FamCart',
  'invite.shareBody':
    'Alătură-te gospodăriei „{name}” pe FamCart ca să avem o listă de cumpărături comună. Codul tău de invitație este {code}.',
  'invite.shareBodyGeneric':
    'Alătură-te gospodăriei mele pe FamCart ca să avem o listă de cumpărături comună. Codul tău de invitație este {code}.',
  'invite.shareDialogTitle': 'Invitație la FamCart',

  'error.loadListFailed': 'Lista nu a putut fi încărcată. Încearcă din nou.',
  'error.addItemFailed': 'Produsul nu a putut fi adăugat.',
  'error.addItemGeneric': 'Adăugarea produsului a eșuat.',
  'error.addTooFast': 'Adaugi produse prea repede. Așteaptă un minut și încearcă din nou.',
  'error.updateItemFailed': 'Produsul nu a putut fi actualizat.',
  'error.mergeItemsFailed': 'Produsele nu au putut fi combinate.',
  'error.deleteItemFailed': 'Produsul nu a putut fi șters.',
  'error.checkoutFailed': 'Finalizarea cumpărăturilor nu a reușit.',
  'error.itemNameTooLong': 'Numele produsului trebuie să aibă cel mult {max} caractere.',
  'error.notificationsFromSettings':
    'Notificările nu au putut fi activate. Poți încerca din nou din Setările contului.',
}

export default ro
