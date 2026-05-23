import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize a Supabase client with the Service Role Key to bypass RLS.
// This key must NEVER be exposed to the client-side (no NEXT_PUBLIC_ prefix).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export async function GET(request: Request) {
  // 1. Authentication Check
  // We expect the frontend to send the user's JWT token in the Authorization header.
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
  }
  
  const token = authHeader.split(' ')[1];

  // We use a temporary standard client just to verify the user's token validity.
  const authClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);

  if (authError || !user) {
    console.error('Invalid token:', authError);
    return NextResponse.json({ error: 'Unauthorized user' }, { status: 401 });
  }

  // NOTE: If you have a specific role or 'is_admin' flag in your users table, 
  // you should check it here before proceeding to ensure ONLY admins can fetch this data.
  // Example: if (!user.app_metadata?.claims?.admin) return 403 Forbidden.

  // 2. Fetch Data bypassing RLS
  if (!supabaseServiceKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not defined in environment variables.');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const [txResponse, usersResponse] = await Promise.all([
      adminSupabase.from('transactions').select('*').order('created_at', { ascending: false }).limit(1000),
      adminSupabase.from('users').select('*')
    ]);

    if (txResponse.error) throw txResponse.error;
    if (usersResponse.error) throw usersResponse.error;

    return NextResponse.json({
      transactions: txResponse.data,
      users: usersResponse.data
    });
  } catch (error: any) {
    console.error('Error fetching dashboard data:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch data' }, { status: 500 });
  }
}
