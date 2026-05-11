// supabase/functions/_shared/whatsappMessaging.ts

export const MESSAGES = {
  FIRST_NAME_REQUEST: `🛡️ Initialisation du protocole de sécurité.\n\nBienvenue sur Clairtus. L'ultime couche de confiance pour vos affaires: zéro fraude, zéro stress.\n\n*Important:* Pour utiliser nos services, votre numéro WhatsApp doit être le même que votre compte Mobile Money, et être enregistré à votre propre nom.\n\nPour commencer, quel est votre prénom? (Répondez uniquement avec votre prénom)`,
  FIRST_NAME_INVALID: `❌ Format invalide.\n\nVeuillez envoyer uniquement votre prénom.\nExemple: Patrick`,
  LAST_NAME_REQUEST: `👤 Prénom enregistré.\n\nQuel est votre nom de famille? (Répondez uniquement avec votre nom)`,
  LAST_NAME_INVALID: `❌ Format invalide.\n\nVeuillez envoyer uniquement votre nom de famille.\nExemple: Mbuyi`,

  WELCOME_NEW: `👋 Bienvenue sur Clairtus, le réseau de confiance.\n\nL'argent est mis en sécurité lors de la commande et libéré uniquement à la livraison.\n\nQue souhaitez-vous faire ?`,
  WELCOME_RETURNING: (firstName: string, lastName: string) => `👋 Bonjour ${firstName} ${lastName}.\n\nVotre profil est sécurisé. Prêt à faire des affaires sans risque ?\n\nQue souhaitez-vous faire ?`,

  SELL_ITEM_REQUEST: `📦 Mode VENTE activé.\n\nAstuce Clairtus: Ne déplacez jamais votre marchandise pour rien. L'argent de l'acheteur est sécurisé sur nos serveurs avant même votre expédition.\n\nQue vendez-vous ?\n(Décrivez l'article brièvement, ex: iPhone 13 Pro)`,
  BUY_ITEM_REQUEST: `🛒 Mode ACHAT activé.\n\nAstuce Clairtus: Ne payez plus jamais dans le vide. Le vendeur ne recevra votre argent qu'après votre validation à la livraison.\n\nQu'achetez-vous?\n(Décrivez l'article brièvement, ex: Écran TV Samsung)`,

  PRICE_REQUEST_SELL: (itemDescription: string) => `🏷️ Article: ${itemDescription}\n\nÀ quel prix vendez-vous cet article?\n(Envoyez uniquement le montant en $)\n\nNote: Clairtus déduit des frais de service de 2,5% à la fin de la transaction.`,
  PRICE_REQUEST_BUY: (itemDescription: string) => `🏷️ Article: ${itemDescription}\n\nQuel est le prix convenu avec le vendeur ?\n(Envoyez uniquement le montant en $)`,
  AMOUNT_INVALID_FORMAT: `❌ Format du prix invalide.\n\nEnvoyez uniquement des chiffres.\nExemple: 150 ou 150.50`,

  COUNTERPARTY_PHONE_REQUEST_SELL: (amount: number) => `💰 Prix: ${amount} $\n\nQuel est le numéro WhatsApp ou Mobile Money de l'ACHETEUR?\n(Format international obligatoire, ex: +243810000000)`,
  COUNTERPARTY_PHONE_REQUEST_BUY: (amount: number) => `💰 Prix: ${amount} $\n\nQuel est le numéro WhatsApp ou Mobile Money du VENDEUR ?\n(Format international obligatoire, ex: +243810000000)`,

  PHONE_INVALID: `❌ Numéro invalide.\n\nLe numéro doit inclure l'indicatif du pays sans espaces ni symbole +.\nExemple: 243810000000`,
  SELF_TRANSACTION_BLOCKED: `🚫 Action non autorisée.\n\nVous ne pouvez pas effectuer une transaction de séquestre avec votre propre numéro.`,
  
  SELLER_WAITING_FOR_BUYER: `⏳ Vous avez une transaction en attente.\n\nNous attendons que l'acheteur clique sur ACCEPTER ou REFUSER.\nTapez ANNULER pour retirer votre offre.`,
  BUYER_WAITING_FOR_SELLER: `⏳ Vous avez une transaction en attente.\n\nNous attendons que le vendeur clique sur ACCEPTER ou REFUSER.\nTapez ANNULER pour retirer votre demande.`,

  BUYER_INVITE_BUTTONS: (sellerPhone: string, itemDescription: string, amount: number) => `🛡️ Clairtus | Nouveau contrat de sécurité\n\nLe vendeur (${sellerPhone}) vous propose une transaction protégée.\n\n📦 Article: ${itemDescription}\n💰 Montant: ${amount} $\n\nVotre argent sera mis en sécurité par Clairtus et remis au vendeur UNIQUEMENT quand vous aurez reçu l'article.\n\nAcceptez-vous de sécuriser cet achat ?`,
  SELLER_INVITE_BUTTONS: (buyerPhone: string, itemDescription: string, amount: number) => `🛡️ Clairtus | Nouveau contrat de sécurité\n\nL'acheteur (${buyerPhone}) vous propose une transaction protégée.\n\n📦 Article: ${itemDescription}\n💰 Montant: ${amount} $\n\nAcceptez-vous cette transaction ?`,

  CONTRACT_ACCEPTED_SELLER_NOTIFIED: `☑️ Contrat accepté.\n\nL'acheteur a validé la transaction. Nous attendons maintenant son paiement Mobile Money.\n\n⚠️ N'expédiez pas encore l'article.`,
  CONTRACT_ACCEPTED_BUYER_NOTIFIED: `☑️ Contrat accepté.\n\nLe vendeur a validé votre demande. La transaction est prête.`,
  PRE_PAYMENT_BUYER: `💳 Paiement en attente\n\nLe contrat est prêt. Sécurisez les fonds maintenant pour autoriser le vendeur à expédier.`,

  DEPOSIT_INITIATED: `⏳ Génération de la facture Mobile Money en cours...\n\nVeuillez valider le prompt M-Pesa / Orange / Airtel qui va s'afficher sur votre téléphone pour placer vos fonds sous séquestre.`,
  DEPOSIT_ERROR: `❌ Échec de connexion à l'opérateur.\n\nL'opérateur télécom ne répond pas ou le montant est invalide. Veuillez taper PAYER pour réessayer.`,

  // 🚀 UPGRADED: The PIN Generation Messages
  PAYMENT_SUCCESS_BUYER: (amount: number, pin: string) => `✅ Paiement de ${amount} $ réussi !\n\nVos fonds sont sécurisés. Voici votre code secret de livraison : *${pin}*\n\nNe donnez ce code au vendeur QUE lorsque vous avez reçu et inspecté l'article.`,
  PAYMENT_SUCCESS_SELLER: (amount: number) => `✅ Fonds sécurisés !\n\nL'acheteur a payé ${amount} $.\n\n📦 Veuillez expédier l'article. À la livraison, demandez à l'acheteur son code secret à 4 chiffres et envoyez-le ici pour débloquer vos fonds.`,
  PAYMENT_FAILED_BUYER: `❌ Échec du paiement.\n\nLe paiement Mobile Money a échoué (solde insuffisant ou délai dépassé).\n\nTapez PAYER pour générer une nouvelle facture, ou ANNULER pour annuler le contrat.`,

  // 🚀 UPGRADED: The Payout Execution Messages
  PIN_INVALID: `❌ Code incorrect.\n\nVeuillez vérifier le code à 4 chiffres avec l'acheteur et réessayer.`,
  PAYOUT_INITIATED: (amount: number) => `✅ Code validé !\n\nTransfert de vos fonds (${amount} $, frais de service de 2.5% déduits) en cours... Vous recevrez un dépôt Mobile Money sous peu. Merci d'utiliser Clairtus !`,
  BUYER_DELIVERY_CONFIRMED: `📦 Livraison confirmée !\n\nLe vendeur a validé votre code secret. La transaction est officiellement terminée. Merci d'avoir utilisé Clairtus !`,

  UNKNOWN_MESSAGE: `❓ Commande non reconnue.\n\nClairtus est un terminal automatisé. Veuillez utiliser les commandes exactes:\nTapez BONJOUR pour ouvrir le menu.`
};