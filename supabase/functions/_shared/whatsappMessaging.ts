// supabase/functions/_shared/whatsappMessaging.ts

export const MESSAGES = {
  // 1. IDENTITY CAPTURE FLOW
  FIRST_NAME_REQUEST: `🛡️ Initialisation du protocole de sécurité.\n\nBienvenue sur Clairtus. L'ultime couche de confiance pour vos affaires : zéro fraude, zéro stress.\n\n⚠️ Important : Pour utiliser nos services, votre numéro WhatsApp doit être le même que votre compte Mobile Money, et être enregistré à votre propre nom.\n\nPour commencer, quel est votre prénom ? (Répondez uniquement avec votre prénom)`,
  FIRST_NAME_INVALID: `❌ Format invalide.\n\nVeuillez envoyer uniquement votre prénom, sans caractères spéciaux.\nExemple : Patrick`,
  LAST_NAME_REQUEST: `👤 Prénom enregistré.\n\nQuel est votre nom de famille ? (Répondez uniquement avec votre nom)`,
  LAST_NAME_INVALID: `❌ Format invalide.\n\nVeuillez envoyer uniquement votre nom de famille.\nExemple : Mbuyi`,

  // 2. GUIDED TRANSACTION FLOW
  WELCOME_NEW: `👋 Bienvenue sur Clairtus, le réseau de confiance.\n\nL'argent est mis en sécurité lors de la commande et libéré uniquement à la livraison.\n\nQue souhaitez-vous faire ?`,
  WELCOME_RETURNING: (firstName: string, lastName: string) => 
    `👋 Bonjour ${firstName} ${lastName}.\n\nVotre profil est sécurisé. Prêt à faire des affaires sans risque ?\n\nQue souhaitez-vous faire ?`,
  
  SELL_ITEM_REQUEST: `📦 Mode VENTE activé.\n\nAstuce Clairtus : Ne déplacez jamais votre marchandise pour rien. L'argent de l'acheteur est sécurisé sur nos serveurs avant même votre expédition.\n\nQue vendez-vous ?\n(Décrivez l'article brièvement, ex: iPhone 13 Pro)`,
  BUY_ITEM_REQUEST: `🛒 Mode ACHAT activé.\n\nAstuce Clairtus : Ne payez plus jamais dans le vide. Le vendeur ne recevra votre argent qu'après votre validation à la livraison.\n\nQu'achetez-vous ?\n(Décrivez l'article brièvement, ex: Écran TV Samsung)`,
  
  CURRENCY_REQUEST: `💱 Devise de la transaction\n\nDans quelle devise se fera cette opération ? Sélectionnez la devise exacte de votre compte Mobile Money :`,

  PRICE_REQUEST_SELL: (itemDescription: string, currency: string) => 
    `🏷️ Article : ${itemDescription}\n\nÀ quel prix vendez-vous cet article ?\n(Envoyez uniquement le montant en ${currency})\n\n💡 Note : Clairtus déduit des frais de service de 2.5% à la fin de la transaction.`,
  PRICE_REQUEST_BUY: (itemDescription: string, currency: string) => 
    `🏷️ Article : ${itemDescription}\n\nQuel est le prix convenu avec le vendeur ?\n(Envoyez uniquement le montant en ${currency})\n\n💡 Note : Les frais Mobile Money opérateur s'appliqueront.`,
  
  AMOUNT_INVALID_FORMAT: `❌ Format du prix invalide.\n\nEnvoyez uniquement des chiffres.\nExemple : 150 ou 150.50`,
  
  COUNTERPARTY_PHONE_REQUEST_SELL: (amount: number, currency: string) => 
    `💰 Prix : ${amount} ${currency}\n\nQuel est le numéro WhatsApp ou Mobile Money de l'ACHETEUR ?\n(Format international obligatoire, ex: +243810000000)`,
  COUNTERPARTY_PHONE_REQUEST_BUY: (amount: number, currency: string) => 
    `💰 Prix : ${amount} ${currency}\n\nQuel est le numéro WhatsApp ou Mobile Money du VENDEUR ?\n(Format international obligatoire, ex: +243810000000)`,

  // 3. VALIDATION & INVITE MESSAGES
  PHONE_INVALID: `❌ Numéro invalide.\n\nLe numéro doit inclure l'indicatif du pays sans espaces.\nExemple : +243810000000`,
  SELF_TRANSACTION_BLOCKED: `🚫 Action non autorisée.\n\nVous ne pouvez pas effectuer une transaction avec votre propre numéro. Veuillez entrer le numéro de votre contrepartie.`,
  
  SELLER_WAITING_FOR_BUYER: `⏳ Vous avez une transaction en attente.\n\nNous attendons que l'acheteur clique sur ACCEPTER ou REFUSER.\n\n👉 Tapez ANNULER pour retirer votre offre.`,
  BUYER_WAITING_FOR_SELLER: `⏳ Vous avez une transaction en attente.\n\nNous attendons que le vendeur clique sur ACCEPTER ou REFUSER.\n\n👉 Tapez ANNULER pour annuler votre demande.`,

  BUYER_INVITE_BUTTONS: (sellerPhone: string, itemDescription: string) => 
    `🛡️ Clairtus | Nouveau contrat de sécurité\n\nLe vendeur (${sellerPhone}) vous propose une transaction protégée.\n\n📦 Article : ${itemDescription}\n\nVotre argent sera mis en sécurité par Clairtus et remis au vendeur UNIQUEMENT quand vous aurez reçu l'article.`,
  SELLER_INVITE_BUTTONS: (buyerPhone: string, itemDescription: string) => 
    `🛡️ Clairtus | Nouveau contrat de sécurité\n\nL'acheteur (${buyerPhone}) vous propose une transaction protégée.\n\n📦 Article : ${itemDescription}\n\nAcceptez-vous cette transaction ?`,

  // 4. PRE-PAYMENT & ACCEPTANCE MESSAGES
  CONTRACT_ACCEPTED_SELLER_NOTIFIED: `☑️ Contrat accepté.\n\nEn attente du paiement Mobile Money de l'acheteur. N'expédiez pas encore la marchandise.`,
  CONTRACT_ACCEPTED_BUYER_NOTIFIED: `☑️ Contrat accepté.\n\nLe vendeur a validé la transaction. Nous générons votre lien de paiement...`,
  PRE_PAYMENT_BUYER: `💳 Paiement en attente\n\nLe contrat est prêt. Mettez les fonds en sécurité maintenant pour autoriser le vendeur à expédier.`,
  
  // 🚀 UNIFIED, FOOLPROOF USSD FALLBACK
  DEPOSIT_INITIATED: `⏳ Demande de paiement envoyée à votre opérateur.\n\n📲 Un écran de validation (prompt) va s'afficher sur votre téléphone d'ici quelques secondes pour saisir votre code PIN.\n\n🛡️ *PLAN B (Si l'écran n'apparaît pas) :*\nLes réseaux télécoms ont parfois des retards. Ne paniquez pas.\nAttendez 1 minute, puis tapez simplement *RÉESSAYER* ici pour qu'on vous renvoie la demande à l'écran.`,
  
  DEPOSIT_ERROR: `❌ Échec de connexion à l'opérateur.\n\nL'opérateur télécom ne répond pas. Veuillez réessayer dans 5 minutes.`,

  // 5. POST-PAYMENT & DELIVERY MESSAGES
  PAYMENT_SUCCESS_BUYER: (amount: number, currency: string, pin: string) => 
    `🔒 FONDS SÉCURISÉS AVEC SUCCÈS\n\nVotre argent (${amount} ${currency}) est placé en toute sécurité.\n\n🔑 VOTRE CODE PIN SECRET : *${pin}*\n\n⚠️ RÈGLE D'OR :\n1. Inspectez la marchandise à la livraison.\n2. Si conforme, donnez ce code au livreur.\n3. Ne partagez JAMAIS ce code avant d'avoir l'article en main.`,
  
  PAYMENT_SUCCESS_SELLER: (amount: number, currency: string) => 
    `🔒 L'ACHETEUR A PAYÉ\n\nLes fonds (${amount} ${currency}) sont fermement sécurisés sur nos serveurs. Vous ne risquez plus rien.\n\n👉 VOS INSTRUCTIONS :\n1. Expédiez la commande immédiatement.\n2. À la livraison, demandez à l'acheteur son code PIN secret à 4 chiffres.\n3. Tapez ce code ici dans cette conversation.`,
  
  PAYMENT_FAILED_BUYER: `❌ Échec du paiement.\n\nLe paiement Mobile Money a échoué (solde insuffisant ou délai dépassé). Vérifiez votre solde et cliquez sur RÉESSAYER.`,

  PIN_INVALID: `❌ Code PIN incorrect.\n\nCe n'est pas le bon code. Demandez à l'acheteur de vérifier le code qu'il a reçu. (Attention : 3 échecs bloqueront la transaction).`,
  
  PAYOUT_INITIATED: `✅ CODE PIN VALIDE.\n\nLe contrat est rempli. Décaissement automatique de vos fonds vers votre compte Mobile Money en cours...`,

  PAYMENT_SUCCESS_BUYER_FINAL: `✅ Transaction clôturée.\n\nLe code PIN a été utilisé avec succès. Le vendeur a reçu son argent.`,

  // 6. FALLBACK MESSAGES
  UNKNOWN_MESSAGE: `❓ Commande non reconnue.\n\nClairtus est un terminal automatisé. Veuillez utiliser les boutons fournis. Tapez BONJOUR pour ouvrir le menu principal.`
};