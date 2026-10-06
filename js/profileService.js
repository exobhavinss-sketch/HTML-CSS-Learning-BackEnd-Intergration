/**
 * Profile Service Module
 * Handles user profile avatar operations, image validation, client-side
 * square cropping/resizing, Supabase Storage uploads, and profile persistence.
 */
import { supabase } from './supabase.js';

const BUCKET_NAME = 'avatars';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const TARGET_AVATAR_SIZE = 512; // 512x512 square avatar

/**
 * Validates an image file before upload.
 * Checks MIME type, extension, and file size.
 * @param {File} file
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateImageFile(file) {
  if (!file) {
    return { valid: false, error: 'No image file selected.' };
  }

  // 1. Validate file extension
  const fileName = (file.name || '').toLowerCase();
  const hasValidExt = ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext));

  // 2. Validate MIME type
  const mimeType = (file.type || '').toLowerCase();
  const hasValidMime = ALLOWED_MIME_TYPES.includes(mimeType) ||
    (mimeType.startsWith('image/') && hasValidExt);

  if (!hasValidExt && !ALLOWED_MIME_TYPES.includes(mimeType)) {
    return { valid: false, error: 'Please select a JPG, PNG, or WEBP image.' };
  }

  // 3. Validate file size (<= 5 MB)
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: 'Image must be smaller than 5 MB.' };
  }

  return { valid: true };
}

/**
 * Generates dynamic user initials from name and/or email.
 * @param {string} [name='']
 * @param {string} [email='']
 * @returns {string} 1-2 character initials (e.g. "BS", "AC", "B")
 */
export function getInitials(name = '', email = '') {
  const cleanName = (name || '').trim();
  if (cleanName && cleanName.toLowerCase() !== 'user') {
    const parts = cleanName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const first = parts[0][0] || '';
      const second = parts[1][0] || '';
      return (first + second).toUpperCase();
    }
    if (parts.length === 1 && parts[0].length > 0) {
      return parts[0][0].toUpperCase();
    }
  }

  const cleanEmail = (email || '').trim();
  if (cleanEmail) {
    return cleanEmail[0].toUpperCase();
  }

  return 'U';
}

/**
 * Client-side center crop and resize to a clean square (e.g. 512x512).
 * Converts to WebP format for fast loading and optimal file size.
 * @param {File} file
 * @param {number} [targetSize=512]
 * @returns {Promise<Blob>}
 */
export async function cropAndResizeToSquare(file, targetSize = TARGET_AVATAR_SIZE) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Selected file is not a valid or readable image.'));
      img.onload = () => {
        try {
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;

          if (!width || !height) {
            reject(new Error('Could not read image dimensions.'));
            return;
          }

          // Determine square crop dimensions centered in the image
          const cropSize = Math.min(width, height);
          const startX = Math.round((width - cropSize) / 2);
          const startY = Math.round((height - cropSize) / 2);

          const canvas = document.createElement('canvas');
          canvas.width = targetSize;
          canvas.height = targetSize;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas 2D context not available.'));
            return;
          }

          // Image smoothing for high-quality downsampling
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          // Draw centered square crop resized to targetSize
          ctx.drawImage(
            img,
            startX, startY, cropSize, cropSize,
            0, 0, targetSize, targetSize
          );

          // Attempt WebP output first, fall back to JPEG if browser doesn't support WebP export
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                canvas.toBlob(
                  (fallbackBlob) => {
                    if (fallbackBlob) resolve(fallbackBlob);
                    else reject(new Error('Failed to compress image.'));
                  },
                  'image/jpeg',
                  0.88
                );
              }
            },
            'image/webp',
            0.88
          );
        } catch (err) {
          reject(err);
        }
      };

      img.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Extracts the storage file path from a full public Supabase storage URL.
 * e.g. ".../avatars/user-uuid/avatar-12345.webp" -> "user-uuid/avatar-12345.webp"
 * @param {string} url
 * @returns {string|null}
 */
export function extractStoragePathFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const marker = `/${BUCKET_NAME}/`;
  const idx = url.indexOf(marker);
  if (idx !== -1) {
    const rawPath = url.substring(idx + marker.length);
    // Strip query parameters if present (e.g. ?t=...)
    return rawPath.split('?')[0];
  }
  return null;
}

/**
 * Fetches the user profile record from the database.
 * @param {string} userId
 * @returns {Promise<any>}
 */
export async function fetchUserProfile(userId) {
  if (!userId) return null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.warn('[ProfileService] Error fetching profile:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('[ProfileService] Exception fetching profile:', err);
    return null;
  }
}

/**
 * Uploads a profile avatar image to Supabase Storage,
 * updates the database profile and user metadata, and returns the new public URL.
 * @param {File} file Selected image file
 * @param {any} [userDataServiceInstance=null]
 * @returns {Promise<{ success: boolean, avatarUrl?: string, error?: string }>}
 */
