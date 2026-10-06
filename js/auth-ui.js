/**
 * Authentication UI Controller
 * Manages the Sign In button, Sign In Modal, User Profile dropdown, and Auth state.
 */
import {
  signInWithGoogle,
  signOut,
  getCurrentSession,
  subscribeToAuthChanges,
  formatUserProfile
} from './auth.js';

// SVG Icons
const GOOGLE_ICON_SVG = `
<svg class="auth-google-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
</svg>`;

const CHEVRON_DOWN_SVG = `
<svg class="auth-chevron" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
  <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
</svg>`;

const LOGOUT_ICON_SVG = `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
  <polyline points="16 17 21 12 16 7"/>
  <line x1="21" y1="12" x2="9" y2="12"/>
</svg>`;

const CLOSE_ICON_SVG = `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
</svg>`;

const USER_ICON_SVG = `
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
  <circle cx="12" cy="7" r="4"/>
</svg>`;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

class AuthUI {
  constructor() {
    this.root = null;
    this.currentUser = null;
    this.isDropdownOpen = false;
    this.isModalOpen = false;
    this.isSigningIn = false;
    this.isLoggingOut = false;
    this.errorMessage = null;

    this.handleOutsideClick = this.handleOutsideClick.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  /**
   * Initializes the authentication UI within the DOM.
   * @param {string} rootSelector
   */
  async init(rootSelector = '#auth-root') {
    this.root = document.querySelector(rootSelector);
    if (!this.root) {
      console.warn(`[AuthUI] Root element "${rootSelector}" not found in DOM.`);
      return;
    }

    // Step 13: Initial loading state to prevent UI flicker
    this.renderLoading();

    // Attach global event listeners
    document.addEventListener('click', this.handleOutsideClick);
    document.addEventListener('keydown', this.handleKeyDown);

    // Subscribe to auth changes
    subscribeToAuthChanges((event, session) => {
      this.currentUser = session?.user || null;
      this.isSigningIn = false;
      this.isLoggingOut = false;
      this.render();
    });

    // Check initial session
    const session = await getCurrentSession();
    this.currentUser = session?.user || null;
    this.render();
  }

  renderLoading() {
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="auth-loading-state" aria-live="polite" aria-busy="true">
        <span class="auth-spinner-sm" aria-hidden="true"></span>
        <span>Loading...</span>
      </div>
    `;
  }

  render() {
    if (!this.root) return;

    if (this.currentUser) {
      this.renderLoggedIn();
    } else {
      this.renderLoggedOut();
    }
  }

  renderLoggedOut() {
    this.root.innerHTML = `
      <button type="button" class="auth-btn-signin" id="auth-signin-btn" aria-haspopup="dialog">
        ${USER_ICON_SVG}
        <span>Sign In</span>
      </button>
    `;

    const btn = this.root.querySelector('#auth-signin-btn');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openModal();
      });
    }
  }

  renderLoggedIn() {
    const profile = formatUserProfile(this.currentUser);
    const escapedName = escapeHtml(profile.name);
    const escapedEmail = escapeHtml(profile.email);

    // Mini avatar markup
    const avatarMiniHtml = profile.avatar
      ? `<img src="${escapeHtml(profile.avatar)}" alt="${escapedName}" class="auth-avatar-mini" referrerpolicy="no-referrer">`
      : `<span class="auth-avatar-mini">${escapeHtml(profile.initials)}</span>`;

    // Large avatar markup for dropdown
    const avatarLargeHtml = profile.avatar
      ? `<img src="${escapeHtml(profile.avatar)}" alt="${escapedName}" class="auth-avatar-large" referrerpolicy="no-referrer">`
      : `<span class="auth-avatar-large">${escapeHtml(profile.initials)}</span>`;

    this.root.innerHTML = `
      <button type="button" class="auth-user-btn" id="auth-user-btn" aria-expanded="${this.isDropdownOpen}" aria-haspopup="menu" aria-label="Account menu for ${escapedName}">
        ${avatarMiniHtml}
        <span class="auth-user-name-label">${escapedName}</span>
        ${CHEVRON_DOWN_SVG}
      </button>

      ${this.isDropdownOpen ? `
        <div class="auth-dropdown-menu" id="auth-dropdown-menu" role="menu" aria-label="User account actions">
          <div class="auth-dropdown-user-info">
            ${avatarLargeHtml}
            <div class="auth-dropdown-user-text">
              <p class="auth-dropdown-name" title="${escapedName}">${escapedName}</p>
              <p class="auth-dropdown-email" title="${escapedEmail}">${escapedEmail}</p>
            </div>
          </div>
          <div class="auth-dropdown-divider" role="separator"></div>
          <button type="button" class="auth-dropdown-logout-btn" id="auth-logout-btn" role="menuitem" ${this.isLoggingOut ? 'disabled' : ''}>
            ${this.isLoggingOut ? `<span class="auth-spinner-sm" aria-hidden="true"></span><span>Logging out...</span>` : `${LOGOUT_ICON_SVG}<span>Logout</span>`}
          </button>
        </div>
      ` : ''}
    `;

    const userBtn = this.root.querySelector('#auth-user-btn');
    if (userBtn) {
      userBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleDropdown();
      });
    }

    const logoutBtn = this.root.querySelector('#auth-logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.handleSignOut();
      });
    }
  }

  toggleDropdown() {
    this.isDropdownOpen = !this.isDropdownOpen;
    this.renderLoggedIn();
  }

  closeDropdown() {
    if (this.isDropdownOpen) {
      this.isDropdownOpen = false;
      this.renderLoggedIn();
    }
  }

  openModal() {
    this.isModalOpen = true;
    this.errorMessage = null;
    this.closeDropdown();
    this.renderModal();
  }

  closeModal() {
    this.isModalOpen = false;
    this.isSigningIn = false;
    this.errorMessage = null;
    const modal = document.querySelector('#auth-modal-root');
    if (modal) {
      modal.remove();
    }
    // Return focus to sign in button if available
    const signInBtn = document.querySelector('#auth-signin-btn');
    if (signInBtn) signInBtn.focus();
  }

  renderModal() {
    let modalRoot = document.querySelector('#auth-modal-root');
    if (!modalRoot) {
      modalRoot = document.createElement('div');
      modalRoot.id = 'auth-modal-root';
      document.body.appendChild(modalRoot);
    }

    modalRoot.innerHTML = `
      <div class="auth-modal-backdrop" id="auth-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
        <div class="auth-modal-card" id="auth-modal-card">
          <button type="button" class="auth-modal-close-btn" id="auth-modal-close-btn" aria-label="Close authentication modal">
            ${CLOSE_ICON_SVG}
          </button>

          <div class="auth-modal-header">
            <div class="auth-modal-badge">
              <span style="font-weight: 800;">&lt;/&gt;</span> Account
            </div>
            <h2 class="auth-modal-title" id="auth-modal-title">Sign in to Tailwind Lab</h2>
            <p class="auth-modal-subtitle">Continue learning Tailwind CSS</p>
          </div>

          ${this.errorMessage ? `
            <div class="auth-error-banner" role="alert">
              <span>⚠️</span>
              <span>${escapeHtml(this.errorMessage)}</span>
            </div>
          ` : ''}

          <div class="auth-modal-actions">
            <button type="button" class="auth-google-btn" id="auth-google-btn" ${this.isSigningIn ? 'disabled' : ''}>
              ${this.isSigningIn
                ? `<span class="auth-spinner-sm" aria-hidden="true"></span><span>Signing in...</span>`
                : `${GOOGLE_ICON_SVG}<span>Continue with Google</span>`}
            </button>
          </div>

          <div style="display: flex; justify-content: flex-end; margin-top: 4px;">
            <button type="button" class="auth-modal-cancel-btn" id="auth-modal-cancel-btn">
              Cancel
            </button>
          </div>
        </div>
      </div>
    `;

    // Event handlers inside modal
    const closeBtn = modalRoot.querySelector('#auth-modal-close-btn');
    const cancelBtn = modalRoot.querySelector('#auth-modal-cancel-btn');
    const googleBtn = modalRoot.querySelector('#auth-google-btn');
    const backdrop = modalRoot.querySelector('#auth-modal-backdrop');

    if (closeBtn) closeBtn.addEventListener('click', () => this.closeModal());
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeModal());
    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) this.closeModal();
      });
    }

    if (googleBtn) {
      googleBtn.addEventListener('click', async () => {
        await this.handleGoogleSignIn();
      });
      // Initial focus on Google button
      setTimeout(() => googleBtn.focus(), 50);
    }
  }

  async handleGoogleSignIn() {
    if (this.isSigningIn) return;
    this.isSigningIn = true;
    this.errorMessage = null;
    this.renderModal();

    const { error } = await signInWithGoogle();
    if (error) {
      this.isSigningIn = false;
      this.errorMessage = 'Unable to sign in with Google. Please try again.';
      this.renderModal();
    }
    // If successful, Supabase redirects the browser to the Google OAuth page.
  }

  async handleSignOut() {
    if (this.isLoggingOut) return;
    this.isLoggingOut = true;
    this.renderLoggedIn();

    const { error } = await signOut();
    this.isLoggingOut = false;
    this.isDropdownOpen = false;

    if (error) {
      alert('Something went wrong while signing out. Please try again.');
    }

    this.currentUser = null;
    this.render();
  }

  handleOutsideClick(e) {
    if (this.isDropdownOpen && this.root && !this.root.contains(e.target)) {
      this.closeDropdown();
    }
  }

  handleKeyDown(e) {
    if (e.key === 'Escape') {
      if (this.isModalOpen) {
        this.closeModal();
      } else if (this.isDropdownOpen) {
        this.closeDropdown();
      }
    }
  }
}

// Instantiate and initialize on DOMContentLoaded
const authUI = new AuthUI();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => authUI.init());
} else {
  authUI.init();
}

export { authUI };
