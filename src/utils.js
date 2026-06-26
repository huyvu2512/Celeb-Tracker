/**
 * utils.js — Hàm tiện ích cho Celeb Tracker
 */

const path = require('path');
const fs = require('fs');

// ============================================================
// HTTP Headers giả lập Chrome để fetch Threads không bị chặn
// ============================================================
const THREADS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
  'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'X-Asbd-Id': '129477',
  'X-Ig-App-Id': '238260118697367',
};

// ============================================================
// Regex helpers
// ============================================================

/**
 * Tìm tất cả link App.cam/{username} trong text
 * @param {string} text
 * @returns {string[]} Mảng các URL App.cam tìm thấy
 */
function extractAppCamLinks(text) {
  if (!text) return [];
  const matches = [];

  // 1. Dạng link ngắn: locket.cam/[username]
  const regex1 = new RegExp(`(?:https?://)?${Buffer.from('bG9ja2V0LmNhbQ==', 'base64').toString()}/([a-zA-Z0-9_.]+)`, 'gi');
  let match;
  while ((match = regex1.exec(text)) !== null) {
    const url = match[0].startsWith('http') ? match[0] : `https://${match[0]}`;
    matches.push(url);
  }

  // 2. Dạng link trực tiếp: locket.camera/invites/[token]?type=UsernameLink
  const regex2 = new RegExp(`(?:https?://)?${Buffer.from('bG9ja2V0LmNhbWVyYQ==', 'base64').toString()}/invites/([a-zA-Z0-9_]+)(\\?type=UsernameLink)?`, 'gi');
  while ((match = regex2.exec(text)) !== null) {
    const url = match[0].startsWith('http') ? match[0] : `https://${match[0]}`;
    matches.push(url);
  }

  return [...new Set(matches)]; // Loại bỏ trùng lặp
}

/**
 * Trích xuất username từ link App.cam
 * VD: "https://App.cam/cuecamfamily" → "cuecamfamily"
 * @param {string} url
 * @returns {string|null}
 */
function extractUsernameFromAppUrl(url) {
  const match = url.match(new RegExp(`https?://${Buffer.from('bG9ja2V0LmNhbQ==', 'base64').toString()}/([a-zA-Z0-9_.]+)`, 'i'));
  return match ? match[1] : null;
}

/**
 * Trích xuất tên hiển thị (display name) từ bài viết Threads
 * VD: "Chào mừng Gia đình Truyền Hình gia nhập App Creators!" -> "Gia đình Truyền Hình"
 * @param {string} text
 * @returns {string|null}
 */
function extractDisplayNameFromText(text) {
  if (!text) return null;
  // Match "Chào mừng {Tên} gia nhập App Creators/Celebrity/Celeb"
  const match = text.match(/Chào mừng\s+(.+?)\s+gia nhập\s+App/i);
  if (match) {
    return match[1].trim();
  }
  return null;
}

// ============================================================
// File I/O helpers
// ============================================================

const DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * Đọc file JSON, trả về object/array. Nếu file không tồn tại, trả về defaultValue.
 */
function readJsonFile(filename, defaultValue = null) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    // Strip BOM if present (PowerShell sometimes adds it)
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return defaultValue;
    }
    throw err;
  }
}

/**
 * Ghi object/array ra file JSON (đẹp, 2-space indent).
 */
function writeJsonFile(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  // Đảm bảo thư mục tồn tại
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ============================================================
// Logging helpers
// ============================================================

function getVnTimeISOString(date = new Date()) {
  const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vnTime.toISOString().replace('Z', '+07:00');
}

function log(message) {
  const formatted = getVnTimeISOString().replace('T', ' ');
  console.log(`[${formatted}] ${message}`);
}

function logSuccess(message) {
  log(`✅ ${message}`);
}

function logWarning(message) {
  log(`⚠️  ${message}`);
}

function logError(message) {
  log(`❌ ${message}`);
}

function logInfo(message) {
  log(`ℹ️  ${message}`);
}

// ============================================================
// Delay helper (tránh bị rate limit)
// ============================================================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// Telegram Notification Helper
// ============================================================

/**
 * Gửi thông báo qua Telegram
 * @param {string} text Nội dung tin nhắn (hỗ trợ HTML)
 * @param {object} replyMarkup Tùy chọn nút bấm inline
 */
async function sendTelegramMessage(text, replyMarkup = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    logWarning('Không có TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID. Bỏ qua gửi thông báo Telegram.');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };

    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = await response.json();
      logError(`Lỗi khi gửi Telegram: ${data.description}`);
      return false;
    }
    return true;
  } catch (error) {
    logError(`Lỗi kết nối Telegram: ${error.message}`);
    return false;
  }
}

