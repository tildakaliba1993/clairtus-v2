// @ts-nocheck
"use client";

import { useState, useEffect, useMemo } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { Lock, ShieldAlert, CheckCircle, XCircle, AlertTriangle, RefreshCw, LogOut, ShieldCheck, UserX, Search, Filter, DollarSign, Activity, AlertOctagon, X, Ban, Clock, Bell, ChevronLeft, ChevronRight, ArrowUpDown, Code, SplitSquareHorizontal } from "lucide-react";
import { toast } from "react-toastify";

export default function AdminPortal() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  const [transactions, setTransactions] = useState([]);
  const [userMap, setUserMap] = useState({});
  const [actionLoading, setActionLoading] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false); // 🚀 Added for manual refresh UX

  // 🚀 FILTERS & SORTING
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [sortOrder, setSortOrder] = useState("NEWEST"); 
  
  // 🚀 PAGINATION
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [selectedTx, setSelectedTx] = useState(null);
  const [showRawData, setShowRawData] = useState(false); // 🚀 Added for God View Dev Mode
  const [alerts, setAlerts] = useState([]);
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchDashboardData(true);
        fetchAlerts();
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        fetchDashboardData(true);
        fetchAlerts();
      }
    });

    // 📡 SILENT AUTO-REFRESH (Every 2 minutes)
    const interval = setInterval(() => {
      if (session) {
        fetchDashboardData(true);
      }
    }, 120000);

    // 📡 SUPABASE REALTIME SUBSCRIPTION FOR ALERTS
    const channel = supabase
      .channel('admin-alerts-channel')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'admin_alerts' },
        (payload) => {
          const newAlert = payload.new;
          setAlerts(prev => [newAlert, ...prev]);

          const toastMsg = `${newAlert.type}: ${newAlert.message}`;
          if (newAlert.type === "SUCCESS_DEPOSIT" || newAlert.type === "SUCCESS_PAYOUT") {
            toast.success(toastMsg, { icon: "💰" });
          } else if (newAlert.type === "HELP_NEEDED") {
            toast.info(toastMsg, { icon: "🙋‍♂️" });
          } else if (newAlert.type === "DISPUTE" || newAlert.type === "PAYOUT_FAILED") {
            toast.error(toastMsg, { icon: "🚨" });
          } else {
            toast(toastMsg);
          }

          fetchDashboardData(true); // Silent refresh on new alert
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [session]);

  const fetchAlerts = async () => {
    try {
      const { data, error } = await supabase
        .from('admin_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
        
      if (data) setAlerts(data);
    } catch (err) {
      console.error("Failed to fetch alerts", err);
    }
  };

  const markAlertAsRead = async (alertId) => {
    try {
      await supabase.from('admin_alerts').update({ is_read: true }).eq('id', alertId);
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, is_read: true } : a));
    } catch (err) {
      console.error(err);
    }
  };

  const fetchDashboardData = async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const { data: { session: activeSession } } = await supabase.auth.getSession();
      if (!activeSession) return;

      const response = await fetch('/api/admin/dashboard', {
        headers: {
          'Authorization': `Bearer ${activeSession.access_token}`
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
      
      // Update selectedTx silently if it's currently open to keep modal live
      if (selectedTx && txData) {
        const updatedTx = txData.find(t => t.id === selectedTx.id);
        if (updatedTx) setSelectedTx(updatedTx);
      }

    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      if (!silent) setIsRefreshing(false);
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
      
      toast.success(result.message);
      fetchDashboardData(true); 
      if (selectedTx && action !== "BAN_USER") setSelectedTx(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const metrics = useMemo(() => {
    const float = transactions.filter(t => t.status === 'FUNDED').reduce((acc, t) => acc + (Number(t.base_amount) || 0), 0);
    const revenue = transactions.filter(t => t.status === 'COMPLETED').reduce((acc, t) => {
      const feeMultiplier = (t.applied_fee_percentage ?? 2.5) / 100;
      const totalFee = Math.round((Number(t.base_amount) || 0) * feeMultiplier);
      return acc + totalFee;
    }, 0);
    const disputes = transactions.filter(t => t.status === 'DISPUTED').length;
    return { float, revenue, disputes };
  }, [transactions]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, sortOrder]);

  const sortedAndFilteredTxs = useMemo(() => {
    let filtered = transactions.filter(t => {
      const matchesSearch = (t.reference?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                             t.seller_phone?.includes(searchTerm) || 
                             t.buyer_phone?.includes(searchTerm));
      const matchesStatus = statusFilter === "ALL" || t.status === statusFilter;
      return matchesSearch && matchesStatus;
    });

    filtered.sort((a, b) => {
      if (sortOrder === "NEWEST") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      } else if (sortOrder === "OLDEST") {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      } else if (sortOrder === "HIGHEST") {
        return (Number(b.base_amount) || 0) - (Number(a.base_amount) || 0);
      }
      return 0;
    });

    return filtered;
  }, [transactions, searchTerm, statusFilter, sortOrder]);

  const totalPages = Math.ceil(sortedAndFilteredTxs.length / itemsPerPage);
  const currentItems = sortedAndFilteredTxs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

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

  // 🚀 HELPER FOR GOD VIEW ECONOMICS
  const calculateEconomics = (tx) => {
    const gross = Number(tx.base_amount) || 0;
    const feePct = tx.applied_fee_percentage ?? 2.5;
    const totalFee = Math.round(gross * (feePct / 100));
    const secondaryAmount = Number(tx.secondary_vendor_amount) || 0;
    const primaryNet = gross - totalFee - secondaryAmount;
    return { gross, feePct, totalFee, secondaryAmount, primaryNet };
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">Chargement...</div>;

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#020617] p-4">
        <div className="max-w-md w-full bg-[#0b141a] rounded-xl shadow-2xl border border-white/10 p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="mb-4">
              <Image src="/logo-clairtus.svg" alt="Clairtus" width={180} height={45} priority className="h-[45px] w-auto" />
            </div>
            <p className="text-gray-400 text-sm mt-2">Accès restreint à l&apos;administration</p>
          </div>
          {error && <div className="bg-red-500/10 border border-red-500/50 text-red-500 p-3 rounded-lg text-sm mb-6 text-center">{error}</div>}
          <form onSubmit={handleLogin} className="space-y-6">
            <div><input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-[#202c33] border border-white/10 rounded-lg px-4 py-3 text-white focus:border-emerald-500 outline-none transition-colors" required /></div>
            <div><input type="password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-[#202c33] border border-white/10 rounded-lg px-4 py-3 text-white focus:border-emerald-500 outline-none transition-colors" required /></div>
            <button type="submit" disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-lg transition-colors"><Lock className="w-5 h-5 inline mr-2" /> Déverrouiller</button>
          </form>
        </div>
      </div>
    );
  }

  const unreadAlertsCount = alerts.filter(a => !a.is_read).length;

  return (
    <div className="min-h-screen bg-[#020617] text-gray-200 font-sans pb-10">
      <header className="bg-[#0b141a] border-b border-white/10 px-8 py-4 flex justify-between items-center sticky top-0 z-10 shadow-md">
        <div className="flex items-center">
          <Image src="/logo-clairtus.svg" alt="Clairtus Command" width={140} height={35} className="h-[35px] w-auto" />
          <span className="ml-3 px-2 py-0.5 bg-red-500/10 text-red-500 text-[10px] font-bold rounded uppercase tracking-widest border border-red-500/20">Command</span>
        </div>
        <div className="flex items-center space-x-4">
          
          <div className="relative">
            <button 
              onClick={() => setIsAlertsOpen(!isAlertsOpen)} 
              className="relative p-2 text-gray-400 hover:text-white bg-[#202c33] hover:bg-[#2a3942] rounded-full transition-colors border border-white/5"
            >
              <Bell className="w-5 h-5" />
              {unreadAlertsCount > 0 && (
                <span className="absolute top-0 right-0 -mt-1 -mr-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-lg">
                  {unreadAlertsCount}
                </span>
              )}
            </button>

            {isAlertsOpen && (
              <div className="absolute right-0 mt-3 w-80 bg-[#0b141a] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
                <div className="bg-[#202c33] border-b border-white/10 p-3 flex justify-between items-center">
                  <h3 className="font-bold text-sm text-white">Notifications</h3>
                  <button onClick={() => setIsAlertsOpen(false)} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                  {alerts.length === 0 ? (
                    <div className="p-6 text-center text-gray-500 text-sm">Aucune notification</div>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {alerts.map((alert) => (
                        <div 
                          key={alert.id} 
                          onClick={() => { if (!alert.is_read) markAlertAsRead(alert.id); }}
                          className={`p-4 cursor-pointer transition-colors ${alert.is_read ? 'bg-[#0b141a] opacity-70' : 'bg-[#202c33]/50 hover:bg-[#202c33]'}`}
                        >
                          <div className="flex items-start gap-3">
                            <span className="text-xl">
                              {alert.type.includes("SUCCESS") ? "💰" : alert.type === "HELP_NEEDED" ? "🙋‍♂️" : "🚨"}
                            </span>
                            <div>
                              <p className={`text-sm ${alert.is_read ? 'text-gray-400' : 'text-white font-medium'}`}>{alert.message}</p>
                              <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500 font-mono">
                                <span>{new Date(alert.created_at).toLocaleTimeString('fr-FR')}</span>
                                {alert.phone_number && <span>+{alert.phone_number}</span>}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <button onClick={() => { supabase.auth.signOut(); }} className="flex items-center text-sm bg-[#202c33] hover:bg-[#2a3942] border border-white/5 px-4 py-2 rounded-lg transition-colors"><LogOut className="w-4 h-4 mr-2" /> Déconnexion</button>
        </div>
      </header>

      <main className="p-8 max-w-7xl mx-auto space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-[#0b141a] border border-white/10 p-6 rounded-xl flex items-center justify-between">
            <div><p className="text-sm text-gray-400">Fonds en Séquestre (Float)</p><p className="text-2xl font-bold text-blue-400">${metrics.float.toFixed(2)}</p></div>
            <div className="bg-blue-500/10 p-3 rounded-lg"><DollarSign className="w-6 h-6 text-blue-500" /></div>
          </div>
          <div className="bg-[#0b141a] border border-white/10 p-6 rounded-xl flex items-center justify-between">
            <div><p className="text-sm text-gray-400">Revenus Générés (2.5%)</p><p className="text-2xl font-bold text-emerald-400">${metrics.revenue.toFixed(2)}</p></div>
            <div className="bg-emerald-500/10 p-3 rounded-lg"><Activity className="w-6 h-6 text-emerald-500" /></div>
          </div>
          <div className="bg-[#0b141a] border border-white/10 p-6 rounded-xl flex items-center justify-between">
            <div><p className="text-sm text-gray-400">Litiges Actifs</p><p className="text-2xl font-bold text-red-500">{metrics.disputes}</p></div>
            <div className="bg-red-500/10 p-3 rounded-lg"><AlertOctagon className="w-6 h-6 text-red-500" /></div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row justify-between items-center bg-[#0b141a] border border-white/10 p-4 rounded-xl gap-4">
          <div className="flex flex-col md:flex-row w-full lg:w-3/4 gap-4">
            <div className="relative w-full md:w-1/3">
              <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-500" />
              <input type="text" placeholder="Rechercher ID ou Téléphone..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-[#202c33] border border-white/5 rounded-lg pl-10 pr-4 py-2 text-white focus:border-emerald-500 outline-none" />
            </div>
            
            <div className="relative w-full md:w-48">
              <Filter className="absolute left-3 top-2.5 w-5 h-5 text-gray-500" />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full bg-[#202c33] border border-white/5 rounded-lg pl-10 pr-4 py-2 text-white appearance-none focus:border-emerald-500 outline-none cursor-pointer">
                <option value="ALL">Tous les statuts</option>
                <option value="DRAFT">📝 Brouillon</option>
                <option value="INITIATED">⏳ Initié</option>
                <option value="PENDING_FUNDING">⌛ Attente Paiement</option>
                <option value="FUNDED">🔒 Financé</option>
                <option value="PROCESSING_PAYOUTS">🔄 Envoi en cours</option>
                <option value="COMPLETED">✅ Complété</option>
                <option value="DISPUTED">⚠️ Litige</option>
                <option value="REFUNDED">💸 Remboursé</option>
                <option value="CANCELLED">🚫 Annulé</option>
              </select>
            </div>

            <div className="relative w-full md:w-48">
              <ArrowUpDown className="absolute left-3 top-2.5 w-5 h-5 text-gray-500" />
              <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="w-full bg-[#202c33] border border-white/5 rounded-lg pl-10 pr-4 py-2 text-white appearance-none focus:border-emerald-500 outline-none cursor-pointer">
                <option value="NEWEST">Plus récents</option>
                <option value="OLDEST">Plus anciens</option>
                <option value="HIGHEST">Montant décroissant</option>
              </select>
            </div>

          </div>
          
          <button 
            onClick={() => fetchDashboardData(false)} 
            disabled={isRefreshing}
            className="flex items-center w-full lg:w-auto justify-center text-sm bg-[#202c33] hover:bg-[#2a3942] border border-white/5 px-4 py-2 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin text-emerald-500' : ''}`} /> 
            {isRefreshing ? 'Actualisation...' : 'Actualiser'}
          </button>
        </div>

        <div className="bg-[#0b141a] border border-white/10 rounded-xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto min-h-[400px]">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#202c33]/50 border-b border-white/5 text-gray-400">
                <tr>
                  <th className="px-6 py-4 font-medium">Référence</th>
                  <th className="px-6 py-4 font-medium">Vendeur</th>
                  <th className="px-6 py-4 font-medium">Acheteur</th>
                  <th className="px-6 py-4 font-medium">Montant</th>
                  <th className="px-6 py-4 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {currentItems.length === 0 ? (
                  <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-500">Aucun résultat trouvé.</td></tr>
                ) : (
                  currentItems.map((tx) => (
                    <tr key={tx.id} onClick={() => { setSelectedTx(tx); setShowRawData(false); }} className="hover:bg-[#202c33] transition-colors cursor-pointer group">
                      <td className="px-6 py-4 font-mono text-emerald-400 group-hover:underline">{tx.reference}</td>
                      <td className="px-6 py-4">{renderUserCell(tx.seller_phone)}</td>
                      <td className="px-6 py-4">{renderUserCell(tx.buyer_phone)}</td>
                      <td className="px-6 py-4 font-semibold text-white">{tx.base_amount ? `${tx.base_amount} ${tx.currency}` : "-"}</td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-[10px] uppercase font-bold tracking-wider flex w-fit items-center gap-1 border
                          ${tx.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : ''}
                          ${tx.status === 'FUNDED' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : ''}
                          ${tx.status === 'DISPUTED' ? 'bg-red-500/10 text-red-500 border-red-500/20' : ''}
                          ${tx.status === 'CANCELLED' || tx.status === 'REFUNDED' ? 'bg-gray-500/10 text-gray-400 border-white/10' : ''}
                          ${['INITIATED', 'PENDING_FUNDING', 'DRAFT', 'PROCESSING_PAYOUTS'].includes(tx.status) ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' : ''}
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
          
          {/* 🚀 PAGINATION FOOTER */}
          {totalPages > 1 && (
            <div className="bg-[#0b141a] border-t border-white/5 px-6 py-4 flex items-center justify-between">
              <span className="text-sm text-gray-400">
                Page {currentPage} sur {totalPages}
              </span>
              <div className="flex gap-2">
                <button 
                  onClick={(e) => { e.stopPropagation(); setCurrentPage(prev => Math.max(1, prev - 1)); }}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg bg-[#202c33] border border-white/5 text-gray-300 hover:bg-[#2a3942] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); setCurrentPage(prev => Math.min(totalPages, prev + 1)); }}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-lg bg-[#202c33] border border-white/5 text-gray-300 hover:bg-[#2a3942] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 🚀 GOD VIEW MODAL */}
      {selectedTx && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0b141a] border border-white/10 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">
            
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b border-white/5 p-6 sticky top-0 bg-[#0b141a]/95 backdrop-blur z-20">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  Dossier: <span className="font-mono text-emerald-500">{selectedTx.reference}</span>
                </h2>
                <span className={`px-2 py-1 rounded text-[10px] font-bold tracking-wider uppercase border
                  ${selectedTx.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 
                    selectedTx.status === 'DISPUTED' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 
                    selectedTx.status === 'FUNDED' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 
                    'bg-gray-500/10 text-gray-400 border-white/10'}`}>
                  {selectedTx.status}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowRawData(!showRawData)} className={`p-2 rounded-lg border transition-colors ${showRawData ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/50' : 'bg-[#202c33] text-gray-400 border-white/5 hover:text-white hover:bg-[#2a3942]'}`} title="Mode Développeur">
                  <Code className="w-5 h-5" />
                </button>
                <button onClick={() => { setSelectedTx(null); setShowRawData(false); }} className="p-2 text-gray-400 hover:text-white bg-[#202c33] hover:bg-[#2a3942] rounded-lg transition-colors border border-white/5"><X className="w-5 h-5" /></button>
              </div>
            </div>
            
            <div className="p-6 space-y-8 overflow-y-auto">
              
              {/* RAW DATA TOGGLE (DEV MODE) */}
              {showRawData && (
                <div className="bg-[#202c33] rounded-lg border border-emerald-500/30 p-4">
                  <h3 className="text-xs font-bold text-emerald-500 uppercase tracking-wider mb-2">Données Brutes (JSON)</h3>
                  <pre className="text-[10px] text-emerald-300/80 font-mono overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(selectedTx, null, 2)}
                  </pre>
                </div>
              )}

              {/* 1. ACTEURS DE LA TRANSACTION */}
              <div>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">1. Profils Utilisateurs</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="bg-[#202c33] p-4 rounded-lg border border-white/5 flex flex-col justify-between">
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Vendeur Principal (Bénéficiaire)</p>
                      <p className="font-mono text-white text-lg">{selectedTx.seller_phone || "Non défini"}</p>
                    </div>
                    {userMap[selectedTx.seller_phone] && (
                      <div className="mt-3 pt-3 border-t border-white/5 flex justify-between items-center text-xs">
                        <span className="text-gray-400">{userMap[selectedTx.seller_phone].kyc_level}</span>
                        <span className="font-bold text-emerald-400">Score: {userMap[selectedTx.seller_phone].trust_score}</span>
                      </div>
                    )}
                  </div>
                  
                  <div className="bg-[#202c33] p-4 rounded-lg border border-white/5 flex flex-col justify-between">
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Acheteur (Payeur)</p>
                      <p className="font-mono text-white text-lg">{selectedTx.buyer_phone || "Non défini"}</p>
                    </div>
                    {userMap[selectedTx.buyer_phone] && (
                      <div className="mt-3 pt-3 border-t border-white/5 flex justify-between items-center text-xs">
                        <span className="text-gray-400">{userMap[selectedTx.buyer_phone].kyc_level}</span>
                        <span className="font-bold text-emerald-400">Score: {userMap[selectedTx.buyer_phone].trust_score}</span>
                      </div>
                    )}
                  </div>

                  {selectedTx.secondary_vendor_phone && (
                    <div className="bg-[#202c33] p-4 rounded-lg border border-blue-500/20 bg-gradient-to-br from-[#202c33] to-blue-900/10 flex flex-col justify-between">
                      <div>
                        <div className="flex justify-between items-start">
                          <p className="text-xs text-blue-400 mb-1 font-semibold">Vendeur Secondaire (Split)</p>
                          <SplitSquareHorizontal className="w-4 h-4 text-blue-500" />
                        </div>
                        <p className="font-mono text-white text-lg">{selectedTx.secondary_vendor_phone}</p>
                      </div>
                      {userMap[selectedTx.secondary_vendor_phone] && (
                         <div className="mt-3 pt-3 border-t border-white/5 flex justify-between items-center text-xs">
                          <span className="text-gray-400">{userMap[selectedTx.secondary_vendor_phone].kyc_level}</span>
                          <span className="font-bold text-emerald-400">Score: {userMap[selectedTx.secondary_vendor_phone].trust_score}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* 2. ECONOMICS & FINANCIALS */}
              {(() => {
                const eco = calculateEconomics(selectedTx);
                return (
                  <div>
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">2. Structure Financière</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
                      <div className="bg-[#202c33] p-4 rounded-lg border border-white/5 col-span-2">
                        <p className="text-gray-400 mb-1 text-xs">Description du bien / Service</p>
                        <p className="text-white font-medium">&quot;{selectedTx.item_description}&quot;</p>
                      </div>
                      <div className="bg-[#202c33] p-4 rounded-lg border border-white/5">
                        <p className="text-gray-400 mb-1 text-xs">Devise</p>
                        <p className="font-bold text-white text-lg">{selectedTx.currency || "N/A"}</p>
                      </div>
                      <div className="bg-[#202c33] p-4 rounded-lg border border-white/5">
                        <p className="text-gray-400 mb-1 text-xs">Code PIN Sécurité</p>
                        <div className="flex items-center justify-between">
                          <p className="font-mono font-bold text-white text-lg tracking-widest">{selectedTx.pin_code || "****"}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${(selectedTx.pin_attempts || 0) >= 3 ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-gray-400'}`}>Essais: {selectedTx.pin_attempts || 0}</span>
                        </div>
                      </div>
                    </div>

                    {/* Breakdown Visualizer */}
                    <div className="bg-[#202c33] rounded-lg border border-white/5 overflow-hidden">
                      <div className="p-4 bg-white/5 flex justify-between items-center border-b border-white/5">
                        <span className="text-sm font-semibold text-white">Montant Brut (Payé par l'Acheteur)</span>
                        <span className="text-lg font-bold text-white">{eco.gross} {selectedTx.currency}</span>
                      </div>
                      <div className="p-4 grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/5">
                        <div className="p-4 flex flex-col justify-center">
                          <span className="text-xs text-emerald-400 mb-1">Revenus Clairtus ({eco.feePct}%)</span>
                          <span className="text-xl font-mono text-emerald-500">+{eco.totalFee} {selectedTx.currency}</span>
                        </div>
                        {selectedTx.secondary_vendor_phone ? (
                           <>
                             <div className="p-4 flex flex-col justify-center">
                              <span className="text-xs text-blue-400 mb-1">Split (Vendeur Secondaire)</span>
                              <span className="text-xl font-mono text-blue-400">{eco.secondaryAmount} {selectedTx.currency}</span>
                             </div>
                             <div className="p-4 flex flex-col justify-center bg-white/5">
                              <span className="text-xs text-gray-400 mb-1">Net (Vendeur Principal)</span>
                              <span className="text-xl font-mono font-bold text-white">{eco.primaryNet} {selectedTx.currency}</span>
                             </div>
                           </>
                        ) : (
                          <div className="p-4 flex flex-col justify-center col-span-2 bg-white/5">
                            <span className="text-xs text-gray-400 mb-1">Montant Net (Versé au Vendeur)</span>
                            <span className="text-xl font-mono font-bold text-white">{eco.primaryNet} {selectedTx.currency}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 3. TECHNICAL GATEWAYS (PAWAPAY) */}
              <div>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">3. Passerelles Techniques & API (PawaPay)</h3>
                <div className="bg-[#202c33] rounded-lg border border-white/5 overflow-hidden text-sm">
                  <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/5">
                    
                    {/* Inbound */}
                    <div className="p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                        <h4 className="font-semibold text-white">Flux Entrant (Deposit)</h4>
                      </div>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center border-b border-white/5 pb-2">
                          <span className="text-gray-500 text-xs">Tentatives de Paiement</span>
                          <span className={`font-mono text-xs ${(selectedTx.payment_attempts || 0) >= 3 ? 'text-red-400' : 'text-gray-300'}`}>{selectedTx.payment_attempts || 0} / 3</span>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs block mb-1">Deposit ID</span>
                          <span className="font-mono text-xs text-gray-300 break-all">{selectedTx.pawapay_deposit_id || "En attente"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Outbound */}
                    <div className="p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                        <h4 className="font-semibold text-white">Flux Sortant (Payout / Refund)</h4>
                      </div>
                      <div className="space-y-4">
                         {selectedTx.pawapay_refund_id && (
                           <div>
                            <span className="text-gray-500 text-xs block mb-1 flex justify-between">Refund ID <span className="text-amber-500">Remboursé</span></span>
                            <span className="font-mono text-xs text-gray-300 break-all">{selectedTx.pawapay_refund_id}</span>
                           </div>
                         )}
                         {selectedTx.pawapay_payout_id && (
                           <div>
                            <span className="text-gray-500 text-xs block mb-1 flex justify-between">Primary Payout ID <span className={selectedTx.primary_payout_status === 'FAILED' ? 'text-red-500' : 'text-emerald-500'}>{selectedTx.primary_payout_status || 'PROCESSED'}</span></span>
                            <span className="font-mono text-xs text-gray-300 break-all">{selectedTx.pawapay_payout_id}</span>
                           </div>
                         )}
                         {selectedTx.secondary_payout_id && (
                           <div className="pt-2 border-t border-white/5">
                            <span className="text-gray-500 text-xs block mb-1 flex justify-between">Secondary Payout ID <span className={selectedTx.secondary_payout_status === 'FAILED' ? 'text-red-500' : 'text-emerald-500'}>{selectedTx.secondary_payout_status || 'PROCESSED'}</span></span>
                            <span className="font-mono text-xs text-gray-300 break-all">{selectedTx.secondary_payout_id}</span>
                           </div>
                         )}
                         {!selectedTx.pawapay_refund_id && !selectedTx.pawapay_payout_id && (
                           <p className="text-xs text-gray-500 italic">Aucun flux sortant initié.</p>
                         )}
                      </div>
                    </div>

                  </div>
                </div>
              </div>

              {/* 4. AUDIT TRAIL TIMELINE */}
              <div>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">4. Historique d'Événements</h3>
                <div className="bg-[#202c33] border border-white/5 rounded-lg p-5 space-y-6 relative">
                  <div className="absolute left-[31px] top-8 bottom-8 w-px bg-white/10"></div>

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

                  <div className="flex items-start gap-4 relative z-10">
                    <div className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 mt-0.5
                      ${selectedTx.status === 'COMPLETED' ? 'bg-emerald-500/20 border-emerald-500' : 
                        selectedTx.status === 'DISPUTED' ? 'bg-red-500/20 border-red-500' : 'bg-white/10 border-white/20'}`}
                    >
                      <Clock className={`w-3 h-3 
                        ${selectedTx.status === 'COMPLETED' ? 'text-emerald-400' : 
                          selectedTx.status === 'DISPUTED' ? 'text-red-400' : 'text-gray-400'}`} />
                    </div>
                    <div>
                      <p className="text-white font-medium">Dernière mise à jour ({selectedTx.status})</p>
                      <p className="text-xs text-gray-500">{selectedTx.updated_at ? new Date(selectedTx.updated_at).toLocaleString('fr-FR') : "N/A"}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 5. ACTIONS FOOTER */}
              <div className="flex flex-col md:flex-row gap-6 border-t border-white/10 pt-6">
                <div className="flex-1 space-y-3">
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Sécurité Utilisateurs</h3>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => {
                        if (selectedTx.id) handleAdminAction(selectedTx.id, "BAN_USER", selectedTx.seller_phone || "");
                      }} 
                      disabled={actionLoading === selectedTx.seller_phone || !selectedTx.seller_phone} 
                      className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 py-2.5 rounded-lg text-xs font-medium flex items-center justify-center transition-colors disabled:opacity-30"
                    >
                      <Ban className="w-4 h-4 mr-2" /> Vendeur
                    </button>
                    <button 
                      onClick={() => {
                        if (selectedTx.id) handleAdminAction(selectedTx.id, "BAN_USER", selectedTx.buyer_phone || "");
                      }} 
                      disabled={actionLoading === selectedTx.buyer_phone || !selectedTx.buyer_phone} 
                      className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 py-2.5 rounded-lg text-xs font-medium flex items-center justify-center transition-colors disabled:opacity-30"
                    >
                      <Ban className="w-4 h-4 mr-2" /> Acheteur
                    </button>
                  </div>
                </div>

                {(selectedTx.status === "FUNDED" || selectedTx.status === "DISPUTED") && (
                  <div className="flex-1 space-y-3 border-t md:border-t-0 md:border-l border-white/10 md:pl-6 pt-4 md:pt-0">
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Arbitrage Financier Force</h3>
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
                        className="flex-1 bg-[#202c33] hover:bg-[#2a3942] text-white border border-white/10 py-2.5 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center"
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