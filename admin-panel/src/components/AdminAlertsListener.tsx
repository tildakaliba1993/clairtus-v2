"use client";

import { useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import toast, { Toaster } from 'react-hot-toast';

// This connects your frontend to your Supabase database
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

export default function AdminAlertsListener() {
  useEffect(() => {
    console.log("🛡️ Overwatch Listener is active!");

    const channel = supabase
      .channel('admin-overwatch')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'admin_alerts' },
        (payload) => {
          const alert = payload.new;
          const alertText = `${alert.message}\nTel: +${alert.phone_number || "N/A"}`;

          if (alert.type.includes('SUCCESS')) {
            toast.success(alertText, { duration: 5000, style: { background: '#10B981', color: '#fff' } });
          } else if (alert.type === 'DISPUTE' || alert.type.includes('FAILED')) {
            toast.error(alertText, { duration: 10000, style: { background: '#EF4444', color: '#fff' } });
          } else if (alert.type === 'HELP_NEEDED') {
            toast(alertText, { icon: '🙋‍♂️', duration: 8000, style: { background: '#F59E0B', color: '#fff' } });
          } else {
            toast(alertText);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return <Toaster position="top-right" />;
}