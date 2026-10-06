/**
 * Centralized Supabase Client for Tailwind Lab
 * Uses the Supabase Publishable Key safe for public client-side browser usage.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ayoqassftnzqpmreqby.supabase.co';
const supabasePublishableKey = 'sb_publishable_wSC_vd6_ta12YGkFcR1m0A__Aa1jD_5';

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