// ============================================================
// HTTP Headers giả lập Chrome để fetch Threads không bị chặn
// ============================================================
const THREADS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
  'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'X-Asbd-Id': '129477',
  'X-Ig-App-Id': '238260118697367',
};

// ============================================================
// Regex helpers
// ============================================================

/**
 * Tìm tất cả link App.cam/{username} trong text
 * @param {string} text
 * @returns {string[]} Mảng các URL App.cam tìm thấy
 */
function extractAppCamLinks(text) {
  if (!text) return [];
  const matches = [];

  // 1. Dạng link ngắn: locket.cam/[username]
  const regex1 = new RegExp(`(?:https?://)?${Buffer.from('bG9ja2V0LmNhbQ==', 'base64').toString()}/([a-zA-Z0-9_.]+)`, 'gi');
  let match;
  while ((match = regex1.exec(text)) !== null) {
    const url = match[0].startsWith('http') ? match[0] : `https://${match[0]}`;
    matches.push(url);
  }

  // 2. Dạng link trực tiếp: locket.camera/invites/[token]?type=UsernameLink
  const regex2 = new RegExp(`(?:https?://)?${Buffer.from('bG9ja2V0LmNhbWVyYQ==', 'base64').toString()}/invites/([a-zA-Z0-9_]+)(\\?type=UsernameLink)?`, 'gi');
  while ((match = regex2.exec(text)) !== null) {
    const url = match[0].startsWith('http') ? match[0] : `https://${match[0]}`;
    matches.push(url);
  }

  return [...new Set(matches)]; // Loại bỏ trùng lặp
}

/**
 * Trích xuất username từ link App.cam
 * VD: "https://App.cam/cuecamfamily" → "cuecamfamily"
 * @param {string} url
 * @returns {string|null}
 */
function extractUsernameFromAppUrl(url) {
  const match = url.match(new RegExp(`https?://${Buffer.from('bG9ja2V0LmNhbQ==', 'base64').toString()}/([a-zA-Z0-9_.]+)`, 'i'));
  return match ? match[1] : null;
}

/**
 * Trích xuất tên hiển thị (display name) từ bài viết Threads
 * VD: "Chào mừng Gia đình Truyền Hình gia nhập App Creators!" -> "Gia đình Truyền Hình"
 * @param {string} text
 * @returns {string|null}
 */
function extractDisplayNameFromText(text) {
  if (!text) return null;
  // Match "Chào mừng {Tên} gia nhập App Creators/Celebrity/Celeb"
  const match = text.match(/Chào mừng\s+(.+?)\s+gia nhập\s+App/i);
  if (match) {
    return match[1].trim();
  }
  return null;
}

// ============================================================
// File I/O helpers
// ============================================================

const DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * Đọc file JSON, trả về object/array. Nếu file không tồn tại, trả về defaultValue.
 */
function readJsonFile(filename, defaultValue = null) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    // Strip BOM if present (PowerShell sometimes adds it)
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return defaultValue;
    }
    throw err;
  }
}

/**
 * Ghi object/array ra file JSON (đẹp, 2-space indent).
 */
function writeJsonFile(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  // Đảm bảo thư mục tồn tại
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ============================================================
// Logging helpers
// ============================================================

function getVnTimeISOString(date = new Date()) {
  const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vnTime.toISOString().replace('Z', '+07:00');
}

function log(message) {
  const formatted = getVnTimeISOString().replace('T', ' ');
  console.log(`[${formatted}] ${message}`);
}

function logSuccess(message) {
  log(`✅ ${message}`);
}

function logWarning(message) {
  log(`⚠️  ${message}`);
}

function logError(message) {
  log(`❌ ${message}`);
}

function logInfo(message) {
  log(`ℹ️  ${message}`);
}

// ============================================================
// Delay helper (tránh bị rate limit)
// ============================================================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// Telegram Notification Helper
// ============================================================

/**
 * Gửi thông báo qua Telegram
 * @param {string} text Nội dung tin nhắn (hỗ trợ HTML)
 * @param {object} replyMarkup Tùy chọn nút bấm inline
 */
async function sendTelegramMessage(text, replyMarkup = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    logWarning('Không có TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID. Bỏ qua gửi thông báo Telegram.');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };

    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = await response.json();
      logError(`Lỗi khi gửi Telegram: ${data.description}`);
      return false;
    }

    logSuccess("Đã gửi thông báo Telegram thành công!");
    return true;
  } catch (error) {
    logError(`Lỗi kết nối Telegram: ${error.message}`);
    return false;
  }
}

