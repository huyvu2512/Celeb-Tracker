/**
 * fb-scraper.js — Module quét bài viết từ Facebook Page
 * 
 * Sử dụng mbasic.facebook.com (phiên bản HTML cơ bản) để quét
 * bài viết công khai mà không cần API key hay đăng nhập.
 * Quét cả bài viết lẫn bình luận để tìm link locket.cam.
 */

const { logInfo, logWarning, logError } = require('./utils');

const REQUEST_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 30 * 1000; // Cache 30 giây

const FB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
  'Cache-Control': 'no-cache',
};

// Cache chi tiết bài viết (tránh fetch lại liên tục trong vòng 5 phút)
const fbPostDetailsCache = new Map();

// ============================================================
// Helpers
// ============================================================

async function fetchMbasicPage(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: FB_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Facebook HTTP ${res.status} for ${url}`);
    return res.text();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Facebook timeout (${REQUEST_TIMEOUT_MS / 1000}s) for ${url}`);
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Giải mã HTML entities */
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Chuyển HTML thành text thuần (giữ lại URL) */
function htmlToText(html) {
  // Trích xuất href từ thẻ <a> trước khi strip tag
  // Facebook wrap link trong redirect: /l.php?u=https://locket.cam/xxx
  let text = html.replace(/<a[^>]*href="([^"]*)"[^>]*>[^<]*<\/a>/gi, (_, href) => {
    // Decode Facebook redirect URL
    const urlMatch = href.match(/[?&]u=([^&]+)/);
    if (urlMatch) {
      return ' ' + decodeURIComponent(urlMatch[1]) + ' ';
    }
    return ' ' + href + ' ';
  });

  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ============================================================
// API công khai
// ============================================================

/**
 * Quét trang Facebook Page để lấy danh sách bài viết gần nhất.
 * 
 * @param {string} pageId - Vanity URL hoặc ID page (VD: "locketwidgetvn")
 * @param {number} limit - Số bài tối đa cần lấy
 * @returns {Promise<Array<{code: string, fbid: string, storyUrl: string, source: string, author: string}>>}
 */
async function fetchFacebookPosts(pageId, limit = 3) {
  logInfo(`[Facebook] Đang quét page facebook.com/${pageId}...`);

  const url = `https://mbasic.facebook.com/${pageId}`;
  const html = await fetchMbasicPage(url);
  const decoded = decodeEntities(html);

  const posts = [];

  // Tìm tất cả link bài viết trên page
  // Pattern 1: /story.php?story_fbid=XXX&id=YYY
  // Pattern 2: /pagename/posts/XXX
  // Pattern 3: /permalink.php?story_fbid=XXX&id=YYY
  const patterns = [
    /href="(\/story\.php\?story_fbid=(pfbid[^&"]+|\d+)&id=[^"]+)"/g,
    /href="(\/permalink\.php\?story_fbid=(pfbid[^&"]+|\d+)&id=[^"]+)"/g,
    /href="(\/[^/"]+\/posts\/(\d+)[^"]*)"/g,
  ];

  for (const regex of patterns) {
    let m;
    while ((m = regex.exec(decoded)) !== null) {
      const rawUrl = m[1];
      const postId = m[2];
      if (postId && !posts.some(p => p.fbid === postId)) {
        posts.push({
          code: `fb_${postId}`,
          fbid: postId,
          storyUrl: rawUrl.startsWith('http') ? rawUrl : `https://mbasic.facebook.com${rawUrl}`,
          caption: '',
          source: 'facebook',
          author: pageId,
          taken_at: 0,
        });
      }
    }
  }

  const limited = posts.slice(0, limit);
  logInfo(`[Facebook] Tìm thấy ${posts.length} bài viết, chọn ${limited.length} bài mới nhất`);
  return limited;
}

/**
 * Quét chi tiết 1 bài Facebook (bài viết + TẤT CẢ bình luận).
 * Trả về toàn bộ text để tìm link locket.cam.
 * 
 * @param {string} storyUrl - URL bài viết trên mbasic.facebook.com
 * @param {string} pageId - ID page
 * @returns {Promise<{caption: string, author: string, taken_at: number, replies: Array}>}
 */
async function fetchFacebookPostDetails(storyUrl, pageId) {
  // Kiểm tra cache
  const cached = fbPostDetailsCache.get(storyUrl);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    logInfo(`  [FB CACHE] Dùng cache (${Math.round((Date.now() - cached.cachedAt) / 1000)}s tuổi)`);
    return cached.data;
  }

  logInfo(`  [Facebook] Đang quét chi tiết bài viết + bình luận...`);

  const html = await fetchMbasicPage(storyUrl);
  const decoded = decodeEntities(html);

  // Chuyển HTML thành text (bao gồm giải mã redirect URL của Facebook)
  const fullText = htmlToText(decoded);

  // Log tóm tắt
  const shortText = fullText.substring(0, 200).replace(/\n/g, ' ');
  logInfo(`  [Facebook] → Nội dung: ${shortText.substring(0, 80)}...`);

  // Đếm bình luận (ước lượng theo HTML pattern)
  const commentCount = (html.match(/comment_body|<h3[^>]*>.*?<\/h3>\s*<div/gi) || []).length;
  logInfo(`  [Facebook] → ~${commentCount} bình luận phát hiện`);

  const result = {
    caption: fullText, // Toàn bộ text (bài viết + bình luận) để extractAppCamLinks tìm link
    author: pageId,
    taken_at: 0,
    replies: [], // Bình luận đã nằm trong fullText (mbasic render tất cả trên 1 trang)
  };

  // Lưu cache
  fbPostDetailsCache.set(storyUrl, { data: result, cachedAt: Date.now() });

  return result;
}

module.exports = {
  fetchFacebookPosts,
  fetchFacebookPostDetails,
};
