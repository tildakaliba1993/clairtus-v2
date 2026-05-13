// src/app/page.tsx
"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Lock, ShieldAlert, CheckCircle, XCircle, AlertTriangle, RefreshCw, LogOut, ShieldCheck, UserX } from "lucide-react";

export default function AdminPortal() {
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  // Dashboard State
  const [transactions, setTransactions] = useState<any[]>([]);
  const [userMap, setUserMap] = useState<Record<string, any>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchDashboardData();
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchDashboardData();
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchDashboardData = async () => {
    // Fetch transactions and users in parallel for speed
    const [txResponse, usersResponse] = await Promise.all([
      supabase.from("transactions").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("users").select("*")
    ]);

    if (txResponse.data) setTransactions(txResponse.data);
    
    if (usersResponse.data) {
      // Map users by phone number for instant lookup O(1)
      const mappedUsers = usersResponse.data.reduce((acc: any, user: any) => {
        acc[user.phone_number] = user;
        return acc;
      }, {});
      setUserMap(mappedUsers);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError("Accès refusé. Identifiants incorrects.");
    setLoading(false);
  };

  const handleAdminAction = async (txId: string, action: "FORCE_RELEASE" | "FORCE_REFUND") => {
    if (!confirm(`Êtes-vous sûr de vouloir exécuter l'action : ${action} ?`)) return;
    
    setActionLoading(txId);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/admin-actions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.NEXT_PUBLIC_ADMIN_SECRET}`
        },
        body: JSON.stringify({
          action,
          transaction_id: txId,
          admin_note: "Action exécutée depuis le portail Admin web."
        })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Action failed");
      
      alert(`Succès : ${result.message}`);
      fetchDashboardData(); 
    } catch (err: any) {
      alert(`Erreur : ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  // Helper to render User with Trust Badge
  const renderUserCell = (phone: string) => {
    if (!phone) return <span className="text-gray-500">-</span>;
    const user = userMap[phone];
    if (!user) return <span className="font-mono text-sm">{phone}</span>;

    const isTrusted = user.trust_score >= 60;
    const isRisky = user.trust_score < 40;
    
    return (
      <div className="flex flex-col space-y-1">
        <span className="font-mono text-sm">{phone}</span>
        <div className={`flex items-center w-fit px-2 py-0.5 rounded text-[10px] font-semibold border
          ${isRisky ? 'bg-red-500/10 text-red-400 border-red-500/20' : 
            isTrusted ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 
            'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}
        >
          {isRisky ? <UserX className="w-3 h-3 mr-1" /> : <ShieldCheck className="w-3 h-3 mr-1" />}
          Score: {user.trust_score}
        </div>
      </div>
    );
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">Chargement du système sécurisé...</div>;

  // --- LOGIN SCREEN ---
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
        <div className="max-w-md w-full bg-gray-900 rounded-xl shadow-2xl border border-gray-800 p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="bg-emerald-500/10 p-4 rounded-full mb-4">
              <ShieldAlert className="w-12 h-12 text-emerald-500" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-wider">CLAIRTUS COMMAND</h1>
            <p className="text-gray-400 text-sm mt-2">Accès restreint à l'administration</p>
          </div>
          {error && <div className="bg-red-500/10 border border-red-500 text-red-500 p-3 rounded-lg text-sm mb-6 text-center">{error}</div>}
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">Email Administrateur</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">Mot de passe</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none" required />
            </div>
            <button type="submit" disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center transition-colors">
              <Lock className="w-5 h-5 mr-2" />
              Déverrouiller le portail
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- MAIN DASHBOARD ---
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 font-sans">
      <header className="bg-gray-900 border-b border-gray-800 px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center space-x-3">
          <ShieldAlert className="w-8 h-8 text-emerald-500" />
          <h1 className="text-xl font-bold text-white tracking-widest">CLAIRTUS <span className="text-emerald-500">COMMAND</span></h1>
        </div>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-400">{session.user.email}</span>
          <button onClick={() => supabase.auth.signOut()} className="flex items-center text-sm bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg transition-colors">
            <LogOut className="w-4 h-4 mr-2" /> Déconnexion
          </button>
        </div>
      </header>

      <main className="p-8 max-w-7xl mx-auto">
        <div className="flex justify-between items-end mb-6">
          <div>
            <h2 className="text-2xl font-bold text-white mb-1">Radar des Transactions</h2>
            <p className="text-sm text-gray-400">Surveillance en temps réel avec indicateur de confiance (Trust Score).</p>
          </div>
          <button onClick={fetchDashboardData} className="flex items-center text-sm bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg transition-colors border border-gray-700">
            <RefreshCw className="w-4 h-4 mr-2" /> Rafraîchir
          </button>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-gray-950/50 border-b border-gray-800 text-gray-400">
                <tr>
                  <th className="px-6 py-4 font-medium">Référence</th>
                  <th className="px-6 py-4 font-medium">Vendeur</th>
                  <th className="px-6 py-4 font-medium">Acheteur</th>
                  <th className="px-6 py-4 font-medium">Montant</th>
                  <th className="px-6 py-4 font-medium">Statut</th>
                  <th className="px-6 py-4 font-medium text-right">Arbitrage (God Mode)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {transactions.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">Aucune transaction trouvée.</td></tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-gray-800/50 transition-colors">
                      <td className="px-6 py-4 font-mono text-emerald-400">{tx.reference}</td>
                      <td className="px-6 py-4">{renderUserCell(tx.seller_phone)}</td>
                      <td className="px-6 py-4">{renderUserCell(tx.buyer_phone)}</td>
                      <td className="px-6 py-4 font-semibold text-white">
                        {tx.base_amount ? `${tx.base_amount} ${tx.currency}` : "-"}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium flex w-fit items-center gap-1
                          ${tx.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : ''}
                          ${tx.status === 'FUNDED' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : ''}
                          ${tx.status === 'DISPUTED' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : ''}
                          ${tx.status === 'CANCELLED' || tx.status === 'REFUNDED' ? 'bg-gray-500/10 text-gray-400 border border-gray-500/20' : ''}
                          ${['INITIATED', 'PENDING_FUNDING', 'DRAFT'].includes(tx.status) ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : ''}
                        `}>
                          {tx.status === 'COMPLETED' && <CheckCircle className="w-3 h-3" />}
                          {tx.status === 'DISPUTED' && <AlertTriangle className="w-3 h-3" />}
                          {(tx.status === 'CANCELLED' || tx.status === 'REFUNDED') && <XCircle className="w-3 h-3" />}
                          {tx.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right space-x-2">
                        {(tx.status === "FUNDED" || tx.status === "DISPUTED") ? (
                          <>
                            <button
                              onClick={() => handleAdminAction(tx.id, "FORCE_RELEASE")}
                              disabled={actionLoading === tx.id}
                              className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50"
                            >
                              {actionLoading === tx.id ? "..." : "Payer Vendeur"}
                            </button>
                            <button
                              onClick={() => handleAdminAction(tx.id, "FORCE_REFUND")}
                              disabled={actionLoading === tx.id}
                              className="bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50"
                            >
                              {actionLoading === tx.id ? "..." : "Rembourser Acheteur"}
                            </button>
                          </>
                        ) : (
                          <span className="text-gray-600 text-xs italic">Verrouillé</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}