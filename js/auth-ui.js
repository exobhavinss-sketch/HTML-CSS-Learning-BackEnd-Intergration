/**
 * Authentication UI Controller
 * Manages Sign In, Sign Up, Email Verification, Forgot Password, Reset Password,
 * User Profile dropdown, and state transitions using Supabase Auth.
 */
import {
  signUp,
  signIn,
  signOut,
  forgotPassword,
  resetPassword,
  resendVerificationEmail,
  getCurrentSession,
  subscribeToAuthChanges,
  formatUserProfile,
  getFriendlyErrorMessage
} from './auth.js';
import { userDataService } from './userDataService.js';
import { uploadAvatar, removeAvatar, validateImageFile } from './profileService.js';

// SVG Icons
const CAMERA_ICON_SVG = `
<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
  <circle cx="12" cy="13" r="4"/>
</svg>`;

const TRASH_ICON_SVG = `
<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polyline points="3 6 5 6 21 6"/>
  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
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

const USER_PLUS_ICON_SVG = `
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
  <circle cx="8.5" cy="7" r="4"/>
  <line x1="20" y1="8" x2="20" y2="14"/>
  <line x1="23" y1="11" x2="17" y2="11"/>
</svg>`;

const EYE_ICON_SVG = `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
  <circle cx="12" cy="12" r="3"/>
</svg>`;

const EYE_OFF_ICON_SVG = `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
  <line x1="1" y1="1" x2="23" y2="23"/>
</svg>`;

const MAIL_ICON_SVG = `
<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
  <polyline points="22,6 12,13 2,6"/>
