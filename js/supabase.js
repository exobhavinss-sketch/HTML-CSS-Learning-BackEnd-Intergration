/**
 * Centralized Supabase Client for Tag Finder
 * Optimized for Vercel, local development, and custom domain hosting.
 * Uses the Supabase Publishable Key safe for public client-side browser usage.
 */
import { createClient } from '@supabase/supabase-js';

function getRuntimeConfig(key) {
  if (typeof window === 'undefined') return '';
  if (window.__ENV__ && window.__ENV__[key]) return window.__ENV__[key];
  if (window[key]) return window[key];
  if (typeof document !== 'undefined') {
    const meta = document.querySelector(`meta[name="${key.toLowerCase().replace(/_/g, '-')}"]`);
    if (meta) return meta.getAttribute('content');
  }
  return '';
}

const defaultUrl = 'https://ayoqassftnzqpomreqby.supabase.co';
const defaultPublishableKey = 'sb_publishable_wSC_vd6_ta12YGkFcR1m0A__Aa1jD_5';

const supabaseUrl =
  getRuntimeConfig('SUPABASE_URL') ||
  getRuntimeConfig('NEXT_PUBLIC_SUPABASE_URL') ||
  getRuntimeConfig('VITE_SUPABASE_URL') ||
  defaultUrl;

const supabasePublishableKey =
  getRuntimeConfig('SUPABASE_ANON_KEY') ||
  getRuntimeConfig('SUPABASE_PUBLISHABLE_KEY') ||
  getRuntimeConfig('NEXT_PUBLIC_SUPABASE_ANON_KEY') ||
  getRuntimeConfig('VITE_SUPABASE_ANON_KEY') ||
  defaultPublishableKey;

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

