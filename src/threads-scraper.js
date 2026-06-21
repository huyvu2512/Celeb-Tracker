/**
 * threads-scraper.js — Module quét dữ liệu từ Threads
 * 
 * Sử dụng phương pháp SSR HTML parsing: fetch trang HTML rồi parse
 * JSON nhúng trong thẻ <script data-sjs> mà Threads server-render sẵn.
 * Không cần đăng nhập, không cần Playwright, không cần API key.
 */

const { THREADS_HEADERS, logInfo, logWarning, logError, delay } = require('./utils');

// ============================================================
// Helpers nội bộ
// ============================================================

/**
 * Fetch HTML từ Threads với headers giả lập Chrome.
 * @param {string} url
 * @returns {Promise<string>} HTML string
 */
async function fetchThreadsPage(url) {
  const response = await fetch(url, {
    headers: THREADS_HEADERS,
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText} for ${url}`);
  }

  return response.text();
}

/**
 * Parse tất cả JSON payload từ thẻ <script data-sjs> trong HTML.
 * @param {string} html 
 * @returns {object[]} Mảng các object JSON đã parse
 */
function parseSSRJsonBlocks(html) {
  const results = [];
  const marker = 'data-sjs>';
  let idx = 0;

  while (true) {
    const start = html.indexOf(marker, idx);
    if (start === -1) break;
    const jsonStart = start + marker.length;
    const end = html.indexOf('</script>', jsonStart);
    if (end === -1) break;

    const content = html.substring(jsonStart, end);
    try {
      results.push(JSON.parse(content));
    } catch (e) {
      // Một số script block không phải JSON hợp lệ, bỏ qua
    }
    idx = end + 9;
  }

  return results;
}

/**
 * Duyệt đệ quy object để tìm tất cả mảng "thread_items".
 * @param {any} obj 
 * @param {Array[]} results 
 * @returns {Array[]}
 */
function findThreadItems(obj, results = []) {
  if (!obj || typeof obj !== 'object') return results;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      findThreadItems(item, results);
    }
  } else {
    if (obj.thread_items && Array.isArray(obj.thread_items)) {
      results.push(obj.thread_items);
    }
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        findThreadItems(obj[key], results);
      }
    }
  }
  return results;
}

/**
 * Duyệt đệ quy object để tìm tất cả post object (có caption).
 * Dùng cho trang chi tiết bài viết, nơi các reply được lồng sâu.
 * @param {any} obj 
 * @param {object[]} results
 * @returns {object[]}
 */
function findAllPosts(obj, results = []) {
  if (!obj || typeof obj !== 'object') return results;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      findAllPosts(item, results);
    }
  } else {
    if (obj.post && obj.post.caption && obj.post.user) {
      results.push(obj.post);
    }
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        findAllPosts(obj[key], results);
      }
    }
  }
  return results;
}

// ============================================================
// API công khai
// ============================================================

/**
 * Quét trang profile Threads để lấy danh sách bài viết gần nhất.
 * 
 * @param {string} username - Tên tài khoản Threads (VD: "appcameravn")
 * @returns {Promise<Array<{code: string, pk: string, caption: string, taken_at: number}>>}
 */
async function fetchProfilePosts(username) {
  logInfo(`Đang quét profile @${username}...`);

  const url = `https://www.threads.net/@${username}`;
  const html = await fetchThreadsPage(url);

  const jsonBlocks = parseSSRJsonBlocks(html);
  const allThreadItems = [];

  for (const block of jsonBlocks) {
    findThreadItems(block, allThreadItems);
  }

  // Trích xuất thông tin từ thread_items
  const posts = [];
  const seenCodes = new Set();

  for (const threadItemsList of allThreadItems) {
    for (const item of threadItemsList) {
      const post = item.post;
      if (!post || !post.code) continue;

      // Bỏ qua nếu đã thấy post code này (tránh trùng lặp)
      if (seenCodes.has(post.code)) continue;
      seenCodes.add(post.code);

      posts.push({
        code: post.code,
        pk: post.pk,
        caption: post.caption?.text || '',
        taken_at: post.taken_at || 0,
        author: post.user?.username || username,
      });
    }
  }

  logInfo(`Tìm thấy ${posts.length} bài viết trên profile @${username}`);
  return posts;
}

/**
 * Quét chi tiết một bài viết cụ thể, bao gồm caption và tất cả bình luận.
 * 
 * @param {string} username - Tên tài khoản (VD: "appcameravn")
 * @param {string} postCode - Mã bài viết (VD: "DZaG6ENmArc")
 * @returns {Promise<{caption: string, author: string, replies: Array<{author: string, text: string, pk: string}>}>}
 */
async function fetchPostDetails(username, postCode) {
  logInfo(`  Đang quét chi tiết post ${postCode}...`);

  const url = `https://www.threads.net/@${username}/post/${postCode}`;
  const html = await fetchThreadsPage(url);

  const jsonBlocks = parseSSRJsonBlocks(html);

  // Tìm tất cả post objects (bao gồm bài viết gốc + replies)
  const allPosts = [];
  for (const block of jsonBlocks) {
    findAllPosts(block, allPosts);
  }

  // Bài viết gốc (do username đăng, có code trùng với postCode)
  let mainCaption = '';
  let mainAuthor = username;
  let mainTakenAt = 0;
  const replies = [];
  const seenPks = new Set();

  for (const post of allPosts) {
    const postAuthor = post.user?.username || '';
    const postText = post.caption?.text || '';
    const postPk = post.pk || '';
    const postCode2 = post.code || '';
    const postTakenAt = post.taken_at || 0;

    // Bỏ qua nếu đã thấy PK này
    if (seenPks.has(postPk)) continue;
    seenPks.add(postPk);

    // Phân biệt bài viết gốc vs bình luận
    if (postCode2 === postCode) {
      mainCaption = postText;
      mainAuthor = postAuthor;
      mainTakenAt = postTakenAt;
    } else {
      replies.push({
        author: postAuthor,
        text: postText,
        pk: postPk,
      });
    }
  }

  logInfo(`  → Caption: ${mainCaption.substring(0, 80).replace(/\n/g, ' ')}...`);
  logInfo(`  → ${replies.length} bình luận tìm thấy`);

  return {
    caption: mainCaption,
    author: mainAuthor,
    taken_at: mainTakenAt,
    replies,
  };
}

/**
 * Mở trình duyệt ẩn, cuộn chuột liên tục để lấy MỌI post code trên profile.
 * Dùng cho lần quét đầu tiên khi data chưa có.
 */
async function fetchAllProfilePostsViaPuppeteer(username) {
  logInfo(`[Full Scan] Đang khởi động Puppeteer để cào sạch bài viết của @${username}...`);
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    logError("Thư viện puppeteer chưa được cài đặt. Chạy lệnh: npm install puppeteer");
    return [];
  }

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  
  try {
    const page = await browser.newPage();
    // Giả lập User Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
    
    await page.goto(`https://www.threads.net/@${username}`, { waitUntil: 'networkidle2' });

    let previousHeight;
    let noChangeCount = 0;
    
    logInfo("  Đang cuộn chuột liên tục để tải thêm bài viết...");
    while (true) {
      previousHeight = await page.evaluate('document.body.scrollHeight');
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await delay(2000); // Chờ mạng tải bài mới
      
      const newHeight = await page.evaluate('document.body.scrollHeight');
      if (newHeight === previousHeight) {
        noChangeCount++;
        if (noChangeCount >= 3) {
          break; // Đã đến đáy (cuộn 3 lần không thấy thêm bài)
        }
      } else {
        noChangeCount = 0;
      }
    }

    // Lấy tất cả các mã bài viết
    const postCodes = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/post/"]'));
      const codes = links.map(a => {
        const match = a.getAttribute('href').match(/\/post\/([A-Za-z0-9_-]+)/);
        return match ? match[1] : null;
      });
      return Array.from(new Set(codes.filter(c => c))); // Xóa trùng lặp
    });

    logInfo(`  Đã kéo đến đáy trang! Tổng cộng tóm được ${postCodes.length} bài viết.`);
    
    // Convert sang mảng posts (thiếu caption/taken_at nhưng không sao vì sẽ tự gọi chi tiết sau)
    return postCodes.map(code => ({
      code: code,
      pk: '',
      caption: '',
      taken_at: 0,
      author: username,
    }));

  } finally {
    await browser.close();
  }
}

module.exports = {
  fetchProfilePosts,
  fetchPostDetails,
  fetchAllProfilePostsViaPuppeteer
};
