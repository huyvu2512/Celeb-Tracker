/**
 * utils.js — Hàm tiện ích cho Celeb Locket Tracker
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
 * Tìm tất cả link locket.cam/{username} trong text
 * @param {string} text
 * @returns {string[]} Mảng các URL locket.cam tìm thấy
 */
function extractLocketCamLinks(text) {
  if (!text) return [];
  const regex = /https?:\/\/locket\.cam\/([a-zA-Z0-9_.]+)/gi;
  const matches = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push(match[0]);
  }
  return [...new Set(matches)]; // Loại bỏ trùng lặp
}

/**
 * Trích xuất username từ link locket.cam
 * VD: "https://locket.cam/cuecamfamily" → "cuecamfamily"
 * @param {string} url
 * @returns {string|null}
 */
function extractUsernameFromLocketUrl(url) {
  const match = url.match(/https?:\/\/locket\.cam\/([a-zA-Z0-9_.]+)/i);
  return match ? match[1] : null;
}

/**
 * Trích xuất tên hiển thị (display name) từ bài viết Threads
 * VD: "Chào mừng Gia đình Truyền Hình gia nhập Locket Creators!" -> "Gia đình Truyền Hình"
 * @param {string} text
 * @returns {string|null}
 */
function extractDisplayNameFromText(text) {
  if (!text) return null;
  // Match "Chào mừng {Tên} gia nhập Locket Creators/Celebrity/Celeb"
  const match = text.match(/Chào mừng\s+(.+?)\s+gia nhập\s+Locket/i);
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
    const content = fs.readFileSync(filePath, 'utf8');
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

function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
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
  const token = process.env.TELEGRAM_BOT_TOKEN || '8530810458:AAGNic4qivzM5J1TYVAxBJzE3TgGoRcyAl8';
  const chatId = process.env.TELEGRAM_CHAT_ID || '6130572618';

  if (!token || !chatId) {
    logWarning('Không có TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID. Bỏ qua gửi thông báo Telegram.');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: message,
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

function extractDropTime(text) {
  if (!text) return null;
  text = text.toLowerCase();

  const timeRegex = /(?:lúc|vào|khoảng|tới)?\s*(\d{1,2})(?:h|g|:)(\d{2})?\s*(sáng|trưa|chiều|tối)?/i;
  const match = text.match(timeRegex);

  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3] || ''; 

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
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    // Nếu giờ trích xuất đã qua so với giờ hiện tại (VD: hiện tại 22h, tìm thấy 9h sáng), 
    // có thể đó là giờ của ngày mai.
    // Tạm thời, cứ lấy giờ trong ngày hôm nay. Nếu nhỏ hơn giờ hiện tại > 2 tiếng thì cộng thêm 1 ngày.
    if (d.getTime() < Date.now() - 2 * 60 * 60 * 1000) {
       d.setDate(d.getDate() + 1);
    }
    return d.toISOString();
  }

  return null;
}

module.exports = {
  THREADS_HEADERS,
  extractLocketCamLinks,
  extractUsernameFromLocketUrl,
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
  extractDropTime,
  DATA_DIR,
};
