const puppeteer = require('puppeteer');
const { logInfo, logWarning } = require('./utils');

/**
 * Lấy bài viết từ Facebook Page bằng Puppeteer
 * @param {string} pageId 
 * @param {number} limit 
 * @returns {Array} 
 */
async function fetchFacebookPosts(pageId, limit = 3) {
  logInfo(`[Facebook] Đang quét page facebook.com/${pageId}...`);
  let browser = null;
  
  try {
    browser = await puppeteer.launch({ 
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    // Giả lập user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    await page.goto(`https://www.facebook.com/${pageId}`, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Tiêm CSS ẩn popup login
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.innerHTML = `
        div[role="dialog"], 
        div[aria-label="Đăng nhập vào Facebook"],
        #login_popup_cta_form,
        .x1n2onr6.x1ja2u2z.x1afcbsf {
          display: none !important;
        }
        body {
          overflow: auto !important;
        }
      `;
      document.head.appendChild(style);
    });
    
    // Cuộn trang vài lần để tải post
    for (let i = 0; i < limit + 1; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await new Promise(r => setTimeout(r, 1500));
    }
    
    const posts = await page.evaluate(() => {
      const articles = document.querySelectorAll('div[role="article"]');
      const results = [];
      
      articles.forEach(article => {
        const text = article.innerText || '';
        
        // Tìm link bài viết để làm code
        const links = Array.from(article.querySelectorAll('a'));
        let postUrl = '';
        for (const link of links) {
          if (link.href.includes('/posts/') || link.href.includes('fbid=')) {
            postUrl = link.href.split('?')[0];
            break;
          }
        }
        
        if (text && text.includes('Locket')) {
          let code = '';
          if (postUrl) {
            const match = postUrl.match(/posts\/([^/?]+)/);
            code = match ? match[1] : btoa(postUrl).substring(0, 15);
          } else {
            code = btoa(text.substring(0, 30)).substring(0, 15); // Fallback code
          }
          
          results.push({
            code: code,
            storyUrl: postUrl,
            text: text
          });
        }
      });
      
      // Xóa trùng lặp theo code
      const unique = [];
      const seen = new Set();
      for (const p of results) {
        if (!seen.has(p.code)) {
          seen.add(p.code);
          unique.push(p);
        }
      }
      return unique;
    });
    
    logInfo(`[Facebook] Tìm thấy ${posts.length} bài viết hợp lệ (có chứa chữ Locket).`);
    
    // Chuyển đổi định dạng cho giống với kết quả cũ
    const formattedPosts = posts.slice(0, limit).map(p => ({
      code: p.code,
      source: 'facebook',
      taken_at: Math.floor(Date.now() / 1000), // Không lấy được giờ chính xác, dùng giờ hiện tại
      author: pageId,
      storyUrl: p.storyUrl,
      // Lưu toàn bộ nội dung text vào caption để hệ thống tự extract link
      caption: p.text,
      comments: [] // Các comment thường hiển thị thẳng trên UI desktop
    }));
    
    return formattedPosts;
  } catch (error) {
    logWarning(`[Facebook] Lỗi quét facebook.com/${pageId}: ${error.message}`);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Lấy chi tiết bài viết (caption, bình luận). 
 * Vì Puppeteer đã lấy được toàn bộ text ở trên, hàm này chỉ trả về dữ liệu đã lấy (fake detail).
 */
async function fetchFacebookPostDetails(storyUrl, pageId) {
  // Trả về một object rỗng, logic extract link sẽ xử lý text trong caption ở trên
  return {
    caption: "",
    replies: []
  };
}

module.exports = {
  fetchFacebookPosts,
  fetchFacebookPostDetails
};