async function sendDiscordMessage(c, postTimeStr, sourceTextStr) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1519909882805878796/B6NwIodpJLbSBdtkPZ9ZIWlmUU8mf3jFqRDV1ni50jb_oxRhUcOABTc3etrLjRaq5FIr';
  if (!webhookUrl) return false;

  const fs = require('fs');
  const path = require('path');

  const isUpdate = c.is_update;
  const title = isUpdate ? '# LOCKET TĂNG SLOT CELEB!!!' : '# LOCKET CELEBRITY MỚI!!!';
  const slotText = c.slot_limit ? c.slot_limit.toLocaleString('en-US') : 'Không rõ';
  const url = c.invite_url || `https://locket.cam/${c.username}`;
  
  // Format lại postTimeStr "10:00:00 23/06/2026" thành "10:00 23/06/2026"
  const timeStr = postTimeStr.replace(/:(\d\d) /, ' ');

  const embed = {
    description: `${title}\n\u200B`,
    color: 0xFFD700,
    fields: [
      { name: '👤 Tên Celeb', value: `**${c.display_name}**`, inline: true },
      { name: '🎫 Số Slot', value: `**${slotText}**`, inline: true },
      { name: '\u200B', value: '\u200B', inline: true },
      { name: '🆔 Username', value: `\`@${c.username}\``, inline: true },
      { name: '📍 Nguồn', value: sourceTextStr, inline: true },
      { name: '\u200B', value: '\u200B', inline: true },
      { name: '🕒 Thời gian', value: timeStr, inline: false },
      { name: '\u200B', value: `**[🚀 KẾT BẠN NGAY TẠI ĐÂY 🚀](${url})**`, inline: false }
    ]
  };

  const logoPath = path.join(__dirname, '..', 'logo.png');
  if (fs.existsSync(logoPath)) {
    embed.thumbnail = { url: 'attachment://logo.png' };
  }

  const formData = new FormData();
  formData.append('payload_json', JSON.stringify({
    content: '@everyone',
    embeds: [embed]
  }));

  try {
    if (fs.existsSync(logoPath)) {
      const blob = new Blob([fs.readFileSync(logoPath)], { type: 'image/png' });
      formData.append('files[0]', blob, 'logo.png');
    }
  } catch(e) {}

  try {
    const response = await fetch(webhookUrl, { method: 'POST', body: formData });
    if (!response.ok) {
      logError(`Lỗi khi gửi Discord: ${response.statusText}`);
      return false;
    }
    logSuccess("Đã gửi thông báo Discord thành công!");
    return true;
  } catch (error) {
    logError(`Lỗi kết nối Discord: ${error.message}`);
    return false;
  }
}

async function sendDiscordAutoAddReport(c) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1519909882805878796/B6NwIodpJLbSBdtkPZ9ZIWlmUU8mf3jFqRDV1ni50jb_oxRhUcOABTc3etrLjRaq5FIr';
  if (!webhookUrl) return false;

  const fs = require('fs');
  const path = require('path');

  const slotText = c.slot_limit ? c.slot_limit.toLocaleString('en-US') : 'Không rõ';
  
  let status = '';
  let color = 0x808080;
  if (c.auto_add_results.success && c.auto_add_results.success.includes(c.username)) {
    status = '✅ **Đã kết bạn thành công!**';
    color = 0x00FF00;
  } else if (c.auto_add_results.full && c.auto_add_results.full.includes(c.username)) {
    status = '❌ **Thất bại (Hết Slot hoặc Xếp hàng)**';
    color = 0xFF0000;
  } else if (c.auto_add_results.skipped && c.auto_add_results.skipped.includes(c.username)) {
    status = '⚠️ **Đã là Bạn bè từ trước!**';
    color = 0xFFFF00;
  } else {
    return false; // Không gửi nếu không có status
  }

  const embed = {
    description: '# 🤖 AUTO KẾT BẠN\n\u200B',
    color: color,
    fields: [
      { name: '👤 Tên Celeb', value: `**${c.display_name}**`, inline: true },
      { name: '🎫 Số Slot', value: `**${slotText}**`, inline: true },
      { name: '\u200B', value: '\u200B', inline: true },
      { name: '🆔 Username', value: `\`@${c.username}\``, inline: true },
      { name: '👤 Tài khoản', value: 'Huy Vũ', inline: true },
      { name: '\u200B', value: '\u200B', inline: true },
      { name: '\u200B', value: status, inline: false }
    ]
  };

  const logoPath = path.join(__dirname, '..', 'logo.png');
  if (fs.existsSync(logoPath)) {
    embed.thumbnail = { url: 'attachment://logo.png' };
  }

  const formData = new FormData();
  formData.append('payload_json', JSON.stringify({
    content: '<@757121878904144013>',
    embeds: [embed]
  }));

  try {
    if (fs.existsSync(logoPath)) {
      const blob = new Blob([fs.readFileSync(logoPath)], { type: 'image/png' });
      formData.append('files[0]', blob, 'logo.png');
    }
  } catch(e) {}

  try {
    const response = await fetch(webhookUrl, { method: 'POST', body: formData });
    if (!response.ok) return false;
    return true;
  } catch (error) { return false; }
}

