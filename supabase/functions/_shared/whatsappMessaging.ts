// supabase/functions/_shared/whatsappMessaging.ts

export const MESSAGES = {
  // 1. IDENTITY CAPTURE FLOW
  FIRST_NAME_REQUEST: `🛡️ Initialisation du protocole de sécurité.\n\nBienvenue sur Clairtus. L'ultime couche de confiance pour vos affaires : zéro fraude, zéro stress.\n\n⚠️ Important : Pour utiliser nos services, votre numéro WhatsApp doit être le même que votre compte Mobile Money, et être enregistré à votre propre nom.\n\nPour commencer, quel est votre prénom ? (Répondez uniquement avec votre prénom)`,
  FIRST_NAME_INVALID: `❌ Format invalide.\n\nVeuillez envoyer uniquement votre prénom, sans caractères spéciaux.\nExemple : Patrick`,
  LAST_NAME_REQUEST: `👤 Prénom enregistré.\n\nQuel est votre nom de famille ? (Répondez uniquement avec votre nom)`,
  LAST_NAME_INVALID: `❌ Format invalide.\n\nVeuillez envoyer uniquement votre nom de famille.\nExemple : Mbuyi`,

  // 1.5 PROMO CODE FLOW
  ASK_PROMO_CODE: (name: string) => `Enchanté ${name} ! 🎉\n\nAvez-vous un code promo exclusif (ex: BETA26) ?\nSi oui, envoyez-le maintenant.\nSi non, répondez simplement *NON*.`,
  PROMO_CODE_SUCCESS: (code: string, feePct: number) =>
    feePct === 0
      ? `🎉 *Code promo ${code} activé !*\n\n✅ *Zéro frais d'escrow* sur toutes vos transactions.\n\nCe code profite automatiquement aux deux parties — votre acheteur ou vendeur n'aura rien à payer non plus.\n\nTapez *BONJOUR* pour ouvrir le menu.`
      : `🎉 *Code promo ${code} activé !*\n\n✅ Vos frais d'escrow sont réduits à *${feePct}%* au lieu de 1.5%.\n\nTapez *BONJOUR* pour ouvrir le menu.`,
  PROMO_CODE_INVALID: `❌ Code non reconnu ou expiré.\n\nRépondez *NON* pour continuer sans code, ou réessayez.`,
  REGISTRATION_COMPLETE: `✅ Votre compte Vendeur est créé.\n\nQue souhaitez-vous faire aujourd'hui ?\nTapez *VENDRE* pour initier une transaction sécurisée.`,

  // 2. GUIDED TRANSACTION FLOW
  WELCOME_NEW: `👋 Bienvenue sur Clairtus, le réseau de confiance.\n\nL'argent est mis en sécurité lors de la commande et libéré uniquement à la livraison.\n\nQue souhaitez-vous faire ?`,
  WELCOME_RETURNING: (firstName: string, lastName: string) =>
    `👋 Bonjour ${firstName} ${lastName}.\n\nVotre profil est sécurisé. Prêt à faire des affaires sans risque ?\n\nQue souhaitez-vous faire ?`,

  SELL_ITEM_REQUEST: `📦 Mode VENTE activé.\n\nAstuce Clairtus : Ne déplacez jamais votre marchandise pour rien. L'argent de l'acheteur est sécurisé sur nos serveurs avant même votre expédition.\n\nQue vendez-vous ?\n(Décrivez l'article brièvement, ex: iPhone 13 Pro)`,
  BUY_ITEM_REQUEST: `🛒 Mode ACHAT activé.\n\nAstuce Clairtus : Ne payez plus jamais dans le vide. Le vendeur ne recevra votre argent qu'après votre validation à la livraison.\n\nQu'achetez-vous ?\n(Décrivez l'article brièvement, ex: Écran TV Samsung)`,

  CURRENCY_REQUEST: `💱 Devise de la transaction\n\nDans quelle devise se fera cette opération ? Sélectionnez la devise exacte de votre compte Mobile Money :`,

  PRICE_REQUEST_SELL: (itemDescription: string, currency: string) =>
    `🏷️ Article : ${itemDescription}\n\nÀ quel prix vendez-vous cet article ?\n(Envoyez uniquement le montant en ${currency})`,
  PRICE_REQUEST_BUY: (itemDescription: string, currency: string) =>
    `🏷️ Article : ${itemDescription}\n\nQuel est le prix convenu avec le vendeur ?\n(Envoyez uniquement le montant en ${currency})\n\n💡 Note : Les frais Mobile Money opérateur s'appliqueront.`,

  AMOUNT_INVALID_FORMAT: `❌ Format du prix invalide.\n\nEnvoyez uniquement des chiffres.\nExemple : 150 ou 150.50`,

  AMOUNT_TOO_LOW: (min: number, currency: string) =>
    `❌ *Montant trop faible.*\n\nLe montant minimum par transaction est de *${min.toLocaleString('fr-FR')} ${currency}*.\n\nVeuillez entrer un montant plus élevé.`,
  AMOUNT_TOO_HIGH: (max: number, currency: string) =>
    `🚫 *Montant trop élevé.*\n\nLa Banque Centrale du Congo (BCC) limite chaque paiement Mobile Money à *${max.toLocaleString('fr-FR')} ${currency}* maximum.\n\nPour une transaction plus importante, vous pouvez la répartir sur plusieurs jours. Veuillez entrer un montant inférieur ou égal à *${max.toLocaleString('fr-FR')} ${currency}*.`,
  BCC_DAILY_LIMIT: (remaining: number, currency: string) =>
    `🏦 *Plafond journalier atteint*\n\nPour respecter la réglementation de la Banque Centrale du Congo (BCC), les paiements sont limités à *500 USD par jour* (ou l'équivalent en CDF).\n\n💡 Il vous reste *${remaining.toLocaleString('fr-FR')} ${currency}* aujourd'hui. Vous pourrez effectuer le reste demain, ou réduire le montant de cette transaction.`,
  BCC_MONTHLY_LIMIT: (remaining: number, currency: string) =>
    `🏦 *Plafond mensuel atteint*\n\nPour respecter la réglementation de la Banque Centrale du Congo (BCC), les paiements sont limités à *2 500 USD sur 30 jours* (ou l'équivalent en CDF).\n\n💡 Il vous reste *${remaining.toLocaleString('fr-FR')} ${currency}* ce mois-ci. Votre plafond se reconstitue progressivement. Vous pouvez réduire le montant ou réessayer plus tard.`,

  COUNTERPARTY_PHONE_REQUEST_SELL: (amount: number, currency: string) =>
    `💰 Prix : ${amount} ${currency}\n\nQuel est le numéro WhatsApp ou Mobile Money de l'ACHETEUR ?\n(Format international obligatoire, ex: +243810000000)\n\n⚠️ *Important : L'acheteur doit utiliser M-Pesa ou Orange. Les dépôts Airtel sont temporairement suspendus pour garantir des paiements instantanés.*`,
  COUNTERPARTY_PHONE_REQUEST_BUY: (amount: number, currency: string) =>
    `💰 Prix : ${amount} ${currency}\n\nQuel est le numéro WhatsApp ou Mobile Money du VENDEUR ?\n(Format international obligatoire, ex: +243810000000)`,

  // 2.5 SPLIT PAYOUT FLOW
  ASK_SPLIT_CHOICE: `Voulez-vous partager ce paiement final avec un deuxième vendeur ou un bailleur ?\n\nRépondez *OUI* ou *NON*.`,
  ASK_SECONDARY_PHONE: `Entrez le numéro Mobile Money du deuxième bénéficiaire au format international (ex: +243900000000) :`,
  ASK_SECONDARY_AMOUNT: (total: number, currency: string) => `Sur le total de ${total} ${currency}, quel montant brut doit être envoyé à ce deuxième numéro ?\n\n(Répondez uniquement avec un nombre, ex: 400)`,
  SPLIT_AMOUNT_ERROR: `⚠️ Erreur : Le montant de la part doit être inférieur au total. Veuillez réessayer.`,

  // 2.8 AIRTEL STRATEGIC BLOCKS
  AIRTEL_BUYER_BLOCKED: `❌ Dépôt Airtel Non Disponible.\n\nPour garantir la fiabilité et la rapidité de vos transactions, les paiements entrants via Airtel sont temporairement suspendus.\n\n👉 *Veuillez utiliser un numéro M-Pesa ou Orange pour payer.*\n\n(Note: Les retraits vers Airtel pour les vendeurs restent 100% fonctionnels).`,

  // 3. VALIDATION & INVITE MESSAGES
  PHONE_INVALID: `❌ Numéro invalide.\n\nLe numéro doit inclure l'indicatif du pays sans espaces.\nExemple : +243810000000`,
  SELF_TRANSACTION_BLOCKED: `🚫 Action non autorisée.\n\nVous ne pouvez pas effectuer une transaction avec votre propre numéro. Veuillez entrer le numéro de votre contrepartie.`,

  SELLER_WAITING_FOR_BUYER: `⏳ Vous avez une transaction en attente.\n\nNous attendons que l'acheteur clique sur ACCEPTER ou REFUSER.\n\n👉 Tapez ANNULER pour retirer votre offre.`,
  BUYER_WAITING_FOR_SELLER: `⏳ Vous avez une transaction en attente.\n\nNous attendons que le vendeur clique sur ACCEPTER ou REFUSER.\n\n👉 Tapez ANNULER pour annuler votre demande.`,

  BUYER_INVITE_BUTTONS: (sellerPhone: string, itemDescription: string) =>
    `🛡️ Clairtus | Nouveau contrat de sécurité\n\nLe vendeur (${sellerPhone}) vous propose une transaction protégée.\n\n📦 Article : ${itemDescription}\n\nVotre argent sera mis en sécurité par Clairtus et remis au vendeur UNIQUEMENT quand vous aurez reçu l'article.`,
  SELLER_INVITE_BUTTONS: (buyerPhone: string, itemDescription: string) =>
    `🛡️ Clairtus | Nouveau contrat de sécurité\n\nL'acheteur (${buyerPhone}) vous propose une transaction protégée.\n\n📦 Article : ${itemDescription}\n\nAcceptez-vous cette transaction ?`,

  // Fee arrangement descriptions shown to the invited counterparty.
  // feePct = 0 means a promo code has waived all fees for the transaction.
  FEE_DESCRIPTION_FOR_BUYER: (base: number, currency: string, feeResp: string, feePct: number) => {
    if (feePct === 0) return `🎉 *Zéro frais d'escrow !* Code promo actif sur cette transaction. *Vous payez exactement : ${base} ${currency}.*`;
    const fee = parseFloat((base * feePct / 100).toFixed(2));
    const pct = `${feePct}%`;
    if (feeResp === 'SELLER') return `💚 *Le vendeur couvre les frais d'escrow (${pct}).* Vous payez exactement : *${base} ${currency}.*`;
    if (feeResp === 'BUYER') return `💡 *Les frais d'escrow Clairtus (${pct} = ${fee} ${currency}) sont à votre charge.* Total à payer : *${parseFloat((base + fee).toFixed(2))} ${currency}.*`;
    const half = parseFloat((fee / 2).toFixed(2));
    return `🤝 *Frais partagés 50/50.* Votre part : *${half} ${currency}*. Total à payer : *${parseFloat((base + half).toFixed(2))} ${currency}.*`;
  },
  FEE_DESCRIPTION_FOR_SELLER: (base: number, currency: string, feeResp: string, feePct: number) => {
    if (feePct === 0) return `🎉 *Zéro frais d'escrow !* Code promo actif sur cette transaction. *Vous recevrez : ${base} ${currency} net.*`;
    const fee = parseFloat((base * feePct / 100).toFixed(2));
    const pct = `${feePct}%`;
    if (feeResp === 'BUYER') return `💚 *L'acheteur couvre les frais d'escrow (${pct}).* Vous recevrez : *${base} ${currency} net.*`;
    if (feeResp === 'SELLER') return `💡 *Les frais d'escrow Clairtus (${pct} = ${fee} ${currency}) sont à votre charge.* Vous recevrez : *${parseFloat((base - fee).toFixed(2))} ${currency} net.*`;
    const half = parseFloat((fee / 2).toFixed(2));
    return `🤝 *Frais partagés 50/50.* Votre part : *${half} ${currency}*. Vous recevrez : *${parseFloat((base - half).toFixed(2))} ${currency} net.*`;
  },

  // 4. PRE-PAYMENT & ACCEPTANCE MESSAGES
  CONTRACT_ACCEPTED_SELLER_NOTIFIED: `☑️ Contrat accepté.\n\nEn attente du paiement Mobile Money de l'acheteur. N'expédiez pas encore la marchandise.`,
  CONTRACT_ACCEPTED_BUYER_NOTIFIED: `☑️ Contrat accepté.\n\nLe vendeur a validé la transaction. Nous générons votre lien de paiement...`,
  PRE_PAYMENT_BUYER: `💳 Paiement en attente\n\nLe contrat est prêt. Mettez les fonds en sécurité maintenant pour autoriser le vendeur à expédier.`,

  DEPOSIT_INITIATED: `⏳ Demande de paiement envoyée à votre opérateur.\n\n📲 Un écran de validation (prompt) va s'afficher sur votre téléphone d'ici quelques secondes pour saisir votre code PIN.\n\n🛡️ *PLAN B (Si l'écran n'apparaît pas) :*\nLes réseaux télécoms ont parfois des retards. Ne paniquez pas.\nAttendez 1 minute, puis tapez simplement *RÉESSAYER* ici pour qu'on vous renvoie la demande à l'écran.`,

  DEPOSIT_ERROR: `❌ Échec de connexion à l'opérateur.\n\nL'opérateur télécom ne répond pas. Veuillez réessayer dans 5 minutes.`,

  // 5. POST-PAYMENT & DELIVERY MESSAGES
  PAYMENT_SUCCESS_BUYER: (depositAmount: number, currency: string, pin: string) =>
    `🔒 FONDS SÉCURISÉS AVEC SUCCÈS\n\nVotre paiement de *${depositAmount} ${currency}* est placé en toute sécurité sur Clairtus.\n\n🔑 VOTRE CODE PIN SECRET : *${pin}*\n\n⚠️ RÈGLE D'OR :\n1. Inspectez la marchandise à la livraison.\n2. Si conforme, donnez ce code au livreur.\n3. Ne partagez JAMAIS ce code avant d'avoir l'article en main.`,

  PAYMENT_SUCCESS_SELLER: (baseAmount: number, sellerNet: number, currency: string) =>
    `🔒 L'ACHETEUR A PAYÉ\n\nLes fonds sont fermement sécurisés sur nos serveurs. Vous ne risquez plus rien.\n\n💰 *Votre paiement net : ${sellerNet} ${currency}* (frais d'escrow 1.5% déduits sur ${baseAmount} ${currency}).\n\n👉 VOS INSTRUCTIONS :\n1. Expédiez la commande immédiatement.\n2. À la livraison, demandez à l'acheteur son code PIN secret à 4 chiffres.\n3. Tapez ce code ici dans cette conversation.`,

  PAYMENT_FAILED_BUYER: `❌ Échec du paiement.\n\nLe paiement Mobile Money a échoué (solde insuffisant ou délai dépassé). Vérifiez votre solde et cliquez sur RÉESSAYER.`,

  PIN_INVALID: `❌ Code PIN incorrect.\n\nCe n'est pas le bon code. Demandez à l'acheteur de vérifier le code qu'il a reçu. (Attention : 3 échecs bloqueront la transaction).`,

  PAYOUT_INITIATED: `✅ CODE PIN VALIDE.\n\nLe contrat est rempli. Décaissement automatique de vos fonds vers votre compte Mobile Money en cours...`,

  PAYMENT_SUCCESS_BUYER_FINAL: `✅ Transaction clôturée.\n\nLe code PIN a été utilisé avec succès. Le vendeur a reçu son argent.`,

  // 6. FALLBACK MESSAGES
  UNKNOWN_MESSAGE: `❓ Commande non reconnue.\n\nClairtus est un terminal automatisé. Veuillez utiliser les boutons fournis. Tapez BONJOUR pour ouvrir le menu principal.`
};
