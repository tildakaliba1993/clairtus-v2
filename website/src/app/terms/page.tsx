import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#020617] text-slate-300 py-20 px-6 sm:px-12 selection:bg-primary/30">
      <div className="max-w-3xl mx-auto bg-white/[0.02] border border-white/10 rounded-3xl p-8 sm:p-12 shadow-2xl backdrop-blur-sm">
        <h1 className="text-3xl font-bold text-white mb-8 font-heading">Conditions d'Utilisation</h1>
        
        <div className="space-y-6 text-sm leading-relaxed">
          <p>Dernière mise à jour : Mai 2026</p>
          
          <h2 className="text-xl font-semibold text-white mt-8">1. Rôle de Clairtus</h2>
          <p>Clairtus agit exclusivement en tant que Tiers de Confiance (séquestre) facilitant les transactions entre un Acheteur et un Vendeur via WhatsApp. Clairtus n'est pas le propriétaire des biens vendus et ne garantit pas la qualité des produits.</p>

          <h2 className="text-xl font-semibold text-white mt-8">2. Séquestre et Libération des Fonds</h2>
          <p>Les fonds déposés par l'Acheteur sont conservés de manière sécurisée par notre partenaire financier réglementé (PawaPay). L'argent n'est transféré au Vendeur qu'après la remise du code PIN secret par l'Acheteur, confirmant la bonne réception de la commande.</p>

          <h2 className="text-xl font-semibold text-white mt-8">3. Frais de Service</h2>
          <p>La plateforme Clairtus prélève des frais fixes de 2.5% sur le montant total de la transaction réussie, déduits lors du transfert final vers le vendeur. Les frais de dépôt et de retrait imposés par les opérateurs de réseaux mobiles (M-Pesa, Orange, Airtel) restent à la charge de l'utilisateur.</p>

          <h2 className="text-xl font-semibold text-white mt-8">4. Litiges et Lutte contre la Fraude</h2>
          <p>En cas de litige, les fonds sont gelés jusqu'à résolution à l'amiable ou arbitrage par notre équipe. Toute tentative de blanchiment d'argent, d'utilisation de fausses identités ou de fraude entraînera un blocage immédiat du compte et la coopération avec les autorités financières de la RDC.</p>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 text-center">
          <Link href="/" className="text-primary hover:text-emerald-400 font-medium transition-colors">
            &larr; Retour à l'accueil
          </Link>
        </div>
      </div>
    </main>
  );
}