async function sendDiscordPrepMessage(timeStr, postUrl) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1519909882805878796/B6NwIodpJLbSBdtkPZ9ZIWlmUU8mf3jFqRDV1ni50jb_oxRhUcOABTc3etrLjRaq5FIr';
  if (!webhookUrl) return false;

  const embed = {
    description: `# ⏳ CHUẨN BỊ MỞ SLOT!\n\u200B\n⏱ **Thời gian dự kiến:** ${timeStr}\n\n**[🔗 XEM BÀI VIẾT THÔNG BÁO](${postUrl})**`,
    color: 0x3498DB
  };

  const formData = new FormData();
  formData.append('payload_json', JSON.stringify({
    content: '@everyone',
    embeds: [embed]
  }));

  try {
    const response = await fetch(webhookUrl, { method: 'POST', body: formData });
    return response.ok;
  } catch (error) {
    return false;
  }
}

function extractDropTime(text, takenAtMs = Date.now()) {
  if (!text) return null;
  text = text.toLowerCase();

  const timeRegex = /(?:lúc|vào|khoảng|tới)?\s*(\d{1,2})(?:h|g|:)(\d{2})?\s*(sáng|trưa|chiều|tối)?/gi;
  let matches = [...text.matchAll(timeRegex)];

  if (matches.length === 0) return null;

  const bestMatch = matches[matches.length - 1];

  let hour = parseInt(bestMatch[1], 10);
  const minute = bestMatch[2] ? parseInt(bestMatch[2], 10) : 0;
  const period = bestMatch[3] || '';

  if (period === 'chiều' || period === 'tối') {
    if (hour < 12) hour += 12;
  } else if (period === 'sáng') {
    if (hour === 12) hour = 0;
  } else if (period === 'trưa') {
    if (hour < 12 && hour >= 1) hour += 12;
  } else {
    if (hour >= 1 && hour <= 11) {
      if (!text.includes('sáng')) {
        hour += 12;
      }
    }
  }

  if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
    // Dùng thời gian đăng bài (takenAtMs) làm gốc để tính "hôm nay", thay vì Date.now()
    const baseDateVn = new Date(takenAtMs + 7 * 3600 * 1000).toISOString().split('T')[0];
    const isoStr = `${baseDateVn}T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00+07:00`;
    const d = new Date(isoStr);

    // Nếu giờ trích xuất < giờ đăng bài (kèm sai số 2h), nghĩa là họ đang nói đến ngày mai
    if (d.getTime() < takenAtMs - 2 * 60 * 60 * 1000) {
      d.setDate(d.getDate() + 1);
    }

    // Nếu giờ vàng ĐÃ TRÔI QUA so với HIỆN TẠI (VD bài hôm qua nói 21h hôm qua), thì bỏ qua luôn!
    if (d.getTime() <= Date.now()) {
      return null;
    }

    return d.toISOString();
  }

  return null;
}

module.exports = {
  THREADS_HEADERS,
  extractAppCamLinks,
  extractUsernameFromAppUrl,
  extractDisplayNameFromText,
  readJsonFile,
  writeJsonFile,
  log,
  logSuccess,
  logWarning,
  logError,
  logInfo,
  delay,
  sendTelegramMessage,
  sendDiscordMessage,
  sendDiscordAutoAddReport,
  sendDiscordPrepMessage,
  extractDropTime,
  getVnTimeISOString,
  DATA_DIR,
};
