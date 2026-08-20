// Spanish. See en.ts for what a catalog is and how keys are named.
//
// Spanish has a `many` plural category, but Intl only selects it at exact
// millions, which a shopping list will never reach. The entries here carry
// one/other and let tn()'s `other` fallback cover it.
import type { Catalog } from '../lib/i18n'

const es: Catalog = {
  'common.back': 'Atrás',
  'common.ok': 'OK',
  'common.cancel': 'Cancelar',
  'common.closeModal': 'Cerrar el diálogo',
  'common.confirm': 'Confirmar',
  'common.continue': 'Continuar',

  'language.groupLabel': 'Elige un idioma',

  'setup.language.eyebrow': 'Bienvenido 🌍',
  'setup.language.title': 'Elige tu [idioma]',
  'setup.language.sub': 'Puedes cambiarlo cuando quieras en los Ajustes de la app.',

  'setup.welcome.eyebrow': 'Te damos la bienvenida a FamCart 🛒',
  'setup.welcome.title': 'La lista que comparte todo el [hogar]',
  'setup.welcome.sub':
    'Todos añaden, todos marcan, y todo se actualiza para el hogar entero en el momento en que ocurre, así no se olvida nada en la tienda.',
  'setup.welcome.cta': 'Empezar',

  'setup.picker.eyebrowAdd': 'Añadir un hogar',
  'setup.picker.eyebrowNew': 'Bienvenido a bordo 👋',
  'setup.picker.titleAdd': 'Añade otro [hogar]',
  'setup.picker.titleNew': 'Configura tu [hogar]',
  'setup.picker.subAdd': 'Únete a otro hogar con su código de invitación.',
  'setup.picker.subAddOrCreate':
    'Únete a otro hogar con su código de invitación, o crea uno nuevo.',
  'setup.picker.subNew':
    'Crea una lista de la compra compartida para tu hogar, o únete a una con un código de invitación.',
  'setup.picker.createLabel': 'Crear un hogar',
  'setup.picker.createDescription': 'Empieza una lista nueva y obtén un código de invitación',
  'setup.picker.joinLabel': 'Unirse a un hogar',
  'setup.picker.joinDescription': 'Pega el código de invitación que te ha compartido tu hogar',

  'setup.create.eyebrow': 'Hogar nuevo',
  'setup.create.title': '¿Cómo se llama tu hogar?',
  'setup.create.sub': 'Así aparecerá la lista de tu hogar para todos.',
  'setup.create.nameLabel': 'Nombre del hogar',
  'setup.create.namePlaceholder': 'p. ej. Los García',

  'setup.join.eyebrow': 'Unirse a un hogar',
  'setup.join.title': 'Introduce tu código de invitación',
  'setup.join.sub': 'Pide el código de invitación a un miembro del hogar.',
  'setup.join.codeLabel': 'Código de invitación',
  'setup.join.codePlaceholder': 'p. ej. AB3K7XYZ',

  'settings.title': 'Ajustes de la app',
  'settings.subtitle': 'Cómo se ve y se comporta FamCart en este dispositivo',
  'settings.close': 'Cerrar los ajustes de la app',
  'settings.appearance': 'Apariencia',
  'settings.theme.light': 'Claro',
  'settings.theme.dark': 'Oscuro',
  'settings.theme.system': 'Sistema',
  'settings.notifications': 'Notificaciones',
  'settings.notifications.on': 'Activadas',
  'settings.notifications.off': 'Desactivadas',
  'settings.language': 'Idioma',
  'settings.about': 'Acerca de',
  'settings.aboutHint': 'FamCart v{version}',

  'about.versionLine': 'v{version}',
  'about.close': 'Cerrar Acerca de',
  'about.checkUpdates': 'Buscar actualizaciones',
  'about.checking': 'Buscando…',
  'about.upToDate': 'FamCart está actualizado.',
  'about.checkFailed':
    'No se ha podido contactar con GitHub. Inténtalo de nuevo cuando vuelvas a estar en línea.',
  'about.creditLead': 'Datos de productos de',
  'about.creditAnd': 'y',
  'about.creditJoin': ', bajo',
  'about.creditEnd': '.',

  'error.genericTitle': 'Algo ha salido mal',
  'error.offline': 'Parece que estás sin conexión. Comprueba tu conexión e inténtalo de nuevo.',
  'error.nameTooLongTitle': 'Nombre demasiado largo',
  'error.householdNameTooLong': 'El nombre del hogar debe tener {max} caracteres o menos.',
  'error.ownOneHousehold':
    'Solo puedes ser propietario de un hogar. Abandona o elimina el actual antes de crear otro.',
  'error.membershipCapCreate':
    'Puedes formar parte de un máximo de {cap} hogares. Abandona uno antes de crear otro.',
  'error.membershipCapJoin':
    'Puedes formar parte de un máximo de {cap} hogares. Abandona uno antes de unirte a otro.',
  'error.createHouseholdFailed': 'No se ha podido crear el hogar.',
  'error.joinHouseholdFailed': 'No se ha podido unir al hogar.',
  'error.inviteCodeInvalid':
    'El código de invitación debe tener 8 caracteres, solo letras y números.',
  'error.noHouseholdForCode': 'No se ha encontrado ningún hogar con ese código de invitación.',
  'error.notificationsBlocked':
    'Las notificaciones están bloqueadas para FamCart en los ajustes de tu dispositivo o navegador.',
  'error.notificationsFailed':
    'No se han podido activar las notificaciones. Inténtalo de nuevo.',

  'list.meta.toBuy': 'Por comprar',
  'list.meta.checked': 'Marcados',
  'list.meta.itemCount': { one: '{n} artículo', other: '{n} artículos' },
  'list.meta.leftCount': { one: '{n} pendiente', other: '{n} pendientes' },
  'list.filteredEmpty.checked': 'Aún no has marcado nada.',
  'list.filteredEmpty.active': 'Aquí está todo marcado.',
  'list.empty.titleShopped': 'Todo comprado',
  'list.empty.titleNew': 'Aquí no hay nada aún',
  'list.empty.textShopped': 'No queda nada por recoger.',
  'list.empty.textNew': 'Añade lo primero y todo el hogar lo verá al instante.',
  'list.buyAgain': 'Comprar otra vez',
  'list.addProduct': 'Añadir {name}',
  'list.buyBar.checkedOut': '¡Compra hecha!',
  'list.buyBar.slide': {
    one: 'Desliza para finalizar {n} artículo',
    other: 'Desliza para finalizar {n} artículos',
  },
  'list.buyBar.checkOut': { one: 'Finalizar {n} artículo', other: 'Finalizar {n} artículos' },

  'item.gotIt': 'Ya está',
  'item.uncheck': 'Desmarcar',
  'item.remove': 'Quitar',
  'item.oneFewer': 'Uno menos',
  'item.oneMore': 'Uno más',
  'item.quantity': 'Cantidad {n}',
  'item.quantityDone': 'Cantidad {n}. Listo',
  'item.quantityChange': 'Cantidad {n}. Cambiar',

  'filter.buttonLabel': 'Filtrar artículos',
  'filter.buttonLabelFiltered': 'Filtrar artículos (filtrado)',
  'filter.heading': 'Filtros',
  'filter.hint': 'Lo que muestra esta lista',
  'filter.all.label': 'Sin filtro',
  'filter.all.hint': 'Todo lo de la lista',
  'filter.active.label': 'Por comprar',
  'filter.active.hint': 'Aún por recoger',
  'filter.checked.label': 'Marcados',
  'filter.checked.hint': 'En el carrito, listos para finalizar',

  'add.inputLabel': 'Añadir un artículo',
  'add.inputPlaceholder': 'Añadir un artículo…',
  'add.scanLabel': 'Escanear un código de barras',
  'add.submitLabel': 'Añadir',
  'add.listRecents': 'Productos que compras a menudo',
  'add.listSuggestions': 'Sugerencias de productos',
  'add.onYourList': 'en tu lista',
  'add.cantFind': '¿No lo encuentras?',
  'add.addYourOwn': 'Añádelo tú',
  'add.typeToSearch': 'Escribe el nombre de un producto para buscar.',
  'add.announced': '{name} añadido a tu lista',

  'custom.message':
    'Descríbelo y va directo a tu lista. La próxima vez se lo sugeriremos a tu hogar.',
  'custom.productLabel': 'Producto',
  'custom.productPlaceholder': 'Aceite de oliva 500 ml',
  'custom.makerLabel': 'Fabricante',
  'custom.makerPlaceholder': 'Bertolli',
  'custom.optional': 'opcional',
  'custom.barcodeLabel': 'Código de barras',
  'custom.barcodePlaceholder': 'de 8 a 14 dígitos',
  'custom.barcodeNote': 'Se guarda con el producto, para que el próximo escaneo lo encuentre.',
  'custom.barcodeInvalid':
    'Un código de barras tiene de 8 a 14 dígitos. Vacía el campo para omitirlo.',
  'custom.submit': 'Añadir a la lista',

  'scanner.pointCamera': 'Apunta la cámara a un código de barras',
  'scanner.starting': 'Iniciando la cámara',
  'scanner.tryAgain': 'Inténtalo de nuevo',
  'scanner.notInCatalog': 'No está en el catálogo',
  'scanner.lookingUp': 'Buscándolo',
  'scanner.denied.title': 'FamCart no tiene acceso a la cámara',
  'scanner.denied.detail': 'Permite la cámara para esta app y vuelve a intentarlo.',
  'scanner.unavailable.title': 'Este dispositivo no puede escanear',
  'scanner.unavailable.detail': 'Añade el artículo por su nombre.',
  'scanner.error.title': 'La cámara no se ha iniciado',
  'scanner.error.detail': 'Puede que otra app la esté usando.',
  'scanner.timeout.title': 'La cámara no ha respondido',
  'scanner.timeout.detail':
    'Si nada ha pedido acceso a la cámara, revisa el permiso de cámara de FamCart en los ajustes del dispositivo.',

  'common.save': 'Guardar',
  'common.saved': 'Guardado',
  'common.avatarAlt': 'Avatar de {name}',

  'topbar.history': 'Historial de compras',
  'topbar.account': 'Tu cuenta',
  'topbar.avatarAlt': 'Tu avatar',

  'account.title': 'Ajustes de la cuenta',
  'account.subtitle': 'Gestiona tu perfil y tus preferencias',
  'account.close': 'Cerrar la ventana de la cuenta',
  'account.editProfile': 'Edita tu perfil: nombre, foto, contraseña',
  'account.noEmail': 'No hay correo disponible',
  'account.manageHousehold': 'Gestionar el hogar',
  'account.householdFallback': 'Hogar',
  'account.invitePeople': 'Invitar personas',
  'account.memberCount': { one: '{n} miembro', other: '{n} miembros' },
  'account.appSettings': 'Ajustes de la app',
  'account.appSettingsHint': 'Apariencia, notificaciones, idioma',
  'account.current': 'Actual',
  'account.joinOrCreate': 'Unirse o crear un hogar',
  'account.reportIssue': 'Informar de un problema',
  'account.reportHint': 'Errores y sugerencias',
  'account.signOut': 'Cerrar sesión',
  'account.signingOut': 'Cerrando sesión',

  'household.settingsIcon': 'Ajustes',
  'household.title': 'Ajustes del hogar',
  'household.close': 'Cerrar los ajustes',
  'household.sections': 'Secciones de ajustes',
  'household.tab.overview': 'Resumen',
  'household.tab.preferences': 'Preferencias',
  'household.tab.members': 'Miembros',
  'household.tab.danger': 'Zona de peligro',

  'overview.summary': 'Resumen del hogar',
  'overview.name': 'Nombre del hogar',
  'overview.createdBy': 'Creado por',
  'overview.owner': 'Propietario',
  'overview.totalMembers': 'Miembros en total',
  'overview.activeCount': '{n} activos',
  'overview.inviteTitle': 'Invitar a nuevos miembros',
  'overview.inviteDesc': 'Comparte este código con tu hogar para que puedan unirse a tu lista.',
  'overview.inviteCode': 'CÓDIGO DE INVITACIÓN',
  'overview.copyCode': 'Copiar el código',
  'overview.copied': '¡Copiado!',

  'prefs.title': 'Preferencias generales',
  'prefs.nameTitle': 'Nombre del hogar',
  'prefs.nameDesc': 'Elige un nombre que todo el hogar reconozca al momento.',
  'prefs.namePlaceholder': 'Mi hogar genial',
  'prefs.emojiTitle': 'Emoji del hogar',
  'prefs.emojiDesc': 'Elige un emoji para tu hogar. Aparece en la barra superior.',
  'prefs.limitTitle': 'Límite de artículos por persona',
  'prefs.limitDesc': 'Controla cuántos artículos activos (sin marcar) puede añadir cada miembro.',
  'prefs.limitSlider': 'Control deslizante del límite de artículos',

  'members.title': 'Miembros del hogar ({n})',
  'members.desc': 'Abajo están las personas con acceso a esta lista de la compra.',
  'members.you': '(Tú)',
  'members.openActions': 'Abrir acciones del miembro',
  'members.promote': 'Ascender a moderador',
  'members.promoteHint': 'Puede gestionar artículos y miembros',
  'members.demote': 'Degradar a miembro',
  'members.demoteHint': 'Quita los permisos de moderador',
  'members.remove': 'Quitar del hogar',
  'members.removeHint': 'Pierde el acceso a la lista de la compra',
  'members.roleModerator': 'Moderador',
  'members.roleMember': 'Miembro',
  'members.confirmRemoveTitle': '¿Quitar al miembro?',
  'members.confirmRemoveMessage':
    'Esta persona perderá el acceso a la lista del hogar de inmediato. Puede volver a unirse con el código de invitación.',

  'danger.inviteTitle': 'Administración del código de invitación',
  'danger.inviteDesc':
    'Invalida al instante el código actual. Los miembros actuales no se ven afectados, pero los nuevos deberán usar el código nuevo.',
  'danger.regenerate': 'Regenerar',
  'danger.regenerated': 'Regenerado',
  'danger.leaveTitle': 'Salir del hogar',
  'danger.leaveDesc': 'Esto te quitará del hogar. Ya no tendrás acceso a la lista de la compra.',
  'danger.deleteTitle': 'Eliminar el hogar',
  'danger.deleteDesc':
    'Elimina [{name}] de forma permanente, quita a todos los miembros y borra todos los datos de la lista. No se puede deshacer.',
  'danger.confirmRegenerateTitle': '¿Regenerar el código de invitación?',
  'danger.confirmRegenerateMessage':
    'El código actual quedará invalidado de inmediato. Los miembros actuales no se ven afectados, pero nadie podrá unirse con el código antiguo.',
  'danger.confirmLeaveTitle': '¿Salir del hogar?',
  'danger.confirmLeaveMessage':
    'Perderás el acceso a la lista de la compra y necesitarás un código nuevo para volver.',
  'danger.confirmDeleteTitle': '¿Eliminar el hogar?',
  'danger.confirmDeleteMessage':
    'Eliminar «{name}» quitará de forma permanente a todos los miembros, los artículos y el historial. No se puede deshacer.',

  'history.buttonLabel': 'Historial de compras',
  'history.title': 'Historial de compras',
  'history.subtitle': 'Tus compras recientes',
  'history.close': 'Cerrar el historial',
  'history.empty': 'Aún no hay compras. Los artículos que finalices aparecerán aquí.',
  'history.you': 'Tú',
  'history.someone': 'Alguien',
  'history.today': 'Hoy',
  'history.yesterday': 'Ayer',

  'error.roleUpdateFailed': 'No se ha podido cambiar el rol de ese miembro.',
  'error.removeMemberFailed': 'No se ha podido quitar a ese miembro.',
  'error.regenerateCodeFailed':
    'No se ha podido regenerar el código de invitación. Inténtalo de nuevo.',
  'error.leaveHouseholdFailed': 'No se ha podido salir del hogar.',
  'error.deleteHouseholdFailed': 'No se ha podido eliminar el hogar.',
  'error.renameHouseholdFailed': 'No se ha podido renombrar el hogar.',
  'error.saveEmojiFailed': 'No se ha podido guardar el emoji del hogar.',
  'error.saveLimitFailed': 'No se ha podido guardar el límite de artículos.',
  'error.loadHistoryFailed':
    'No se ha podido cargar el historial. Comprueba tu conexión e inténtalo de nuevo.',

  'common.reload': 'Recargar',
  'common.copy': 'Copiar',

  'crash.text':
    'FamCart ha encontrado un error y ha tenido que detenerse. Tu lista está a salvo: vive en el servidor, no en esta página.',

  'notify.title': '¿Activar las notificaciones?',
  'notify.message':
    'Entérate en el momento en que alguien de tu hogar añade algo a la lista o marca artículos, así no se olvida nada en la tienda.',
  'notify.notNow': 'Ahora no',
  'notify.turnOn': 'Activar',

  'tour.skip': 'Saltar el tutorial',
  'tour.next': 'Siguiente',
  'tour.start': 'Empezar a comprar',
  'tour.inviteCodeLabel': 'Código de invitación',
  'tour.copyInviteCode': 'Copiar el código de invitación {code}',
  'tour.art.query': 'Aguacates',
  'tour.art.avocado': 'Aguacate',
  'tour.art.milk': 'Leche',
  'tour.art.bread': 'Pan',
  'tour.art.slide': 'Desliza para finalizar',
  'tour.add.title': 'Añade lo que necesitas',
  'tour.add.body':
    'Empieza a escribir y aparecerán los productos que coinciden. Toca uno y va directo a la lista.',
  'tour.swipe.title': 'Desliza para marcar o quitar',
  'tour.swipe.body':
    'Desliza una fila a la derecha cuando ya esté en el carrito, o a la izquierda para quitarla de la lista. Sin botoncitos que acertar.',
  'tour.checkout.title': 'Desliza para finalizar',
  'tour.checkout.body':
    'Las filas marcadas esperan en el carrito hasta que deslizas la barra de abajo. Eso es lo que las vacía y guarda la compra en tu historial.',
  'tour.invite.title': 'Trae a tu hogar',
  'tour.invite.body':
    'Comparte tu código de invitación para que todos compren de la misma lista. Cada cambio aparece para todos en el momento en que ocurre.',

  'common.done': 'Hecho',
  'common.close': 'Cerrar',
  'common.tryAgain': 'Inténtalo de nuevo',

  'login.tagline': 'La compra del hogar, [fresca y en común cada día]',
  'login.logoAlt': 'Logotipo de FamCart',
  'login.emailLabel': 'Dirección de correo',
  'login.emailPlaceholder': 'tu@email.com',
  'login.codeHint': 'Introduce el código de 6 dígitos enviado a',
  'login.codeGroupLabel': 'Código de verificación de 6 dígitos',
  'login.digitLabel': 'Dígito {i} de {n}',
  'login.or': 'o',
  'login.alreadyTitle': 'Ya has iniciado sesión',
  'login.alreadyMessage': 'Este dispositivo ya tiene una sesión de FamCart activa.',
  'login.goToList': 'Ir a mi lista',
  'login.errorTitle': 'No se ha podido iniciar sesión',

  'error.oauthFailed': 'No se ha podido iniciar sesión con ese proveedor.',
  'error.noEmailCode': 'Esta cuenta no puede iniciar sesión con un código por correo.',
  'error.generic': 'Algo ha salido mal.',
  'error.verificationIncomplete': 'Verificación incompleta. Inténtalo de nuevo.',
  'error.invalidCode': 'Código no válido.',

  'offline.title': 'Sin conexión',
  'offline.text':
    'FamCart no puede conectarse a internet ahora mismo. Comprueba tu conexión y tu lista se cargará en cuanto vuelvas a estar en línea.',
  'offline.stillOffline':
    'Sigue sin conexión. Comprueba el Wi-Fi o los datos móviles y vuelve a intentarlo.',

  'update.availableTitle': 'Actualización disponible',
  'update.permissionTitle': 'Primero un permiso',
  'update.readyToInstall': 'FamCart {version} está lista para instalarse.',
  'update.currentVersion': 'Tienes la {version}.',
  'update.permissionMessage':
    'Android solo deja que una app instale actualizaciones cuando lo permites. Activa [Permitir de esta fuente] para FamCart, vuelve y pulsa Actualizar.',
  'update.downloadingMessage': 'Descargando FamCart {version}…',
  'update.installingMessage':
    'A partir de aquí se encarga Android. Sigue las indicaciones de instalación para terminar. Tu lista y tu hogar se quedan tal cual.',
  'update.failedMessage':
    'No se ha podido descargar la actualización. Puede ser solo la conexión. Inténtalo de nuevo u obtén el APK desde la página de versiones.',
  'update.progressLabel': 'Progreso de la descarga',
  'update.later': 'Más tarde',
  'update.install': 'Actualizar',
  'update.notNow': 'Ahora no',
  'update.openSettings': 'Abrir los ajustes',
  'update.downloading': 'Descargando…',
  'update.openReleases': 'Abrir las versiones',

  'report.title': 'Informar de un problema',
  'report.subtitle': 'Va directo al desarrollador',
  'report.close': 'Cerrar el informe',
  'report.sentTitle': 'Informe enviado',
  'report.sentBody':
    'No hay nada más que hacer. Los informes no reciben respuesta, pero sí se leen.',
  'report.kindGroupLabel': '¿Qué tipo de informe es este?',
  'report.kindBug': 'Algo está roto',
  'report.kindIdea': 'Algo podría estar mejor',
  'report.whereLabel': '¿Dónde en la app?',
  'report.promptBug': '¿Qué ha pasado?',
  'report.promptIdea': '¿Qué podría estar mejor?',
  'report.placeholderBug': 'Marqué la leche y volvió a aparecer en la lista al reabrir la app.',
  'report.placeholderIdea': 'No queda claro cómo quitar a alguien del hogar.',
  'report.charsLeft': 'Quedan {n} caracteres',
  'report.attachedTitle': 'Se envía con tu informe',
  'report.send': 'Enviar',
  'report.sending': 'Enviando',
  'report.failureTitle': 'Informe no enviado',
  'report.surface.list': 'Lista de la compra',
  'report.surface.add': 'Añadir artículos',
  'report.surface.scan': 'Escáner de códigos',
  'report.surface.history': 'Compra e historial',
  'report.surface.household': 'Hogar y miembros',
  'report.surface.notifications': 'Notificaciones',
  'report.surface.signin': 'Iniciar sesión',
  'report.surface.other': 'En otro sitio',
  'report.offlineFailure':
    'No se ha enviado nada porque estás sin conexión. Tu texto sigue aquí, así que inténtalo de nuevo cuando vuelvas.',
  'report.sendFailure':
    'No se ha enviado nada. El informe no ha llegado. Tu texto sigue aquí, así que inténtalo de nuevo. Si sigue fallando, puede que lo bloquee una extensión de privacidad del navegador.',
  'report.diag.version': 'FamCart {version}, {platform}',
  'report.diag.pendingEdits': 'Tiene cambios pendientes de sincronizar',
  'report.diag.ids': 'Los ID de tu hogar y de tu cuenta',

  'common.gotIt': 'Entendido',

  'error.limitReachedTitle': 'Límite alcanzado',
  'error.limitReached':
    'Has alcanzado tu límite de {n} artículos activos. Marca o elimina artículos antes de añadir más.',
  'error.offlineSyncFailed': 'Algunos cambios hechos sin conexión no se han podido sincronizar.',
  'error.loadHouseholdFailed': 'No se ha podido cargar tu hogar.',

  'sso.title': 'Ya casi está',
  'sso.text': 'Volviendo a la app de FamCart…',
  'sso.open': 'Abrir FamCart',

  'setup.hero.avocado': 'Aguacate',
  'setup.hero.milk': 'Leche',
  'setup.hero.bread': 'Pan',

  'common.memberFallback': 'Miembro',
  'account.fallbackName': 'Cuenta',
  'topbar.householdSettings': 'Ajustes de {name}',
  'members.sheetLabel': 'Acciones para {name}',
  'members.sheetLabelGeneric': 'Acciones para este miembro',
  'preferences.useEmoji': 'Usar {emoji} para este hogar',
  'history.addedBy': 'Añadido por {name}',
  'history.addedThis': '{name} añadió esto',

  'item.swipeLabelCheck': '{name}. Desliza a la derecha para marcar, a la izquierda para eliminar',
  'item.swipeLabelUncheck':
    '{name}. Desliza a la derecha para desmarcar, a la izquierda para eliminar',
  'item.swipeLabelCheckQty':
    '{name}, cantidad {n}. Desliza a la derecha para marcar, a la izquierda para eliminar',
  'item.swipeLabelUncheckQty':
    '{name}, cantidad {n}. Desliza a la derecha para desmarcar, a la izquierda para eliminar',

  'invite.shareTitle': 'Únete a {name} en FamCart',
  'invite.shareTitleGeneric': 'Únete a mi hogar en FamCart',
  'invite.shareBody':
    'Únete a «{name}» en FamCart para compartir una lista de la compra. Tu código de invitación es {code}.',
  'invite.shareBodyGeneric':
    'Únete a mi hogar en FamCart para compartir una lista de la compra. Tu código de invitación es {code}.',
  'invite.shareDialogTitle': 'Invitar a FamCart',

  'error.loadListFailed': 'No se ha podido cargar tu lista. Inténtalo de nuevo.',
  'error.addItemFailed': 'No se ha podido añadir ese producto.',
  'error.addItemGeneric': 'Error al añadir el producto.',
  'error.addTooFast':
    'Estás añadiendo productos demasiado rápido. Espera un minuto e inténtalo de nuevo.',
  'error.updateItemFailed': 'No se ha podido actualizar ese producto.',
  'error.mergeItemsFailed': 'No se han podido combinar esos productos.',
  'error.deleteItemFailed': 'No se ha podido eliminar ese producto.',
  'error.checkoutFailed': 'No se ha podido completar la compra.',
  'error.itemNameTooLong': 'El nombre del producto debe tener {max} caracteres o menos.',
  'error.notificationsFromSettings':
    'No se han podido activar las notificaciones. Puedes volver a intentarlo desde los Ajustes de la cuenta.',
}

export default es