</svg>`;

const CHECK_CIRCLE_SVG = `
<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
  <polyline points="22 4 12 14.01 9 11.01"/>
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

    // Modal state: 'signin' | 'signup' | 'verification-pending' | 'forgot' | 'reset-password'
    this.modalMode = 'signin';

    // Loading flags
    this.isLoading = false;
    this.isLoggingOut = false;
    this.isResending = false;

    // Feedback messages
    this.generalError = null;
    this.generalSuccess = null;
    this.fieldErrors = {};

    // Avatar state
    this.isUploadingAvatar = false;
    this.avatarError = null;
    this.avatarSuccess = null;

    // Temp state
    this.pendingEmail = '';

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

    this.renderLoading();

    // Attach global listeners
    document.addEventListener('click', this.handleOutsideClick);
    document.addEventListener('keydown', this.handleKeyDown);

    // Subscribe to auth state changes
    subscribeToAuthChanges(async (event, session) => {
      const prevUser = this.currentUser;
      this.currentUser = session?.user || null;
      this.isLoading = false;
      this.isLoggingOut = false;

      if (event === 'PASSWORD_RECOVERY') {
        this.openModal('reset-password');
        return;
      }

      if (this.currentUser) {
        if (this.isModalOpen && this.modalMode !== 'reset-password') {
          this.closeModal();
        }
        this.syncUserProfileWithPractice();
        if (!prevUser || prevUser.id !== this.currentUser.id || event === 'SIGNED_IN') {
          await userDataService.handleUserSignIn(this.currentUser);
        }
      } else if (event === 'SIGNED_OUT') {
        await userDataService.handleUserSignOut();
      }

      this.render();
    });

    // Check for password recovery hash in URL (type=recovery)
    if (typeof window !== 'undefined') {
      const hashStr = window.location.hash.replace(/^#/, '');
      const hashParams = new URLSearchParams(hashStr);
      const queryParams = new URLSearchParams(window.location.search);

      if (hashParams.get('type') === 'recovery' || queryParams.get('type') === 'recovery') {
        this.openModal('reset-password');
      }

      const authError = hashParams.get('error_description') || hashParams.get('error') ||
                        queryParams.get('error_description') || queryParams.get('error');
      if (authError) {
        this.generalError = decodeURIComponent(authError.replace(/\+/g, ' '));
        this.openModal('signin');
      }
    }

    // Retrieve initial session
    const session = await getCurrentSession();
    this.currentUser = session?.user || null;
    if (this.currentUser) {
      this.syncUserProfileWithPractice();
      await userDataService.handleUserSignIn(this.currentUser);
    }
    this.render();
  }

  syncUserProfileWithPractice() {
    if (!this.currentUser) return;
    const profile = formatUserProfile(this.currentUser);
    if (!profile.name) return;

    if (typeof window !== 'undefined' && window.PS) {
      if (!window.PS.name || !window.PS.name.trim() || window.PS.name === 'User') {
        window.PS.name = profile.name;
        if (typeof window.psSave === 'function') {
          window.psSave();
        }
        const nameInput = document.querySelector('#p-name');
        if (nameInput) {
          nameInput.value = profile.name;
        }
      }
    }
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
      <div class="auth-logged-out-group">
        <button type="button" class="auth-btn-signin" id="auth-signin-btn" aria-haspopup="dialog">
          ${USER_ICON_SVG}
          <span>Sign In</span>
        </button>
        <button type="button" class="auth-btn-signup" id="auth-signup-btn" aria-haspopup="dialog">
          ${USER_PLUS_ICON_SVG}
          <span>Create Account</span>
        </button>
      </div>
    `;

    const signInBtn = this.root.querySelector('#auth-signin-btn');
    if (signInBtn) {
      signInBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openModal('signin');
      });
    }

    const signUpBtn = this.root.querySelector('#auth-signup-btn');
    if (signUpBtn) {
      signUpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openModal('signup');
      });
    }
  }

  renderLoggedIn() {
    const profileRecord = userDataService.cachedData?.profile;
    const profile = formatUserProfile(this.currentUser, profileRecord);
    const escapedName = escapeHtml(profile.name);
    const escapedEmail = escapeHtml(profile.email);

    // Dynamic alt text and fallback onerror handlers
    const avatarMiniHtml = profile.avatar
      ? `<img src="${escapeHtml(profile.avatar)}" alt="${escapedName} profile picture" class="auth-avatar-mini" referrerpolicy="no-referrer" onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('span'),{className:'auth-avatar-mini',textContent:'${escapeHtml(profile.initials)}'}))">`
      : `<span class="auth-avatar-mini" aria-hidden="true">${escapeHtml(profile.initials)}</span>`;

    const avatarLargeHtml = profile.avatar
      ? `<img src="${escapeHtml(profile.avatar)}" alt="${escapedName} profile picture" class="auth-avatar-large" referrerpolicy="no-referrer" onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('span'),{className:'auth-avatar-large',textContent:'${escapeHtml(profile.initials)}'}))">`
      : `<span class="auth-avatar-large" aria-hidden="true">${escapeHtml(profile.initials)}</span>`;

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

          <div class="auth-dropdown-avatar-actions">
            <input type="file" id="auth-avatar-file-input" class="auth-avatar-file-input" accept="image/jpeg,image/png,image/webp" style="display:none" aria-label="Upload profile picture">
            <button type="button" class="auth-dropdown-avatar-btn" id="auth-change-photo-btn" aria-label="Change profile picture" ${this.isUploadingAvatar ? 'disabled' : ''}>
              ${this.isUploadingAvatar
                ? `<span class="auth-spinner-sm" aria-hidden="true"></span><span>Uploading...</span>`
                : `${CAMERA_ICON_SVG}<span>${profile.avatar ? 'Change photo' : 'Upload photo'}</span>`}
            </button>
            ${profile.avatar && !this.isUploadingAvatar ? `
              <button type="button" class="auth-dropdown-remove-photo-btn" id="auth-remove-photo-btn" aria-label="Remove profile picture">
                ${TRASH_ICON_SVG}<span>Remove</span>
              </button>
            ` : ''}
          </div>

          ${this.avatarError ? `
            <div class="auth-avatar-msg error" role="alert">
              <span>⚠️ ${escapeHtml(this.avatarError)}</span>
            </div>
          ` : ''}

          ${this.avatarSuccess ? `
            <div class="auth-avatar-msg success" role="status">
              <span>✓ ${escapeHtml(this.avatarSuccess)}</span>
            </div>
          ` : ''}

          <div class="auth-dropdown-divider" role="separator"></div>
          <button type="button" class="auth-dropdown-logout-btn" id="auth-logout-btn" role="menuitem" ${this.isLoggingOut ? 'disabled' : ''}>
            ${this.isLoggingOut ? `<span class="auth-spinner-sm" aria-hidden="true"></span><span>Logging out...</span>` : `${LOGOUT_ICON_SVG}<span>Sign Out</span>`}
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

    const changePhotoBtn = this.root.querySelector('#auth-change-photo-btn');
    const fileInput = this.root.querySelector('#auth-avatar-file-input');
    if (changePhotoBtn && fileInput) {
      changePhotoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.isUploadingAvatar) return;
        this.avatarError = null;
        fileInput.click();
      });

      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (file) {
          await this.handleAvatarUpload(file);
        }
        fileInput.value = '';
      });
    }

    const removePhotoBtn = this.root.querySelector('#auth-remove-photo-btn');
    if (removePhotoBtn) {
      removePhotoBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.handleAvatarRemove();
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

  async handleAvatarUpload(file) {
    if (!file || this.isUploadingAvatar) return;

    // Fast client-side check
    const validation = validateImageFile(file);
    if (!validation.valid) {
      this.avatarError = validation.error;
      this.renderLoggedIn();
      return;
    }

    this.isUploadingAvatar = true;
    this.avatarError = null;
    this.avatarSuccess = null;
    this.renderLoggedIn();

    try {
      const res = await uploadAvatar(file, userDataService);
      if (res.success) {
        this.avatarSuccess = 'Profile picture updated!';
        if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
          window.showToast('Profile picture updated!');
        }
        setTimeout(() => {
          this.avatarSuccess = null;
          if (this.isDropdownOpen) this.renderLoggedIn();
        }, 3500);
      } else {
        this.avatarError = res.error || "Couldn't upload your profile picture.";
      }
    } catch (err) {
      console.error('[AuthUI] Exception uploading avatar:', err);
      this.avatarError = "Couldn't upload your profile picture. Please try again.";
    } finally {
      this.isUploadingAvatar = false;
      this.renderLoggedIn();
    }
  }

  async handleAvatarRemove() {
    if (this.isUploadingAvatar) return;

    const confirmed = typeof window !== 'undefined' ? window.confirm('Remove your profile picture?') : true;
    if (!confirmed) return;

    this.isUploadingAvatar = true;
    this.avatarError = null;
    this.avatarSuccess = null;
    this.renderLoggedIn();

    try {
      const res = await removeAvatar(userDataService);
      if (res.success) {
        this.avatarSuccess = 'Profile picture removed.';
        setTimeout(() => {
          this.avatarSuccess = null;
          if (this.isDropdownOpen) this.renderLoggedIn();
        }, 3000);
      } else {
        this.avatarError = res.error || 'Failed to remove profile picture.';
      }
    } catch (err) {
      console.error('[AuthUI] Exception removing avatar:', err);
      this.avatarError = 'Failed to remove profile picture. Please try again.';
    } finally {
      this.isUploadingAvatar = false;
      this.renderLoggedIn();
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

  /**
   * Opens the authentication modal in the specified mode.
   * @param {'signin' | 'signup' | 'verification-pending' | 'forgot' | 'reset-password'} mode
   */
  openModal(mode = 'signin') {
    this.modalMode = mode;
    this.isModalOpen = true;
    this.generalError = null;
    this.generalSuccess = null;
    this.fieldErrors = {};
    this.isLoading = false;
    this.closeDropdown();
    this.renderModal();
  }

  closeModal() {
    this.isModalOpen = false;
    this.isLoading = false;
    this.generalError = null;
    this.generalSuccess = null;
    this.fieldErrors = {};

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

    let modalContent = '';
    switch (this.modalMode) {
      case 'signup':
        modalContent = this.getSignupModalHtml();
        break;
      case 'verification-pending':
        modalContent = this.getVerificationPendingModalHtml();
        break;
      case 'forgot':
        modalContent = this.getForgotPasswordModalHtml();
        break;
      case 'reset-password':
        modalContent = this.getResetPasswordModalHtml();
        break;
      case 'signin':
      default:
        modalContent = this.getSigninModalHtml();
        break;
    }

    modalRoot.innerHTML = `
      <div class="auth-modal-backdrop" id="auth-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
        <div class="auth-modal-card" id="auth-modal-card">
          <button type="button" class="auth-modal-close-btn" id="auth-modal-close-btn" aria-label="Close authentication modal">
            ${CLOSE_ICON_SVG}
          </button>
          ${modalContent}
        </div>
      </div>
    `;

    this.bindModalEvents(modalRoot);
  }

  getSigninModalHtml() {
    return `
      <div class="auth-modal-header">
        <div class="auth-modal-badge">
          <span style="font-weight: 800;">&lt;/&gt;</span> Account
        </div>
        <h2 class="auth-modal-title" id="auth-modal-title">Sign in to Tag Finder</h2>
        <p class="auth-modal-subtitle">Welcome back! Enter your details to continue.</p>
      </div>

      ${this.generalError ? `
        <div class="auth-error-banner" role="alert">
          <span>⚠️</span>
          <span>${escapeHtml(this.generalError)}</span>
        </div>
      ` : ''}

      ${this.generalSuccess ? `
        <div class="auth-success-banner" role="status">
          <span>✓</span>
          <span>${escapeHtml(this.generalSuccess)}</span>
        </div>
      ` : ''}

      <form class="auth-form" id="auth-signin-form" novalidate>
        <div class="auth-field">
          <label class="auth-label" for="auth-signin-email">Email address</label>
          <input
            type="email"
            class="auth-input ${this.fieldErrors.email ? 'has-error' : ''}"
            id="auth-signin-email"
            name="email"
            autocomplete="email"
            placeholder="name@example.com"
            required
          />
          ${this.fieldErrors.email ? `<p class="auth-field-error" role="alert">${escapeHtml(this.fieldErrors.email)}</p>` : ''}
        </div>

        <div class="auth-field">
          <div class="auth-label-row">
            <label class="auth-label" for="auth-signin-password">Password</label>
            <button type="button" class="auth-link-btn" id="auth-goto-forgot">Forgot password?</button>
          </div>
          <div class="auth-input-wrapper">
            <input
              type="password"
              class="auth-input ${this.fieldErrors.password ? 'has-error' : ''}"
              id="auth-signin-password"
              name="password"
              autocomplete="current-password"
              placeholder="••••••••"
              required
            />
            <button type="button" class="auth-pw-toggle" data-target="auth-signin-password" aria-label="Show password" aria-pressed="false">
              ${EYE_ICON_SVG}
            </button>
          </div>
          ${this.fieldErrors.password ? `<p class="auth-field-error" role="alert">${escapeHtml(this.fieldErrors.password)}</p>` : ''}
        </div>

        <button type="submit" class="auth-submit-btn" id="auth-signin-submit" ${this.isLoading ? 'disabled' : ''}>
          ${this.isLoading ? `<span class="auth-spinner-sm" aria-hidden="true"></span><span>Signing in...</span>` : `<span>Sign In</span>`}
        </button>
      </form>

      <div class="auth-modal-footer">
        <span class="auth-footer-text">Don't have an account?</span>
        <button type="button" class="auth-link-btn bold" id="auth-goto-signup">Create account</button>
      </div>
    `;
  }

  getSignupModalHtml() {
    return `
      <div class="auth-modal-header">
        <div class="auth-modal-badge">
          <span style="font-weight: 800;">&lt;/&gt;</span> Account
        </div>
        <h2 class="auth-modal-title" id="auth-modal-title">Create Account</h2>
        <p class="auth-modal-subtitle">Start tracking your HTML &amp; CSS progress.</p>
      </div>

      ${this.generalError ? `
        <div class="auth-error-banner" role="alert">
          <span>⚠️</span>
          <span>${escapeHtml(this.generalError)}</span>
        </div>
      ` : ''}

      <form class="auth-form" id="auth-signup-form" novalidate>
        <div class="auth-field">
          <label class="auth-label" for="auth-signup-name">Full Name</label>
          <input
            type="text"
            class="auth-input ${this.fieldErrors.fullName ? 'has-error' : ''}"
            id="auth-signup-name"
            name="fullName"
            autocomplete="name"
            placeholder="Alex Johnson"
            required
          />
          ${this.fieldErrors.fullName ? `<p class="auth-field-error" role="alert">${escapeHtml(this.fieldErrors.fullName)}</p>` : ''}
        </div>

        <div class="auth-field">
          <label class="auth-label" for="auth-signup-email">Email address</label>
          <input
            type="email"
            class="auth-input ${this.fieldErrors.email ? 'has-error' : ''}"
            id="auth-signup-email"
            name="email"
            autocomplete="email"
            placeholder="name@example.com"
            required
          />
          ${this.fieldErrors.email ? `<p class="auth-field-error" role="alert">${escapeHtml(this.fieldErrors.email)}</p>` : ''}
        </div>

        <div class="auth-field">
          <label class="auth-label" for="auth-signup-password">Password</label>
          <div class="auth-input-wrapper">
            <input
              type="password"
              class="auth-input ${this.fieldErrors.password ? 'has-error' : ''}"
              id="auth-signup-password"
              name="password"
              autocomplete="new-password"
              placeholder="At least 8 characters"
              required
            />
            <button type="button" class="auth-pw-toggle" data-target="auth-signup-password" aria-label="Show password" aria-pressed="false">
              ${EYE_ICON_SVG}
            </button>
          </div>
          <p class="auth-field-hint">Must be at least 8 characters long.</p>
          ${this.fieldErrors.password ? `<p class="auth-field-error" role="alert">${escapeHtml(this.fieldErrors.password)}</p>` : ''}
        </div>

        <div class="auth-field">
          <label class="auth-label" for="auth-signup-confirm-password">Confirm Password</label>
          <div class="auth-input-wrapper">
            <input
              type="password"
              class="auth-input ${this.fieldErrors.confirmPassword ? 'has-error' : ''}"
              id="auth-signup-confirm-password"
              name="confirmPassword"
              autocomplete="new-password"
              placeholder="Re-enter password"
              required
            />
            <button type="button" class="auth-pw-toggle" data-target="auth-signup-confirm-password" aria-label="Show password" aria-pressed="false">
              ${EYE_ICON_SVG}
            </button>
          </div>
          ${this.fieldErrors.confirmPassword ? `<p class="auth-field-error" role="alert">${escapeHtml(this.fieldErrors.confirmPassword)}</p>` : ''}
        </div>

        <button type="submit" class="auth-submit-btn" id="auth-signup-submit" ${this.isLoading ? 'disabled' : ''}>
          ${this.isLoading ? `<span class="auth-spinner-sm" aria-hidden="true"></span><span>Creating account...</span>` : `<span>Create Account</span>`}
        </button>
      </form>

      <div class="auth-modal-footer">
        <span class="auth-footer-text">Already have an account?</span>
        <button type="button" class="auth-link-btn bold" id="auth-goto-signin">Sign In</button>
      </div>
    `;
  }

  getVerificationPendingModalHtml() {
    return `
      <div class="auth-status-container">
        <div class="auth-status-icon-box mail">
          ${MAIL_ICON_SVG}
        </div>
        <h2 class="auth-modal-title center" id="auth-modal-title">Check Your Email</h2>
        <p class="auth-modal-subtitle center">Account created successfully.</p>

        <p class="auth-status-description">
          We've sent a verification link to<br>
          <strong class="auth-highlight-email">${escapeHtml(this.pendingEmail || 'your email')}</strong>.<br><br>
          Please check your inbox and click the verification link to activate your account.
        </p>

        ${this.generalSuccess ? `
          <div class="auth-success-banner" role="status">
            <span>✓</span>
            <span>${escapeHtml(this.generalSuccess)}</span>
          </div>
        ` : ''}

        ${this.generalError ? `
          <div class="auth-error-banner" role="alert">
            <span>⚠️</span>
            <span>${escapeHtml(this.generalError)}</span>
          </div>
        ` : ''}

        <div class="auth-status-actions">
          <p class="auth-resend-prompt">Didn't receive the email?</p>
          <button type="button" class="auth-link-btn bold" id="auth-resend-btn" ${this.isResending ? 'disabled' : ''}>
            ${this.isResending ? `<span class="auth-spinner-sm" aria-hidden="true"></span><span>Resending email...</span>` : `<span>Resend confirmation email</span>`}
          </button>
        </div>

        <div class="auth-modal-footer center" style="margin-top: 14px;">
          <button type="button" class="auth-btn-secondary" id="auth-back-signin-btn">Return to Sign In</button>
        </div>
      </div>
    `;
  }

  getForgotPasswordModalHtml() {
    return `
      <div class="auth-modal-header">
        <div class="auth-modal-badge">
          <span style="font-weight: 800;">&lt;/&gt;</span> Recovery
        </div>
        <h2 class="auth-modal-title" id="auth-modal-title">Reset Your Password</h2>
        <p class="auth-modal-subtitle">Enter your email and we'll send you a recovery link.</p>
      </div>

      ${this.generalSuccess ? `
        <div class="auth-success-box">
          <div class="auth-success-banner" role="status">
            <span>✓</span>
            <span>${escapeHtml(this.generalSuccess)}</span>
          </div>
          <p class="auth-status-description" style="margin-top: 10px;">
            Check your email inbox for instructions. If you don't see it, be sure to check your spam folder.
          </p>
          <button type="button" class="auth-btn-secondary" id="auth-back-signin-btn" style="width: 100%; margin-top: 12px;">
            Back to Sign In
          </button>
        </div>
      ` : `
        ${this.generalError ? `
          <div class="auth-error-banner" role="alert">
            <span>⚠️</span>
            <span>${escapeHtml(this.generalError)}</span>
          </div>
        ` : ''}

        <form class="auth-form" id="auth-forgot-form" novalidate>
          <div class="auth-field">
            <label class="auth-label" for="auth-forgot-email">Email address</label>
            <input
              type="email"
              class="auth-input ${this.fieldErrors.email ? 'has-error' : ''}"
              id="auth-forgot-email"
              name="email"
              autocomplete="email"
              placeholder="name@example.com"
              required
            />
            ${this.fieldErrors.email ? `<p class="auth-field-error" role="alert">${escapeHtml(this.fieldErrors.email)}</p>` : ''}
          </div>

          <button type="submit" class="auth-submit-btn" id="auth-forgot-submit" ${this.isLoading ? 'disabled' : ''}>
            ${this.isLoading ? `<span class="auth-spinner-sm" aria-hidden="true"></span><span>Sending reset link...</span>` : `<span>Send Reset Link</span>`}
          </button>
        </form>

        <div class="auth-modal-footer">
          <button type="button" class="auth-link-btn" id="auth-back-signin-link">← Back to Sign In</button>
        </div>
      `}
    `;
  }

  getResetPasswordModalHtml() {
    return `
      <div class="auth-modal-header">
        <div class="auth-modal-badge">
          <span style="font-weight: 800;">&lt;/&gt;</span> Security
        </div>
        <h2 class="auth-modal-title" id="auth-modal-title">Create New Password</h2>
        <p class="auth-modal-subtitle">Enter your new secure password below.</p>
      </div>

      ${this.generalSuccess ? `
        <div class="auth-status-container">
          <div class="auth-status-icon-box check">
            ${CHECK_CIRCLE_SVG}
          </div>
          <div class="auth-success-banner" role="status">
            <span>✓</span>
            <span>${escapeHtml(this.generalSuccess)}</span>
          </div>
          <p class="auth-status-description" style="margin-top: 10px;">
            You can now continue learning with your new password.
          </p>
          <button type="button" class="auth-submit-btn" id="auth-finish-reset-btn" style="margin-top: 14px;">
            Continue to App
          </button>
        </div>
      ` : `
        ${this.generalError ? `
          <div class="auth-error-banner" role="alert">
            <span>⚠️</span>
            <span>${escapeHtml(this.generalError)}</span>
          </div>
        ` : ''}

        <form class="auth-form" id="auth-reset-form" novalidate>
          <div class="auth-field">
            <label class="auth-label" for="auth-new-password">New Password</label>
            <div class="auth-input-wrapper">
              <input
                type="password"
                class="auth-input ${this.fieldErrors.newPassword ? 'has-error' : ''}"
                id="auth-new-password"
                name="newPassword"
                autocomplete="new-password"
                placeholder="At least 8 characters"
                required
              />
              <button type="button" class="auth-pw-toggle" data-target="auth-new-password" aria-label="Show password" aria-pressed="false">
                ${EYE_ICON_SVG}
              </button>
            </div>
            <p class="auth-field-hint">Must be at least 8 characters long.</p>
            ${this.fieldErrors.newPassword ? `<p class="auth-field-error" role="alert">${escapeHtml(this.fieldErrors.newPassword)}</p>` : ''}
          </div>

          <div class="auth-field">
            <label class="auth-label" for="auth-confirm-new-password">Confirm New Password</label>
            <div class="auth-input-wrapper">
              <input
                type="password"
                class="auth-input ${this.fieldErrors.confirmNewPassword ? 'has-error' : ''}"
                id="auth-confirm-new-password"
                name="confirmNewPassword"
                autocomplete="new-password"
                placeholder="Re-enter new password"
                required
              />
              <button type="button" class="auth-pw-toggle" data-target="auth-confirm-new-password" aria-label="Show password" aria-pressed="false">
                ${EYE_ICON_SVG}
              </button>
            </div>
            ${this.fieldErrors.confirmNewPassword ? `<p class="auth-field-error" role="alert">${escapeHtml(this.fieldErrors.confirmNewPassword)}</p>` : ''}
          </div>

          <button type="submit" class="auth-submit-btn" id="auth-reset-submit" ${this.isLoading ? 'disabled' : ''}>
            ${this.isLoading ? `<span class="auth-spinner-sm" aria-hidden="true"></span><span>Updating password...</span>` : `<span>Update Password</span>`}
          </button>
        </form>
      `}
    `;
  }

  bindModalEvents(modalRoot) {
    const closeBtn = modalRoot.querySelector('#auth-modal-close-btn');
    const backdrop = modalRoot.querySelector('#auth-modal-backdrop');

    if (closeBtn) closeBtn.addEventListener('click', () => this.closeModal());
    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) this.closeModal();
      });
    }

    // Tab key focus trap
    modalRoot.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        const focusables = Array.from(modalRoot.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href]'));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    // Password visibility toggles
    modalRoot.querySelectorAll('.auth-pw-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const input = modalRoot.querySelector(`#${targetId}`);
        if (!input) return;

        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
        btn.setAttribute('aria-pressed', String(isPassword));
        btn.innerHTML = isPassword ? EYE_OFF_ICON_SVG : EYE_ICON_SVG;
      });
    });

    // State navigation buttons
    const gotoSignup = modalRoot.querySelector('#auth-goto-signup');
    if (gotoSignup) gotoSignup.addEventListener('click', () => this.openModal('signup'));

    const gotoSignin = modalRoot.querySelector('#auth-goto-signin');
    if (gotoSignin) gotoSignin.addEventListener('click', () => this.openModal('signin'));

    const gotoForgot = modalRoot.querySelector('#auth-goto-forgot');
    if (gotoForgot) gotoForgot.addEventListener('click', () => this.openModal('forgot'));

    const backSigninLink = modalRoot.querySelector('#auth-back-signin-link');
    if (backSigninLink) backSigninLink.addEventListener('click', () => this.openModal('signin'));

    const backSigninBtn = modalRoot.querySelector('#auth-back-signin-btn');
    if (backSigninBtn) backSigninBtn.addEventListener('click', () => this.openModal('signin'));

    const finishResetBtn = modalRoot.querySelector('#auth-finish-reset-btn');
    if (finishResetBtn) finishResetBtn.addEventListener('click', () => this.closeModal());

    const resendBtn = modalRoot.querySelector('#auth-resend-btn');
    if (resendBtn) {
      resendBtn.addEventListener('click', async () => {
        await this.handleResendVerification();
      });
    }

    // Form Submissions
    const signinForm = modalRoot.querySelector('#auth-signin-form');
    if (signinForm) {
      signinForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleSignInSubmit(signinForm);
      });
      // Initial focus on first input
      setTimeout(() => {
        const firstInput = signinForm.querySelector('input');
        if (firstInput) firstInput.focus();
      }, 50);
    }

    const signupForm = modalRoot.querySelector('#auth-signup-form');
    if (signupForm) {
      signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleSignUpSubmit(signupForm);
      });
      setTimeout(() => {
        const firstInput = signupForm.querySelector('input');
        if (firstInput) firstInput.focus();
      }, 50);
    }

    const forgotForm = modalRoot.querySelector('#auth-forgot-form');
    if (forgotForm) {
      forgotForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleForgotSubmit(forgotForm);
      });
      setTimeout(() => {
        const firstInput = forgotForm.querySelector('input');
        if (firstInput) firstInput.focus();
      }, 50);
    }

    const resetForm = modalRoot.querySelector('#auth-reset-form');
    if (resetForm) {
      resetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleResetSubmit(resetForm);
      });
      setTimeout(() => {
        const firstInput = resetForm.querySelector('input');
        if (firstInput) firstInput.focus();
      }, 50);
    }
  }

  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
  }

  async handleSignInSubmit(form) {
    if (this.isLoading) return;

    this.fieldErrors = {};
    this.generalError = null;

    const email = form.email.value.trim();
    const password = form.password.value;

    // Validation
    if (!email) {
      this.fieldErrors.email = 'Please enter your email.';
    } else if (!this.isValidEmail(email)) {
      this.fieldErrors.email = 'Please enter a valid email address.';
    }

    if (!password) {
      this.fieldErrors.password = 'Please enter your password.';
    }

    if (Object.keys(this.fieldErrors).length > 0) {
      this.renderModal();
      return;
    }

    this.isLoading = true;
    this.renderModal();

    const { data, error } = await signIn({ email, password });
    this.isLoading = false;

    if (error) {
      this.generalError = getFriendlyErrorMessage(error);
      this.renderModal();
      return;
    }

    this.currentUser = data?.user || null;
    this.syncUserProfileWithPractice();
    if (this.currentUser) {
      await userDataService.handleUserSignIn(this.currentUser);
    }
    this.closeModal();
    this.render();
  }

  async handleSignUpSubmit(form) {
    if (this.isLoading) return;

    this.fieldErrors = {};
    this.generalError = null;

    const fullName = form.fullName.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;
    const confirmPassword = form.confirmPassword.value;

    // Validation
    if (!fullName) {
      this.fieldErrors.fullName = 'Please enter your name.';
    } else if (fullName.length < 2) {
      this.fieldErrors.fullName = 'Name must be at least 2 characters.';
    }

    if (!email) {
      this.fieldErrors.email = 'Please enter your email.';
    } else if (!this.isValidEmail(email)) {
      this.fieldErrors.email = 'Please enter a valid email address.';
    }

    if (!password) {
      this.fieldErrors.password = 'Please enter a password.';
    } else if (password.length < 8) {
      this.fieldErrors.password = 'Password must be at least 8 characters.';
    }

    if (!confirmPassword) {
      this.fieldErrors.confirmPassword = 'Please confirm your password.';
    } else if (password !== confirmPassword) {
      this.fieldErrors.confirmPassword = 'Passwords do not match.';
    }

    if (Object.keys(this.fieldErrors).length > 0) {
      this.renderModal();
      return;
    }

    this.isLoading = true;
    this.renderModal();

    const { data, error } = await signUp({ fullName, email, password });
    this.isLoading = false;

    if (error) {
      this.generalError = getFriendlyErrorMessage(error);
      this.renderModal();
      return;
    }

    // Check if Supabase requires email verification (session is null or user has confirmation pending)
    this.pendingEmail = email;

    if (data?.session) {
      // Auto-confirmed by Supabase project configuration
      this.currentUser = data.user;
      this.syncUserProfileWithPractice();
      if (this.currentUser) {
        await userDataService.handleUserSignIn(this.currentUser);
      }
      this.closeModal();
      this.render();
    } else {
      // Email confirmation pending state
      this.modalMode = 'verification-pending';
      this.generalSuccess = null;
      this.generalError = null;
      this.renderModal();
    }
  }

  async handleResendVerification() {
    if (this.isResending || !this.pendingEmail) return;

    this.isResending = true;
    this.generalError = null;
    this.generalSuccess = null;
    this.renderModal();

    const { error } = await resendVerificationEmail(this.pendingEmail);
    this.isResending = false;

    if (error) {
      this.generalError = getFriendlyErrorMessage(error);
    } else {
      this.generalSuccess = 'A new verification email has been sent!';
    }

    this.renderModal();
  }

  async handleForgotSubmit(form) {
    if (this.isLoading) return;

    this.fieldErrors = {};
    this.generalError = null;

    const email = form.email.value.trim();

    if (!email) {
      this.fieldErrors.email = 'Please enter your email address.';
    } else if (!this.isValidEmail(email)) {
      this.fieldErrors.email = 'Please enter a valid email address.';
    }

    if (Object.keys(this.fieldErrors).length > 0) {
      this.renderModal();
      return;
    }

    this.isLoading = true;
    this.renderModal();

    const { error } = await forgotPassword(email);
    this.isLoading = false;

    if (error) {
      this.generalError = getFriendlyErrorMessage(error);
      this.renderModal();
      return;
    }

    // Never reveal whether an email exists; always show success
    this.generalSuccess = 'Password reset instructions have been sent to your email.';
    this.renderModal();
  }

  async handleResetSubmit(form) {
    if (this.isLoading) return;

    this.fieldErrors = {};
    this.generalError = null;

    const newPassword = form.newPassword.value;
    const confirmNewPassword = form.confirmNewPassword.value;

    if (!newPassword) {
      this.fieldErrors.newPassword = 'Please enter a new password.';
    } else if (newPassword.length < 8) {
      this.fieldErrors.newPassword = 'Password must be at least 8 characters.';
    }

    if (!confirmNewPassword) {
      this.fieldErrors.confirmNewPassword = 'Please confirm your new password.';
    } else if (newPassword !== confirmNewPassword) {
      this.fieldErrors.confirmNewPassword = 'Passwords do not match.';
    }

    if (Object.keys(this.fieldErrors).length > 0) {
      this.renderModal();
      return;
    }

    this.isLoading = true;
    this.renderModal();

    const { error } = await resetPassword(newPassword);
    this.isLoading = false;

    if (error) {
      this.generalError = getFriendlyErrorMessage(error);
      this.renderModal();
      return;
    }

    this.generalSuccess = 'Your password has been updated successfully.';
    this.renderModal();
  }

  async handleSignOut() {
    if (this.isLoggingOut) return;
    this.isLoggingOut = true;
    this.isUploadingAvatar = false;
    this.avatarError = null;
    this.avatarSuccess = null;
    this.renderLoggedIn();

    // Flush pending changes before signout
    await userDataService.flushAllPending();

    const { error } = await signOut();
    this.isLoggingOut = false;
    this.isDropdownOpen = false;

    if (error) {
      console.error('[AuthUI] Sign out error:', error.message);
    }

    // Cleanly clear memory and update app state
    await userDataService.handleUserSignOut();

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
      if (this.isModalOpen && !this.isLoading) {
        this.closeModal();
      } else if (this.isDropdownOpen) {
        this.closeDropdown();
      }
    }
  }
}

// Instantiate and initialize on DOMContentLoaded in browser environment
const authUI = new AuthUI();

if (typeof window !== 'undefined') {
  window.authUI = authUI;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => authUI.init());
  } else {
    authUI.init();
  }
}

export { authUI };
