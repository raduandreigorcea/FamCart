// French. See en.ts for what a catalog is and how keys are named.
//
// French has a `many` plural category, but Intl only selects it at exact
// millions, which a shopping list will never reach. The entries here carry
// one/other and let tn()'s `other` fallback cover it.
import type { Catalog } from '../lib/i18n'

const fr: Catalog = {
  'common.back': 'Retour',
  'common.ok': 'OK',
  'common.cancel': 'Annuler',
  'common.closeModal': 'Fermer la boîte de dialogue',
  'common.confirm': 'Confirmer',
  'common.continue': 'Continuer',

  'language.groupLabel': 'Choisissez une langue',

  'setup.language.eyebrow': 'Bienvenue 🌍',
  'setup.language.title': 'Choisissez votre [langue]',
  'setup.language.sub': 'Vous pourrez la changer à tout moment dans les Réglages de l’app.',

  'setup.welcome.eyebrow': 'Bienvenue sur FamCart 🛒',
  'setup.welcome.title': 'La liste que partage tout le [foyer]',
  'setup.welcome.sub':
    'Chacun ajoute, chacun coche, et tout se met à jour pour le foyer entier à l’instant même, pour ne rien oublier en magasin.',
  'setup.welcome.cta': 'Commencer',

  'setup.picker.eyebrowAdd': 'Ajouter un foyer',
  'setup.picker.eyebrowNew': 'Bienvenue à bord 👋',
  'setup.picker.titleAdd': 'Ajouter un autre [foyer]',
  'setup.picker.titleNew': 'Configurez votre [foyer]',
  'setup.picker.subAdd': 'Rejoignez un autre foyer avec son code d’invitation.',
  'setup.picker.subAddOrCreate':
    'Rejoignez un autre foyer avec son code d’invitation, ou créez-en un nouveau.',
  'setup.picker.subNew':
    'Créez une liste de courses partagée pour votre foyer, ou rejoignez-en une avec un code d’invitation.',
  'setup.picker.createLabel': 'Créer un foyer',
  'setup.picker.createDescription': 'Démarrez une nouvelle liste et obtenez un code d’invitation',
  'setup.picker.joinLabel': 'Rejoindre un foyer',
  'setup.picker.joinDescription': 'Collez le code d’invitation que votre foyer a partagé',

  'setup.create.eyebrow': 'Nouveau foyer',
  'setup.create.title': 'Quel est le nom de votre foyer ?',
  'setup.create.sub': 'C’est ainsi que la liste de votre foyer apparaîtra pour tout le monde.',
  'setup.create.nameLabel': 'Nom du foyer',
  'setup.create.namePlaceholder': 'p. ex. Les Dupont',

  'setup.join.eyebrow': 'Rejoindre un foyer',
  'setup.join.title': 'Saisissez votre code d’invitation',
  'setup.join.sub': 'Demandez le code d’invitation à un membre du foyer.',
  'setup.join.codeLabel': 'Code d’invitation',
  'setup.join.codePlaceholder': 'p. ex. AB3K7XYZ',

  'settings.title': 'Réglages de l’app',
  'settings.subtitle': 'L’apparence et le comportement de FamCart sur cet appareil',
  'settings.close': 'Fermer les réglages de l’app',
  'settings.appearance': 'Apparence',
  'settings.theme.light': 'Clair',
  'settings.theme.dark': 'Sombre',
  'settings.theme.system': 'Système',
  'settings.notifications': 'Notifications',
  'settings.notifications.on': 'Activées',
  'settings.notifications.off': 'Désactivées',
  'settings.language': 'Langue',
  'settings.about': 'À propos',
  'settings.aboutHint': 'FamCart v{version}',

  'about.versionLine': 'v{version}',
  'about.close': 'Fermer À propos',
  'about.checkUpdates': 'Rechercher des mises à jour',
  'about.checking': 'Recherche…',
  'about.upToDate': 'FamCart est à jour.',
  'about.checkFailed':
    'Impossible de joindre GitHub. Réessayez une fois de retour en ligne.',
  'about.creditLead': 'Données produits de',
  'about.creditAnd': 'et',
  'about.creditEnd': '.',

  'error.genericTitle': 'Une erreur est survenue',
  'error.offline': 'Vous semblez hors ligne. Vérifiez votre connexion et réessayez.',
  'error.nameTooLongTitle': 'Nom trop long',
  'error.householdNameTooLong': 'Le nom du foyer doit comporter au maximum {max} caractères.',
  'error.ownOneHousehold':
    'Vous ne pouvez posséder qu’un seul foyer. Quittez ou supprimez le vôtre avant d’en créer un autre.',
  'error.membershipCapCreate':
    'Vous pouvez faire partie de {cap} foyers au maximum. Quittez-en un avant d’en créer un autre.',
  'error.membershipCapJoin':
    'Vous pouvez faire partie de {cap} foyers au maximum. Quittez-en un avant d’en rejoindre un autre.',
  'error.createHouseholdFailed': 'Impossible de créer le foyer.',
  'error.joinHouseholdFailed': 'Impossible de rejoindre le foyer.',
  'error.inviteCodeInvalid':
    'Le code d’invitation doit comporter 8 caractères, lettres et chiffres uniquement.',
  'error.noHouseholdForCode': 'Aucun foyer trouvé avec ce code d’invitation.',
  'error.notificationsBlocked':
    'Les notifications sont bloquées pour FamCart dans les réglages de votre appareil ou navigateur.',
  'error.notificationsFailed': 'Impossible d’activer les notifications. Veuillez réessayer.',

  'list.meta.toBuy': 'À acheter',
  'list.meta.checked': 'Cochés',
  'list.meta.itemCount': { one: '{n} article', other: '{n} articles' },
  'list.meta.leftCount': { one: '{n} restant', other: '{n} restants' },
  'list.filteredEmpty.checked': 'Rien de coché pour l’instant.',
  'list.filteredEmpty.active': 'Tout est coché ici.',
  'list.filteredEmpty.shop': 'Rien dans cette liste ne se vend chez {shop}.',
  'list.empty.titleShopped': 'Tout est acheté',
  'list.empty.titleNew': 'Rien ici pour l’instant',
  'list.empty.textShopped': 'Il ne reste rien à prendre.',
  'list.empty.textNew': 'Ajoutez la première chose et tout le foyer la voit aussitôt.',
  'list.buyAgain': 'Racheter',
  'list.addProduct': 'Ajouter {name}',
  'list.buyBar.checkedOut': 'Validé !',
  'list.buyBar.slide': {
    one: 'Glissez pour valider {n} article',
    other: 'Glissez pour valider {n} articles',
  },
  'list.buyBar.checkOut': { one: 'Valider {n} article', other: 'Valider {n} articles' },

  'item.gotIt': 'C’est pris',
  'item.uncheck': 'Décocher',
  'item.remove': 'Retirer',
  'item.oneFewer': 'Un de moins',
  'item.oneMore': 'Un de plus',
  'item.quantity': 'Quantité {n}',
  'item.quantityDone': 'Quantité {n}. Terminé',
  'item.quantityChange': 'Quantité {n}. Modifier',

  'filter.buttonLabel': 'Filtrer les articles',
  'filter.buttonLabelFiltered': 'Filtrer les articles (filtré)',
  'filter.heading': 'Filtres',
  'filter.hint': 'Ce que montre cette liste',
  'filter.all.label': 'Aucun filtre',
  'filter.all.hint': 'Tout ce qui est sur la liste',
  'filter.active.label': 'À acheter',
  'filter.active.hint': 'Encore à prendre',
  'filter.checked.label': 'Cochés',
  'filter.checked.hint': 'Dans le panier, prêts à valider',
  'filter.shopHeading': 'Magasin',
  'filter.shopAny.label': 'Tous les magasins',
  'filter.shopAny.hint': 'Tout, d’où que ça vienne',
  'filter.shopOne.hint': 'Vendu chez {shop}, plus ce dont on ignore la provenance',

  'add.inputLabel': 'Ajouter un article',
  'add.inputPlaceholder': 'Ajouter un article…',
  'add.scanLabel': 'Scanner un code-barres',
  'add.submitLabel': 'Ajouter',
  'add.listRecents': 'Produits que vous achetez souvent',
  'add.listSuggestions': 'Suggestions de produits',
  'add.onYourList': 'sur votre liste',
  'add.cantFind': 'Vous ne le trouvez pas ?',
  'add.addYourOwn': 'Ajoutez le vôtre',
  'add.typeToSearch': 'Saisissez un nom de produit pour rechercher.',
  'add.shopFilter': 'Filtrer par magasin',
  'add.shopAll': 'Tous les magasins',
  'add.announced': '{name} ajouté à votre liste',

  'custom.message':
    'Décrivez-le et il va droit sur votre liste. La prochaine fois, nous le suggérerons à votre foyer.',
  'custom.productLabel': 'Produit',
  'custom.productPlaceholder': 'Huile d’olive 500 ml',
  'custom.makerLabel': 'Fabricant',
  'custom.makerPlaceholder': 'Bertolli',
  'custom.optional': 'facultatif',
  'custom.barcodeLabel': 'Code-barres',
  'custom.barcodePlaceholder': '8 à 14 chiffres',
  'custom.barcodeNote': 'Enregistré avec le produit, pour que le prochain scan le trouve.',
  'custom.barcodeInvalid': 'Un code-barres compte 8 à 14 chiffres. Videz le champ pour le passer.',
  'custom.submit': 'Ajouter à la liste',

  'scanner.pointCamera': 'Pointez la caméra vers un code-barres',
  'scanner.starting': 'Démarrage de la caméra',
  'scanner.tryAgain': 'Réessayer',
  'scanner.notInCatalog': 'Absent du catalogue',
  'scanner.lookingUp': 'Recherche en cours',
  'scanner.denied.title': 'FamCart n’a pas accès à la caméra',
  'scanner.denied.detail': 'Autorisez la caméra pour cette app, puis réessayez.',
  'scanner.unavailable.title': 'Cet appareil ne peut pas scanner',
  'scanner.unavailable.detail': 'Ajoutez l’article par son nom.',
  'scanner.error.title': 'La caméra n’a pas démarré',
  'scanner.error.detail': 'Une autre app l’utilise peut-être.',
  'scanner.timeout.title': 'La caméra n’a jamais répondu',
  'scanner.timeout.detail':
    'Si rien n’a demandé l’accès à la caméra, vérifiez l’autorisation caméra de FamCart dans les réglages de l’appareil.',

  'common.save': 'Enregistrer',
  'common.saved': 'Enregistré',
  'common.avatarAlt': 'Avatar de {name}',

  'topbar.history': 'Historique des achats',
  'topbar.account': 'Votre compte',
  'topbar.avatarAlt': 'Votre avatar',

  'account.title': 'Réglages du compte',
  'account.subtitle': 'Gérez votre profil et vos préférences',
  'account.close': 'Fermer la fenêtre du compte',
  'account.editProfile': 'Modifier votre profil : nom, photo, mot de passe',
  'account.noEmail': 'Aucun e-mail disponible',
  'account.manageHousehold': 'Gérer le foyer',
  'account.householdFallback': 'Foyer',
  'account.invitePeople': 'Inviter des personnes',
  'account.memberCount': { one: '{n} membre', other: '{n} membres' },
  'account.appSettings': 'Réglages de l’app',
  'account.appSettingsHint': 'Apparence, notifications, langue',
  'account.current': 'Actuel',
  'account.joinOrCreate': 'Rejoindre ou créer un foyer',
  'account.reportIssue': 'Signaler un problème',
  'account.reportHint': 'Bugs et retours',
  'account.signOut': 'Se déconnecter',
  'account.signingOut': 'Déconnexion',

  'household.settingsIcon': 'Réglages',
  'household.title': 'Réglages du foyer',
  'household.close': 'Fermer les réglages',
  'household.sections': 'Sections des réglages',
  'household.tab.overview': 'Aperçu',
  'household.tab.preferences': 'Préférences',
  'household.tab.members': 'Membres',
  'household.tab.danger': 'Zone sensible',

  'overview.summary': 'Résumé du foyer',
  'overview.name': 'Nom du foyer',
  'overview.createdBy': 'Créé par',
  'overview.owner': 'Propriétaire',
  'overview.totalMembers': 'Membres au total',
  'overview.activeCount': '{n} actifs',
  'overview.inviteTitle': 'Inviter de nouveaux membres',
  'overview.inviteDesc': 'Partagez ce code avec votre foyer pour qu’ils rejoignent votre liste.',
  'overview.inviteCode': 'CODE D’INVITATION',
  'overview.copyCode': 'Copier le code',
  'overview.copied': 'Copié !',

  'prefs.title': 'Préférences générales',
  'prefs.nameTitle': 'Nom du foyer',
  'prefs.nameDesc': 'Choisissez un nom que tout le foyer reconnaît d’un coup d’œil.',
  'prefs.namePlaceholder': 'Mon super foyer',
  'prefs.emojiTitle': 'Emoji du foyer',
  'prefs.emojiDesc': 'Choisissez un emoji pour votre foyer. Il apparaît dans la barre du haut.',
  'prefs.limitTitle': 'Limite d’articles par personne',
  'prefs.limitDesc':
    'Définissez combien d’articles actifs (non cochés) chaque membre peut ajouter.',
  'prefs.limitSlider': 'Curseur de la limite d’articles',

  'members.title': 'Membres du foyer ({n})',
  'members.desc': 'Voici les personnes qui ont accès à cette liste de courses.',
  'members.you': '(Vous)',
  'members.openActions': 'Ouvrir les actions du membre',
  'members.promote': 'Promouvoir modérateur',
  'members.promoteHint': 'Peut gérer les articles et les membres',
  'members.demote': 'Rétrograder en membre',
  'members.demoteHint': 'Retire les droits de modérateur',
  'members.remove': 'Retirer du foyer',
  'members.removeHint': 'Perd l’accès à la liste de courses',
  'members.roleModerator': 'Modérateur',
  'members.roleMember': 'Membre',
  'members.confirmRemoveTitle': 'Retirer ce membre ?',
  'members.confirmRemoveMessage':
    'Cette personne perdra aussitôt l’accès à la liste du foyer. Elle pourra revenir avec le code d’invitation.',

  'danger.inviteTitle': 'Gestion du code d’invitation',
  'danger.inviteDesc':
    'Invalide immédiatement le code actuel. Les membres existants ne sont pas affectés, mais les nouveaux devront utiliser le nouveau code.',
  'danger.regenerate': 'Régénérer',
  'danger.regenerated': 'Régénéré',
  'danger.leaveTitle': 'Quitter le foyer',
  'danger.leaveDesc': 'Vous serez retiré du foyer et n’aurez plus accès à la liste de courses.',
  'danger.deleteTitle': 'Supprimer le foyer',
  'danger.deleteDesc':
    'Supprime définitivement [{name}], retire tous les membres et efface toutes les données de la liste. Cette action est irréversible.',
  'danger.confirmRegenerateTitle': 'Régénérer le code d’invitation ?',
  'danger.confirmRegenerateMessage':
    'Le code actuel sera immédiatement invalidé. Les membres existants ne sont pas affectés, mais plus personne ne pourra rejoindre avec l’ancien code.',
  'danger.confirmLeaveTitle': 'Quitter le foyer ?',
  'danger.confirmLeaveMessage':
    'Vous perdrez l’accès à la liste de courses et il vous faudra un nouveau code pour revenir.',
  'danger.confirmDeleteTitle': 'Supprimer le foyer ?',
  'danger.confirmDeleteMessage':
    'Supprimer « {name} » retirera définitivement tous les membres, les articles et l’historique. Cette action est irréversible.',

  'history.buttonLabel': 'Historique des achats',
  'history.title': 'Historique des achats',
  'history.subtitle': 'Vos achats récents',
  'history.close': 'Fermer l’historique',
  'history.empty': 'Aucun achat pour l’instant. Les articles validés apparaîtront ici.',
  'history.you': 'Vous',
  'history.someone': 'Quelqu’un',
  'history.today': 'Aujourd’hui',
  'history.yesterday': 'Hier',

  'error.roleUpdateFailed': 'Impossible de modifier le rôle de ce membre.',
  'error.removeMemberFailed': 'Impossible de retirer ce membre.',
  'error.regenerateCodeFailed': 'Impossible de régénérer le code d’invitation. Veuillez réessayer.',
  'error.leaveHouseholdFailed': 'Impossible de quitter le foyer.',
  'error.deleteHouseholdFailed': 'Impossible de supprimer le foyer.',
  'error.renameHouseholdFailed': 'Impossible de renommer le foyer.',
  'error.saveEmojiFailed': 'Impossible d’enregistrer l’emoji du foyer.',
  'error.saveLimitFailed': 'Impossible d’enregistrer la limite d’articles.',
  'error.loadHistoryFailed':
    'Impossible de charger l’historique. Vérifiez votre connexion et réessayez.',

  'common.reload': 'Recharger',
  'common.copy': 'Copier',

  'crash.text':
    'FamCart a rencontré une erreur et a dû s’arrêter. Votre liste est en sécurité : elle vit sur le serveur, pas dans cette page.',

  'notify.title': 'Activer les notifications ?',
  'notify.message':
    'Sachez à l’instant où quelqu’un de votre foyer ajoute quelque chose à la liste ou coche des articles, pour ne rien oublier en magasin.',
  'notify.notNow': 'Pas maintenant',
  'notify.turnOn': 'Activer',

  'tour.skip': 'Passer la visite',
  'tour.next': 'Suivant',
  'tour.start': 'Commencer les courses',
  'tour.inviteCodeLabel': 'Code d’invitation',
  'tour.copyInviteCode': 'Copier le code d’invitation {code}',
  'tour.art.query': 'Avocats',
  'tour.art.avocado': 'Avocat',
  'tour.art.milk': 'Lait',
  'tour.art.bread': 'Pain',
  'tour.art.slide': 'Glissez pour valider',
  'tour.add.title': 'Ajoutez ce dont vous avez besoin',
  'tour.add.body':
    'Commencez à taper et les produits correspondants apparaissent. Touchez-en un et il va droit sur la liste.',
  'tour.swipe.title': 'Balayez pour cocher ou retirer',
  'tour.swipe.body':
    'Balayez une ligne vers la droite une fois l’article dans le panier, ou vers la gauche pour le retirer de la liste. Aucun petit bouton à viser.',
  'tour.checkout.title': 'Glissez pour valider',
  'tour.checkout.body':
    'Les lignes cochées attendent dans le panier jusqu’à ce que vous glissiez la barre du bas. C’est ce qui les efface et enregistre la sortie dans votre historique.',
  'tour.invite.title': 'Faites venir votre foyer',
  'tour.invite.body':
    'Partagez votre code d’invitation pour que tout le monde fasse ses courses sur la même liste. Chaque changement apparaît pour tous à l’instant même.',

  'common.done': 'Terminé',
  'common.close': 'Fermer',
  'common.tryAgain': 'Réessayer',

  'login.tagline': 'Les courses du foyer, [fraîches et partagées chaque jour]',
  'login.logoAlt': 'Logo FamCart',
  'login.emailLabel': 'Adresse e-mail',
  'login.emailPlaceholder': 'vous@email.com',
  'login.codeHint': 'Saisissez le code à 6 chiffres envoyé à',
  'login.codeGroupLabel': 'Code de vérification à 6 chiffres',
  'login.digitLabel': 'Chiffre {i} sur {n}',
  'login.or': 'ou',
  'login.alreadyTitle': 'Vous êtes déjà connecté',
  'login.alreadyMessage': 'Cet appareil a déjà une session FamCart active.',
  'login.goToList': 'Aller à ma liste',
  'login.errorTitle': 'Connexion impossible',

  'error.oauthFailed': 'Impossible de se connecter avec ce fournisseur.',
  'error.noEmailCode': 'Ce compte ne peut pas se connecter avec un code e-mail.',
  'error.generic': 'Une erreur est survenue.',
  'error.verificationIncomplete': 'Vérification incomplète. Veuillez réessayer.',
  'error.invalidCode': 'Code invalide.',

  'offline.title': 'Aucune connexion',
  'offline.text':
    'FamCart n’atteint pas Internet pour le moment. Vérifiez votre connexion : votre liste se chargera dès votre retour en ligne.',
  'offline.stillOffline':
    'Toujours pas de connexion. Vérifiez le Wi-Fi ou les données mobiles, puis réessayez.',

  'update.availableTitle': 'Mise à jour disponible',
  'update.permissionTitle': 'D’abord une autorisation',
  'update.readyToInstall': 'FamCart {version} est prête à être installée.',
  'update.currentVersion': 'Vous êtes en {version}.',
  'update.permissionMessage':
    'Android n’autorise une app à installer des mises à jour qu’avec votre accord. Activez [Autoriser depuis cette source] pour FamCart, puis revenez et appuyez sur Mettre à jour.',
  'update.downloadingMessage': 'Téléchargement de FamCart {version}…',
  'update.installingMessage':
    'Android prend le relais. Suivez l’invite d’installation pour terminer. Votre liste et votre foyer restent exactement tels quels.',
  'update.failedMessage':
    'La mise à jour n’a pas pu être téléchargée. C’est peut-être juste la connexion. Réessayez, ou récupérez l’APK depuis la page des versions.',
  'update.progressLabel': 'Progression du téléchargement',
  'update.later': 'Plus tard',
  'update.install': 'Mettre à jour',
  'update.notNow': 'Pas maintenant',
  'update.openSettings': 'Ouvrir les réglages',
  'update.downloading': 'Téléchargement…',
  'update.openReleases': 'Ouvrir les versions',

  'report.title': 'Signaler un problème',
  'report.subtitle': 'Va directement au développeur',
  'report.close': 'Fermer le signalement',
  'report.sentTitle': 'Signalement envoyé',
  'report.sentBody':
    'Rien d’autre à faire. Les signalements ne reçoivent pas de réponse, mais ils sont lus.',
  'report.kindGroupLabel': 'De quel type de signalement s’agit-il ?',
  'report.kindBug': 'Quelque chose est cassé',
  'report.kindIdea': 'Quelque chose pourrait être mieux',
  'report.whereLabel': 'Où dans l’app ?',
  'report.promptBug': 'Que s’est-il passé ?',
  'report.promptIdea': 'Qu’est-ce qui pourrait être mieux ?',
  'report.placeholderBug':
    'J’ai coché le lait et il est revenu sur la liste à la réouverture de l’app.',
  'report.placeholderIdea': 'Ce n’est pas évident de retirer quelqu’un du foyer.',
  'report.charsLeft': '{n} caractères restants',
  'report.attachedTitle': 'Envoyé avec votre signalement',
  'report.send': 'Envoyer',
  'report.sending': 'Envoi',
  'report.failureTitle': 'Signalement non envoyé',
  'report.surface.list': 'Liste de courses',
  'report.surface.add': 'Ajout d’articles',
  'report.surface.scan': 'Scanner de codes-barres',
  'report.surface.history': 'Validation et historique',
  'report.surface.household': 'Foyer et membres',
  'report.surface.notifications': 'Notifications',
  'report.surface.signin': 'Connexion',
  'report.surface.other': 'Ailleurs',
  'report.offlineFailure':
    'Rien n’a été envoyé car vous êtes hors ligne. Votre texte est toujours là : réessayez une fois de retour.',
  'report.sendFailure':
    'Rien n’a été envoyé. Le signalement ne nous est pas parvenu. Votre texte est toujours là, réessayez. Si l’échec persiste, une extension de confidentialité du navigateur le bloque peut-être.',
  'report.diag.version': 'FamCart {version}, {platform}',
  'report.diag.pendingEdits': 'Des modifications attendent d’être synchronisées',
  'report.diag.ids': 'Les identifiants de votre foyer et de votre compte',

  'common.gotIt': 'Compris',

  'error.limitReachedTitle': 'Limite atteinte',
  'error.limitReached':
    'Vous avez atteint votre limite de {n} articles actifs. Cochez ou supprimez des articles avant d’en ajouter d’autres.',
  'error.offlineSyncFailed':
    'Certaines modifications faites hors ligne n’ont pas pu être synchronisées.',
  'error.loadHouseholdFailed': 'Impossible de charger votre foyer.',

  'sso.title': 'Presque terminé',
  'sso.text': 'Retour vers l’app FamCart…',
  'sso.open': 'Ouvrir FamCart',

  'setup.hero.avocado': 'Avocat',
  'setup.hero.milk': 'Lait',
  'setup.hero.bread': 'Pain',

  'common.memberFallback': 'Membre',
  'account.fallbackName': 'Compte',
  'topbar.householdSettings': 'Paramètres de {name}',
  'members.sheetLabel': 'Actions pour {name}',
  'members.sheetLabelGeneric': 'Actions pour ce membre',
  'preferences.useEmoji': 'Utiliser {emoji} pour ce foyer',
  'history.addedBy': 'Ajouté par {name}',
  'history.addedThis': '{name} a ajouté cet article',

  'item.swipeLabelCheck':
    '{name}. Glissez vers la droite pour cocher, vers la gauche pour supprimer',
  'item.swipeLabelUncheck':
    '{name}. Glissez vers la droite pour décocher, vers la gauche pour supprimer',
  'item.swipeLabelCheckQty':
    '{name}, quantité {n}. Glissez vers la droite pour cocher, vers la gauche pour supprimer',
  'item.swipeLabelUncheckQty':
    '{name}, quantité {n}. Glissez vers la droite pour décocher, vers la gauche pour supprimer',

  'invite.shareTitle': 'Rejoignez {name} sur FamCart',
  'invite.shareTitleGeneric': 'Rejoignez mon foyer sur FamCart',
  'invite.shareBody':
    'Rejoignez « {name} » sur FamCart pour partager une liste de courses. Votre code d’invitation est {code}.',
  'invite.shareBodyGeneric':
    'Rejoignez mon foyer sur FamCart pour partager une liste de courses. Votre code d’invitation est {code}.',
  'invite.shareDialogTitle': 'Inviter sur FamCart',

  'error.loadListFailed': 'Impossible de charger votre liste. Veuillez réessayer.',
  'error.addItemFailed': 'Impossible d’ajouter cet article.',
  'error.addItemGeneric': 'L’ajout de l’article a échoué.',
  'error.addTooFast':
    'Vous ajoutez des articles trop vite. Attendez une minute et réessayez.',
  'error.updateItemFailed': 'Impossible de mettre à jour cet article.',
  'error.mergeItemsFailed': 'Impossible de fusionner ces articles.',
  'error.deleteItemFailed': 'Impossible de supprimer cet article.',
  'error.checkoutFailed': 'Impossible de finaliser les courses.',
  'error.itemNameTooLong': 'Le nom de l’article doit comporter au maximum {max} caractères.',
  'error.notificationsFromSettings':
    'Impossible d’activer les notifications. Vous pouvez réessayer depuis les paramètres du compte.',
}

export default fr
