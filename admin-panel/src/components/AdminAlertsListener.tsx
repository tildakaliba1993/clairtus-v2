"use client";

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { toast } from 'react-toastify';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

export default function AdminAlertsListener() {
  useEffect(() => {
    console.log("🛡️ Overwatch Listener is active!");

    // Load initial unread notifications on mount
    supabase
      .from('admin_alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (data) {
          window.dispatchEvent(new CustomEvent('sync-alerts', { detail: data }));
        }
      });

    const channel = supabase
      .channel('admin-overwatch')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'admin_alerts' },
        (payload) => {
          const alert = payload.new as any; 
          const alertText = `${alert.message}\nTel: +${alert.phone_number || "N/A"}`;

          // 1. Push popup toast notification
          if (alert.type.includes('SUCCESS')) {
            toast.success(alertText);
          } else if (alert.type === 'DISPUTE' || alert.type.includes('FAILED')) {
            toast.error(alertText);
          } else if (alert.type === 'HELP_NEEDED') {
            toast.warning(alertText);
          } else {
            toast.info(alertText);
          }

          // 2. Broadcast to the Notification Center dropdown UI
          window.dispatchEvent(new CustomEvent('new-alert', { detail: alert }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return null; 
}

// 🔧 CUSTOM HOOK: Use this inside your Dropdown Menu file to get real-time lists!
export function useAdminAlerts() {
  const [alerts, setAlerts] = useState<any[]>([]);

  useEffect(() => {
    const handleSync = (e: any) => setAlerts(e.detail);
    const handleNew = (e: any) => setAlerts((prev) => [e.detail, ...prev]);

    window.addEventListener('sync-alerts', handleSync);
    window.addEventListener('new-alert', handleNew);
    return () => {
      window.removeEventListener('sync-alerts', handleSync);
      window.removeEventListener('new-alert', handleNew);
    };
  }, []);

  return alerts;
}