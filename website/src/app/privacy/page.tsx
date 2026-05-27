import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#020617] text-slate-300 py-20 px-6 sm:px-12 selection:bg-primary/30">
      <div className="max-w-3xl mx-auto bg-white/[0.02] border border-white/10 rounded-3xl p-8 sm:p-12 shadow-2xl backdrop-blur-sm">
        <h1 className="text-3xl font-bold text-white mb-8 font-heading">Politique de Confidentialité</h1>
        
        <div className="space-y-6 text-sm leading-relaxed">
          <p>Dernière mise à jour : Mai 2026</p>
          
          <h2 className="text-xl font-semibold text-white mt-8">1. Collecte des Données</h2>
          <p>Dans le cadre de l'utilisation du bot WhatsApp Clairtus, nous collectons des données strictement nécessaires au bon fonctionnement du service d'entiercement : votre numéro de téléphone, votre prénom, votre nom de famille, et l'historique de vos transactions.</p>

          <h2 className="text-xl font-semibold text-white mt-8">2. Documents d'Identité (KYC)</h2>
          <p>Pour nous conformer aux lois contre le blanchiment de capitaux, il peut vous être demandé de fournir une image de votre pièce d'identité (Carte d'électeur ou Passeport). Ces documents sont stockés de manière chiffrée, utilisés uniquement à des fins de vérification, et ne sont jamais partagés à des fins commerciales.</p>

          <h2 className="text-xl font-semibold text-white mt-8">3. Traitement des Paiements</h2>
          <p>Vos numéros de compte Mobile Money sont transmis de manière sécurisée à notre partenaire intégrateur (PawaPay) pour initier les dépôts et les retraits. Clairtus n'a jamais accès à vos mots de passe ou codes PIN bancaires personnels.</p>

          <h2 className="text-xl font-semibold text-white mt-8">4. Conservation et Suppression</h2>
          <p>Vos données sont conservées aussi longtemps que votre compte est actif. Vous pouvez demander la suppression de vos données personnelles en contactant notre support, sous réserve de nos obligations légales de conservation des registres financiers.</p>
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