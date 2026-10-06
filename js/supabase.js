/**
 * Centralized Supabase Client for Tag Finder
 * Uses the Supabase Publishable Key safe for public client-side browser usage.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ayoqassftnzqpomreqby.supabase.co';
const supabasePublishableKey = 'sb_publishable_wSC_vd6_ta12YGkFcR1m0A__Aa1jD_5';

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

