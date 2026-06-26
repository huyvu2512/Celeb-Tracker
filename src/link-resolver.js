/**
 * app-resolver.js — Module resolve link App.cam → invite link
 * 
 * Khi truy cập https://App.cam/{username}, trang trả về HTML tĩnh
 * chứa hàm openDynamicLink() với link invite đầy đủ dạng:
 *   app.page.link/?link=https%3A%2F%2FApp.camera%2Finvites%2F{TOKEN}%3Ftype%3DUsernameLink&...
 * 
 * Module này fetch HTML đó rồi parse ra invite URL + metadata.
 */

const { logInfo, logWarning, logError } = require('./utils');

/**
 * Resolve một link App.cam/{username} thành thông tin đầy đủ.
 * 
 * @param {string} appCamUrl - VD: "https://App.cam/cuecamfamily"
 * @returns {Promise<{invite_url: string, display_name: string, slot_limit: number|null, preview_images: string[]}|null>}
 *   Trả về null nếu không resolve được.
 */
async function resolveAppLink(appCamUrl) {
  logInfo(`  Đang resolve ${appCamUrl}...`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(appCamUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      logWarning(`  App page trả về status ${response.status} cho ${appCamUrl}`);
      return null;
    }

    const html = await response.text();

    // --- Trích xuất invite URL ---
    // Tìm trong hàm openDynamicLink() hoặc copyTextToClipboard()
    // Pattern: app.camera%2Finvites%2F{TOKEN}%3Ftype%3DUsernameLink
    const encodedTarget = Buffer.from('bG9ja2V0LmNhbWVyYQ==', 'base64').toString();
    const inviteMatch = html.match(new RegExp(`${encodedTarget}%2Finvites%2F([a-zA-Z0-9]+)%3Ftype%3DUsernameLink`));
    let inviteUrl = null;
    if (inviteMatch) {
      const token = inviteMatch[1];
      inviteUrl = `https://${encodedTarget}/invites/${token}?type=UsernameLink`;
    } else {
      // Backup: tìm link dạng đã decode
      const inviteMatch2 = html.match(new RegExp(`${encodedTarget}/invites/([a-zA-Z0-9]+)\\?type=UsernameLink`));
      if (inviteMatch2) {
        inviteUrl = `https://${encodedTarget}/invites/${inviteMatch2[1]}?type=UsernameLink`;
      }
    }

    if (!inviteUrl) {
      logWarning(`  Không tìm thấy invite URL trong HTML của ${appCamUrl}`);
      return null;
    }

    // --- Trích xuất display name từ <title> ---
    // Pattern: "Add Gia đình on App 💛"
    let displayName = null;
    const targetName = Buffer.from('bG9ja2V0', 'base64').toString();
    const titleMatch = html.match(new RegExp(`<title>Add (.+?) on ${targetName}`, 'i'));
    if (titleMatch) {
      displayName = titleMatch[1].trim();
    } else {
      // Backup: tìm trong og:title
      const ogTitleMatch = html.match(new RegExp(`og:title" content="Add (.+?) on ${targetName}`, 'i'));
      if (ogTitleMatch) {
        displayName = ogTitleMatch[1].trim();
      }
    }

    // --- Trích xuất slot limit ---
    // Pattern: "can only add 2,000 friends"
    let slotLimit = null;
    const slotMatch = html.match(/can only add\s*<span[^>]*>([0-9,]+)<\/span>\s*friends/i);
    if (slotMatch) {
      slotLimit = parseInt(slotMatch[1].replace(/,/g, ''), 10);
    }

    // --- Trích xuất preview images ---
    let previewImages = [];
    const imagesMatch = html.match(/celebrityImages\s*=\s*\[([^\]]+)\]/);
    if (imagesMatch) {
      try {
        previewImages = JSON.parse(`[${imagesMatch[1]}]`);
      } catch (e) {
        // Bỏ qua nếu parse thất bại
      }
    }

    logInfo(`  → Invite URL: ${inviteUrl}`);
    logInfo(`  → Display name: ${displayName || '(không rõ)'}`);
    logInfo(`  → Slot limit: ${slotLimit || '(không rõ)'}`);

    return {
      invite_url: inviteUrl,
      display_name: displayName,
      slot_limit: slotLimit,
      preview_images: previewImages,
    };
  } catch (err) {
    logError(`  Lỗi khi resolve ${appCamUrl}: ${err.message}`);
    return null;
  }
}

module.exports = {
  resolveAppLink,
};
