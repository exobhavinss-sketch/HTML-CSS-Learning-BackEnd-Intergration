/**
 * Authentication Service Module
 * Handles Supabase Email + Password authentication:
 * Sign Up, Sign In, Sign Out, Forgot Password, Reset Password, Session Management,
 * and Email Verification.
 */
import { supabase } from './supabase.js';

/**
 * Computes the redirect URL, preserving the current origin and pathname.
 * Handles GitHub Pages subdirectories and localhost.
 * @returns {string} Fully qualified redirect URL.
 */
export function getRedirectUrl() {
  if (typeof window === 'undefined') return '';
  return window.location.origin + window.location.pathname;
}

/**
 * Registers a new user with email, password, and full name.
 * @param {{ fullName: string, email: string, password: string }} params
 * @returns {Promise<{ data: any, error: any }>}
 */
export async function signUp({ fullName, email, password }) {
  try {
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = fullName.trim();
    const redirectTo = getRedirectUrl();

    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          full_name: cleanName
        },
        emailRedirectTo: redirectTo
      }
    });

    if (error) {
      console.error('[Auth] Sign-up error:', error.message);
      return { data: null, error };
    }

    return { data, error: null };
  } catch (err) {
    console.error('[Auth] Unexpected error during sign-up:', err);
    return { data: null, error: err };
  }
}

/**
 * Signs in an existing user with email and password.
 * @param {{ email: string, password: string }} params
 * @returns {Promise<{ data: any, error: any }>}
 */
export async function signIn({ email, password }) {
  try {
    const cleanEmail = email.trim().toLowerCase();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password
    });

    if (error) {
      console.error('[Auth] Sign-in error:', error.message);
      return { data: null, error };
    }

    return { data, error: null };
  } catch (err) {
    console.error('[Auth] Unexpected error during sign-in:', err);
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
 * Sends a password reset instructions email.
 * @param {string} email
 * @returns {Promise<{ data: any, error: any }>}
 */
export async function forgotPassword(email) {
  try {
    const cleanEmail = email.trim().toLowerCase();
    const redirectTo = getRedirectUrl();

    const { data, error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo
    });

    if (error) {
      console.error('[Auth] Reset password request error:', error.message);
      return { data: null, error };
    }

    return { data, error: null };
  } catch (err) {
    console.error('[Auth] Unexpected error during password reset request:', err);
    return { data: null, error: err };
  }
}

/**
 * Updates the current user's password (used during password recovery flow).
 * @param {string} newPassword
 * @returns {Promise<{ data: any, error: any }>}
 */
export async function resetPassword(newPassword) {
  try {
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) {
      console.error('[Auth] Password update error:', error.message);
      return { data: null, error };
    }

    return { data, error: null };
  } catch (err) {
    console.error('[Auth] Unexpected error during password update:', err);
    return { data: null, error: err };
  }
}

/**
 * Resends the confirmation email for unverified signups.
 * @param {string} email
 * @returns {Promise<{ data: any, error: any }>}
 */
export async function resendVerificationEmail(email) {
  try {
    const cleanEmail = email.trim().toLowerCase();
    const redirectTo = getRedirectUrl();

    const { data, error } = await supabase.auth.resend({
      type: 'signup',
      email: cleanEmail,
      options: {
        emailRedirectTo: redirectTo
      }
    });

    if (error) {
      console.error('[Auth] Resend verification error:', error.message);
      return { data: null, error };
    }

    return { data, error: null };
  } catch (err) {
    console.error('[Auth] Unexpected error resending verification email:', err);
    return { data: null, error: err };
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

  // Name fallback order: full_name -> name -> email prefix -> 'User'
  let name = meta.full_name || meta.name || '';
  if (!name.trim() && email) {
    name = email.split('@')[0];
  }
  if (!name.trim()) {
    name = 'User';
  }

  const avatar = meta.avatar_url || meta.picture || null;

  // Initials generation for fallback avatar badge
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('') || (email ? email[0].toUpperCase() : 'U');

  return { name, email, avatar, initials };
}

/**
 * Translates raw Supabase authentication errors into clear, friendly messages.
 * Never exposes raw technical stack traces to users.
 * @param {any} error
 * @returns {string}
 */
export function getFriendlyErrorMessage(error) {
  if (!error) return '';
  const msg = (error.message || String(error)).toLowerCase();

  if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
    return 'Invalid email or password.';
  }
  if (msg.includes('user already registered') || msg.includes('email already in use') || msg.includes('already registered')) {
    return 'Unable to create the account. Please try signing in or use another email.';
  }
  if (msg.includes('password should be at least') || msg.includes('weak password')) {
    return 'Your password does not meet the required security rules. Minimum 8 characters required.';
  }
  if (msg.includes('email not confirmed')) {
    return 'Please check your email and verify your account before signing in.';
  }
  if (msg.includes('rate limit') || msg.includes('over_email_send_rate_limit') || msg.includes('too many requests')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (msg.includes('network') || msg.includes('failed to fetch') || msg.includes('timeout')) {
    return 'Unable to connect. Please check your internet connection and try again.';
  }
  if (msg.includes('flow state not found') || msg.includes('otp expired') || msg.includes('invalid token')) {
    return 'The link has expired or is invalid. Please request a new link.';
  }

  return 'An unexpected error occurred. Please check your details and try again.';
}