export async function uploadAvatar(file, userDataServiceInstance = null) {
  try {
    // 1. Verify user session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session || !session.user) {
      return { success: false, error: 'You must be signed in to change your profile picture.' };
    }

    const userId = session.user.id;

    // 2. Validate file
    const validation = validateImageFile(file);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // 3. Client-side square crop and compression
    let processedBlob;
    try {
      processedBlob = await cropAndResizeToSquare(file, TARGET_AVATAR_SIZE);
    } catch (cropErr) {
      console.error('[ProfileService] Image processing error:', cropErr);
      return { success: false, error: 'Unable to process image. Please try a different image.' };
    }

    // 4. Construct unique user-isolated file path: avatars/{user_id}/avatar-{timestamp}.webp
    const timestamp = Date.now();
    const filePath = `${userId}/avatar-${timestamp}.webp`;

    // 5. Check if user already has an existing avatar to clean up after upload
    let oldAvatarUrl = null;
    if (userDataServiceInstance?.cachedData?.profile?.avatar_url) {
      oldAvatarUrl = userDataServiceInstance.cachedData.profile.avatar_url;
    } else {
      const existingProfile = await fetchUserProfile(userId);
      oldAvatarUrl = existingProfile?.avatar_url || session.user.user_metadata?.avatar_url || null;
    }

    // 6. Upload processed image to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, processedBlob, {
        contentType: processedBlob.type || 'image/webp',
        upsert: true
      });

    if (uploadError) {
      console.error('[ProfileService] Storage upload error:', uploadError);

      if (uploadError.message?.includes('Bucket not found')) {
        return {
          success: false,
          error: "Storage bucket 'avatars' is not configured yet. Please run migration 002_avatar_storage.sql in the Supabase SQL editor."
        };
      }
      if (uploadError.message?.includes('row-level security') || uploadError.message?.includes('policy')) {
        return {
          success: false,
          error: "Storage permission error. Please run migration 002_avatar_storage.sql to configure avatar storage policies."
        };
      }

      return { success: false, error: "Couldn't upload your profile picture. Please try again." };
    }

    // 7. Get public URL for the uploaded avatar
    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filePath);

    const publicUrl = urlData?.publicUrl || null;
    if (!publicUrl) {
      return { success: false, error: 'Could not obtain image URL after upload.' };
    }

    // 8. Update database profile record
    const { error: dbError } = await supabase
      .from('profiles')
      .update({
        avatar_url: publicUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (dbError) {
      console.error('[ProfileService] Database profile update error:', dbError);
      return {
        success: false,
        error: 'Profile picture uploaded, but profile update failed in database.'
      };
    }

    // 9. Update Supabase Auth user metadata
    try {
      await supabase.auth.updateUser({
        data: { avatar_url: publicUrl }
      });
    } catch (metaErr) {
      console.warn('[ProfileService] Warning updating user_metadata:', metaErr);
    }

    // 10. Update in-memory cache in userDataService if present
    if (userDataServiceInstance?.cachedData?.profile) {
      userDataServiceInstance.cachedData.profile.avatar_url = publicUrl;
    }

    // 11. Clean up old avatar from storage (safe post-cleanup)
    if (oldAvatarUrl && oldAvatarUrl !== publicUrl) {
      const oldStoragePath = extractStoragePathFromUrl(oldAvatarUrl);
      if (oldStoragePath && oldStoragePath.startsWith(userId + '/')) {
        try {
          await supabase.storage.from(BUCKET_NAME).remove([oldStoragePath]);
        } catch (cleanupErr) {
          console.warn('[ProfileService] Old avatar cleanup warning (non-fatal):', cleanupErr);
        }
      }
    }

    return { success: true, avatarUrl: publicUrl };
  } catch (err) {
    console.error('[ProfileService] Unexpected error in uploadAvatar:', err);
    return {
      success: false,
      error: !navigator.onLine
        ? "You're offline. Please try again when you're connected."
        : "Couldn't upload your profile picture. Please try again."
    };
  }
}

/**
 * Removes the current user's profile avatar.
 * Resets database avatar_url, user metadata, and deletes the image file from storage.
 * @param {any} [userDataServiceInstance=null]
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function removeAvatar(userDataServiceInstance = null) {
  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session || !session.user) {
      return { success: false, error: 'You must be signed in to remove your profile picture.' };
    }

    const userId = session.user.id;

    // Get current avatar URL to delete from storage
    let currentAvatarUrl = null;
    if (userDataServiceInstance?.cachedData?.profile?.avatar_url) {
      currentAvatarUrl = userDataServiceInstance.cachedData.profile.avatar_url;
    } else {
      const profile = await fetchUserProfile(userId);
      currentAvatarUrl = profile?.avatar_url || session.user.user_metadata?.avatar_url || null;
    }

    // 1. Reset avatar_url in database profiles table
    const { error: dbError } = await supabase
      .from('profiles')
      .update({
        avatar_url: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (dbError) {
      console.error('[ProfileService] Error clearing avatar in database:', dbError);
      return { success: false, error: 'Failed to remove profile picture from database.' };
    }

    // 2. Reset user_metadata avatar_url
    try {
      await supabase.auth.updateUser({
        data: { avatar_url: null }
      });
    } catch (metaErr) {
      console.warn('[ProfileService] Warning updating user_metadata on remove:', metaErr);
    }

    // 3. Update in-memory cache in userDataService
    if (userDataServiceInstance?.cachedData?.profile) {
      userDataServiceInstance.cachedData.profile.avatar_url = null;
    }

    // 4. Delete the file from storage if present
    if (currentAvatarUrl) {
      const storagePath = extractStoragePathFromUrl(currentAvatarUrl);
      if (storagePath && storagePath.startsWith(userId + '/')) {
        try {
          await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
        } catch (storageErr) {
          console.warn('[ProfileService] Storage removal warning:', storageErr);
        }
      }
    }

    return { success: true };
  } catch (err) {
    console.error('[ProfileService] Unexpected error in removeAvatar:', err);
    return {
      success: false,
      error: !navigator.onLine
        ? "You're offline. Please try again when you're connected."
        : "Failed to remove profile picture. Please try again."
    };
  }
}
