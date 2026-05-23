// @ts-nocheck
"use client";

import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { Lock, ShieldAlert, CheckCircle, XCircle, AlertTriangle, RefreshCw, LogOut, ShieldCheck, UserX, Search, Filter, DollarSign, Activity, AlertOctagon, X, Ban, Clock } from "lucide-react";

export default function AdminPortal() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  const [transactions, setTransactions] = useState([]);
  const [userMap, setUserMap] = useState({});
  const [actionLoading, setActionLoading] = useState(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedTx, setSelectedTx] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchDashboardData();
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        fetchDashboardData();
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/admin/dashboard', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch dashboard data: ${response.statusText}`);
      }

      const { transactions: txData, users: usersData } = await response.json();

      if (txData) setTransactions(txData);
      
      if (usersData) {
        const mappedUsers = usersData.reduce((acc: any, user: any) => {
          if (user.phone_number) {
            acc[user.phone_number] = user;
          }
          return acc;
        }, {});
        setUserMap(mappedUsers);
      }
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError("Accès refusé. Identifiants incorrects.");
    setLoading(false);
  };

  const handleAdminAction = async (txId, action, targetPhone = "") => {
    if (!window.confirm(`Confirmer l'action : ${action} ?`)) return;
    
    setActionLoading(action === "BAN_USER" ? targetPhone || "ban" : txId);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL || ""}/functions/v1/admin-actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.NEXT_PUBLIC_ADMIN_SECRET || ""}` },
        body: JSON.stringify({ action, transaction_id: txId, admin_note: "Intervention via Command Center.", target_phone: targetPhone })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Action failed");
      
      alert(`Succès : ${result.message}`);
      fetchDashboardData(); 
      if (selectedTx && action !== "BAN_USER") setSelectedTx(null);
    } catch (err) {
      alert(`Erreur : ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const metrics = useMemo(() => {
    const float = transactions.filter(t => t.status === 'FUNDED').reduce((acc, t) => acc + (Number(t.base_amount) || 0), 0);
    const revenue = transactions.filter(t => t.status === 'COMPLETED').reduce((acc, t) => acc + ((Number(t.base_amount) || 0) * 0.025), 0);
    const disputes = transactions.filter(t => t.status === 'DISPUTED').length;
    return { float, revenue, disputes };
  }, [transactions]);

  const filteredTxs = useMemo(() => {
    return transactions.filter(t => {
      const matchesSearch = (t.reference?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                             t.seller_phone?.includes(searchTerm) || 
                             t.buyer_phone?.includes(searchTerm));
      const matchesStatus = statusFilter === "ALL" || t.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [transactions, searchTerm, statusFilter]);

  const renderUserCell = (phone) => {
    if (!phone) return <span className="text-gray-500">-</span>;
    const user = userMap[phone];
    if (!user) return <span className="font-mono text-sm">{phone}</span>;

    const isBanned = user.kyc_level === 'BANNED';
    const isTrusted = (Number(user.trust_score) || 0) >= 60;
    const isRisky = (Number(user.trust_score) || 0) < 40;
    
    return (
      <div className="flex flex-col space-y-1">
        <span className={`font-mono text-sm ${isBanned ? 'line-through text-red-500' : ''}`}>{phone}</span>
        <div className={`flex items-center w-fit px-2 py-0.5 rounded text-[10px] font-semibold border
          ${isBanned ? 'bg-red-900/50 text-red-500 border-red-500' :
            isRisky ? 'bg-red-500/10 text-red-400 border-red-500/20' : 
            isTrusted ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 
            'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}
        >
          {isBanned ? <Ban className="w-3 h-3 mr-1" /> : isRisky ? <UserX className="w-3 h-3 mr-1" /> : <ShieldCheck className="w-3 h-3 mr-1" />}
          {isBanned ? "BANNED" : `Score: ${user.trust_score || 0}`}
        </div>
      </div>
    );
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">Chargement...</div>;

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
        <div className="max-w-md w-full bg-gray-900 rounded-xl shadow-2xl border border-gray-800 p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="bg-emerald-500/10 p-4 rounded-full mb-4"><ShieldAlert className="w-12 h-12 text-emerald-500" /></div>
            <h1 className="text-2xl font-bold text-white tracking-wider">CLAIRTUS COMMAND</h1>
            <p className="text-gray-400 text-sm mt-2">Accès restreint à l&apos;administration</p>
          </div>
          {error && <div className="bg-red-500/10 border border-red-500 text-red-500 p-3 rounded-lg text-sm mb-6 text-center">{error}</div>}
          <form onSubmit={handleLogin} className="space-y-6">
            <div><input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-white focus:border-emerald-500 outline-none" required /></div>
            <div><input type="password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-white focus:border-emerald-500 outline-none" required /></div>
            <button type="submit" disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-lg"><Lock className="w-5 h-5 inline mr-2" /> Déverrouiller</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 font-sans pb-10">
      <header className="bg-gray-900 border-b border-gray-800 px-8 py-4 flex justify-between items-center sticky top-0 z-10 shadow-md">
        <div className="flex items-center space-x-3">
          <ShieldAlert className="w-8 h-8 text-emerald-500" />
          <h1 className="text-xl font-bold text-white tracking-widest">CLAIRTUS <span className="text-emerald-500">COMMAND</span></h1>
        </div>
        <button onClick={() => { supabase.auth.signOut(); }} className="flex items-center text-sm bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg transition-colors"><LogOut className="w-4 h-4 mr-2" /> Déconnexion</button>
      </header>

      <main className="p-8 max-w-7xl mx-auto space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl flex items-center justify-between">
            <div><p className="text-sm text-gray-400">Fonds en Séquestre (Float)</p><p className="text-2xl font-bold text-blue-400">${metrics.float.toFixed(2)}</p></div>
            <div className="bg-blue-500/10 p-3 rounded-lg"><DollarSign className="w-6 h-6 text-blue-500" /></div>
          </div>
          <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl flex items-center justify-between">
            <div><p className="text-sm text-gray-400">Revenus Générés (2.5%)</p><p className="text-2xl font-bold text-emerald-400">${metrics.revenue.toFixed(2)}</p></div>
            <div className="bg-emerald-500/10 p-3 rounded-lg"><Activity className="w-6 h-6 text-emerald-500" /></div>
          </div>
          <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl flex items-center justify-between">
            <div><p className="text-sm text-gray-400">Litiges Actifs</p><p className="text-2xl font-bold text-red-500">{metrics.disputes}</p></div>
            <div className="bg-red-500/10 p-3 rounded-lg"><AlertOctagon className="w-6 h-6 text-red-500" /></div>
          </div>
        </div>

        <div className="flex flex-col md:flex-row justify-between items-center bg-gray-900 border border-gray-800 p-4 rounded-xl gap-4">
          <div className="flex w-full md:w-1/2 space-x-4">
            <div className="relative w-full">
              <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-500" />
              <input type="text" placeholder="Rechercher ID ou Téléphone..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-gray-950 border border-gray-800 rounded-lg pl-10 pr-4 py-2 text-white focus:border-emerald-500 outline-none" />
            </div>
            <div className="relative min-w-[150px]">
              <Filter className="absolute left-3 top-2.5 w-5 h-5 text-gray-500" />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full bg-gray-950 border border-gray-800 rounded-lg pl-10 pr-4 py-2 text-white appearance-none focus:border-emerald-500 outline-none">
                <option value="ALL">Tous les statuts</option>
                <option value="DISPUTED">⚠️ Litiges</option>
                <option value="FUNDED">🔒 Financé</option>
                <option value="PENDING_FUNDING">⏳ En attente</option>
                <option value="COMPLETED">✅ Complété</option>
              </select>
            </div>
          </div>
          <button onClick={() => { fetchDashboardData(); }} className="flex items-center text-sm bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg"><RefreshCw className="w-4 h-4 mr-2" /> Actualiser</button>
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
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filteredTxs.length === 0 ? (
                  <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">Aucun résultat.</td></tr>
                ) : (
                  filteredTxs.map((tx) => (
                    <tr key={tx.id} onClick={() => { setSelectedTx(tx); }} className="hover:bg-gray-800/80 transition-colors cursor-pointer group">
                      <td className="px-6 py-4 font-mono text-emerald-400 group-hover:underline">{tx.reference}</td>
                      <td className="px-6 py-4">{renderUserCell(tx.seller_phone)}</td>
                      <td className="px-6 py-4">{renderUserCell(tx.buyer_phone)}</td>
                      <td className="px-6 py-4 font-semibold text-white">{tx.base_amount ? `${tx.base_amount} ${tx.currency}` : "-"}</td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium flex w-fit items-center gap-1
                          ${tx.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : ''}
                          ${tx.status === 'FUNDED' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : ''}
                          ${tx.status === 'DISPUTED' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : ''}
                          ${tx.status === 'CANCELLED' || tx.status === 'REFUNDED' ? 'bg-gray-500/10 text-gray-400 border border-gray-500/20' : ''}
                          ${['INITIATED', 'PENDING_FUNDING', 'DRAFT'].includes(tx.status) ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : ''}
                        `}>
                          {tx.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* ENHANCED AUDIT TRAIL MODAL */}
      {selectedTx && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* Header */}
            <div className="flex justify-between items-center border-b border-gray-800 p-6 sticky top-0 bg-gray-900 z-10">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  Dossier: <span className="font-mono text-emerald-500">{selectedTx.reference}</span>
                </h2>
                <span className={`px-2 py-1 rounded text-[10px] font-bold tracking-wider uppercase border
                  ${selectedTx.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 
                    selectedTx.status === 'DISPUTED' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 
                    selectedTx.status === 'FUNDED' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 
                    'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
                  {selectedTx.status}
                </span>
              </div>
              <button onClick={() => { setSelectedTx(null); }} className="text-gray-400 hover:text-white"><X className="w-6 h-6" /></button>
            </div>
            
            <div className="p-6 space-y-8">
              {/* Acteurs */}
              <div>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Acteurs de la transaction</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                    <p className="text-xs text-gray-500 mb-1">Vendeur (Bénéficiaire)</p>
                    <p className="font-mono text-white text-lg">{selectedTx.seller_phone || "Non défini"}</p>
                  </div>
                  <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                    <p className="text-xs text-gray-500 mb-1">Acheteur (Payeur)</p>
                    <p className="font-mono text-white text-lg">{selectedTx.buyer_phone || "Non défini"}</p>
                  </div>
                </div>
              </div>

              {/* Financials */}
              <div>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Détails Financiers & Techniques</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                    <p className="text-gray-500 mb-1 text-xs">Montant</p>
                    <p className="font-bold text-white text-lg">{selectedTx.base_amount} {selectedTx.currency}</p>
                  </div>
                  <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                    <p className="text-gray-500 mb-1 text-xs">Tentatives PIN</p>
                    <p className={`font-bold text-lg ${(selectedTx.pin_attempts || 0) >= 3 ? 'text-red-500' : 'text-white'}`}>{selectedTx.pin_attempts || 0} / 3</p>
                  </div>
                  <div className="bg-gray-950 p-4 rounded-lg border border-gray-800 col-span-2">
                    <p className="text-gray-500 mb-1 text-xs">Description du bien</p>
                    <p className="text-white italic">&quot;{selectedTx.item_description}&quot;</p>
                  </div>
                </div>
              </div>

              {/* Audit Trail Timeline */}
              <div>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Piste d&apos;Audit (Audit Trail)</h3>
                <div className="bg-gray-950 border border-gray-800 rounded-lg p-5 space-y-6 relative">
                  {/* Vertical Line */}
                  <div className="absolute left-[31px] top-8 bottom-8 w-px bg-gray-800"></div>

                  {/* Event 1 */}
                  {selectedTx.created_at && (
                    <div className="flex items-start gap-4 relative z-10">
                      <div className="w-6 h-6 rounded-full bg-blue-500/20 border border-blue-500 flex items-center justify-center shrink-0 mt-0.5">
                        <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                      </div>
                      <div>
                        <p className="text-white font-medium">Création de la transaction</p>
                        <p className="text-xs text-gray-500">{new Date(selectedTx.created_at).toLocaleString('fr-FR')}</p>
                      </div>
                    </div>
                  )}

                  {/* Event 2: PawaPay */}
                  {(selectedTx.pawapay_payout_id || selectedTx.pawapay_refund_id) && (
                    <div className="flex items-start gap-4 relative z-10">
                      <div className="w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500 flex items-center justify-center shrink-0 mt-0.5">
                        <Activity className="w-3 h-3 text-purple-400" />
                      </div>
                      <div>
                        <p className="text-white font-medium">Passerelle PawaPay (API)</p>
                        {selectedTx.pawapay_payout_id && <p className="text-xs text-gray-400 font-mono mt-1">Payout ID: {selectedTx.pawapay_payout_id}</p>}
                        {selectedTx.pawapay_refund_id && <p className="text-xs text-gray-400 font-mono mt-1">Refund ID: {selectedTx.pawapay_refund_id}</p>}
                      </div>
                    </div>
                  )}

                  {/* Event 3: Admin Notes */}
                  {selectedTx.admin_note && (
                    <div className="flex items-start gap-4 relative z-10">
                      <div className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500 flex items-center justify-center shrink-0 mt-0.5">
                        <AlertTriangle className="w-3 h-3 text-amber-500" />
                      </div>
                      <div className="w-full pr-4">
                        <p className="text-white font-medium">Intervention Administrateur</p>
                        <div className="text-sm text-amber-200 bg-amber-500/10 border border-amber-500/20 p-3 rounded mt-2 whitespace-pre-wrap w-full">
                          {selectedTx.admin_note}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Event 4: Current Status */}
                  <div className="flex items-start gap-4 relative z-10">
                    <div className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 mt-0.5
                      ${selectedTx.status === 'COMPLETED' ? 'bg-emerald-500/20 border-emerald-500' : 
                        selectedTx.status === 'DISPUTED' ? 'bg-red-500/20 border-red-500' : 'bg-gray-500/20 border-gray-500'}`}
                    >
                      <Clock className={`w-3 h-3 
                        ${selectedTx.status === 'COMPLETED' ? 'text-emerald-400' : 
                          selectedTx.status === 'DISPUTED' ? 'text-red-400' : 'text-gray-400'}`} />
                    </div>
                    <div>
                      <p className="text-white font-medium">Statut Actuel</p>
                      <p className="text-xs text-gray-500">{selectedTx.status}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions Footer */}
              <div className="flex flex-col md:flex-row gap-6 border-t border-gray-800 pt-6">
                <div className="flex-1 space-y-3">
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Sécurité Utilisateurs</h3>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => {
                        if (selectedTx.id) handleAdminAction(selectedTx.id, "BAN_USER", selectedTx.seller_phone || "");
                      }} 
                      disabled={actionLoading === selectedTx.seller_phone || !selectedTx.seller_phone} 
                      className="flex-1 bg-red-950/30 hover:bg-red-900/50 text-red-500 border border-red-900/50 py-2.5 rounded-lg text-xs font-medium flex items-center justify-center transition-colors disabled:opacity-30"
                    >
                      <Ban className="w-4 h-4 mr-2" /> Vendeur
                    </button>
                    <button 
                      onClick={() => {
                        if (selectedTx.id) handleAdminAction(selectedTx.id, "BAN_USER", selectedTx.buyer_phone || "");
                      }} 
                      disabled={actionLoading === selectedTx.buyer_phone || !selectedTx.buyer_phone} 
                      className="flex-1 bg-red-950/30 hover:bg-red-900/50 text-red-500 border border-red-900/50 py-2.5 rounded-lg text-xs font-medium flex items-center justify-center transition-colors disabled:opacity-30"
                    >
                      <Ban className="w-4 h-4 mr-2" /> Acheteur
                    </button>
                  </div>
                </div>

                {(selectedTx.status === "FUNDED" || selectedTx.status === "DISPUTED") && (
                  <div className="flex-1 space-y-3 border-t md:border-t-0 md:border-l border-gray-800 md:pl-6 pt-4 md:pt-0">
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Arbitrage Financier</h3>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          if (selectedTx.id) handleAdminAction(selectedTx.id, "FORCE_RELEASE", "");
                        }} 
                        disabled={actionLoading === selectedTx.id} 
                        className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center"
                      >
                        <CheckCircle className="w-4 h-4 mr-1.5"/> Payer Vendeur
                      </button>
                      <button 
                        onClick={() => {
                          if (selectedTx.id) handleAdminAction(selectedTx.id, "FORCE_REFUND", "");
                        }} 
                        disabled={actionLoading === selectedTx.id} 
                        className="flex-1 bg-gray-800 hover:bg-gray-700 text-white border border-gray-700 py-2.5 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center"
                      >
                        <XCircle className="w-4 h-4 mr-1.5"/> Rembourser
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}