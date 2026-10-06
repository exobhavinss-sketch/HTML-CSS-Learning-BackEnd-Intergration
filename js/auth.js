/**
 * Authentication Service Module
 * Handles Google OAuth, session retrieval, sign-out, and auth state subscription.
 * Prepared for future extensions (profiles, progress, bookmarks, preferences).
 */
import { supabase } from './supabase.js';

/**
 * Computes the OAuth redirect URL, taking into account the current pathname.
 * Handles GitHub Pages subdirectories (e.g., /tailwind-css-learning/) and localhost.
 * @returns {string} Fully qualified redirect URL.
 */
export function getRedirectUrl() {
  // Retains origin and pathname (e.g., https://vedikaagrwl.github.io/tailwind-css-learning/)
  return window.location.origin + window.location.pathname;
}

/**
 * Initiates Google OAuth sign-in flow through Supabase Auth.
 * @returns {Promise<{ data: any, error: any }>}
 */
export async function signInWithGoogle() {
  try {
    const redirectTo = getRedirectUrl();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo
      }
    });

    if (error) {
      console.error('[Auth] Google OAuth sign-in error:', error.message);
      return { data: null, error };
    }

    return { data, error: null };
  } catch (err) {
    console.error('[Auth] Unexpected error during Google sign-in:', err);
    return { data: null, error: err };
  }
}

/**
 * Signs out the current user session from Supabase.
 * @returns {Promise<{ error: any }>}
 */
export async function signOut() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('[Auth] Sign-out error:', error.message);
      return { error };
    }
    return { error: null };
  } catch (err) {
    console.error('[Auth] Unexpected error during sign-out:', err);
    return { error: err };
  }
}

/**
 * Retrieves the current session on application load.
 * @returns {Promise<any>} Session object or null.
 */
export async function getCurrentSession() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.error('[Auth] Error getting session:', error.message);
      return null;
    }
    return session;
  } catch (err) {
    console.error('[Auth] Unexpected error retrieving session:', err);
    return null;
  }
}

/**
 * Subscribes to Supabase authentication state changes.
 * @param {(event: string, session: any) => void} callback
 * @returns {{ subscription: { unsubscribe: () => void } }}
 */
export function subscribeToAuthChanges(callback) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return subscription;
}

/**
 * Normalizes user metadata with robust fallbacks.
 * @param {any} user Supabase User object
 * @returns {{ name: string, email: string, avatar: string | null, initials: string }}
 */
export function formatUserProfile(user) {
  if (!user) {
    return { name: '', email: '', avatar: null, initials: '' };
  }

  const meta = user.user_metadata || {};
  const email = user.email || '';

  // Name fallback order: full_name -> name -> email username -> 'User'
  let name = meta.full_name || meta.name || '';
  if (!name.trim() && email) {
    name = email.split('@')[0];
  }
  if (!name.trim()) {
    name = 'User';
  }

  // Avatar fallback: Google avatar or custom URL
  const avatar = meta.avatar_url || meta.picture || null;

  // Initials generation for fallback avatar
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('') || (email ? email[0].toUpperCase() : 'U');

  return { name, email, avatar, initials };
}
