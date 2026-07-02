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
        
        if (text) {
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
    
    logInfo(`[Facebook] Tìm thấy ${posts.length} bài viết trên timeline.`);
    
    // Chuyển đổi định dạng cho giống với kết quả cũ
    const formattedPosts = posts.slice(0, limit).map(p => ({
      code: p.code,
      source: 'facebook',
      taken_at: Math.floor(Date.now() / 1000), // Không lấy được giờ chính xác, dùng giờ hiện tại
      author: pageId,
      storyUrl: p.storyUrl,
      // Lưu nội dung preview vào caption. Comment sẽ được lấy chi tiết ở hàm sau.
      caption: p.text,
      comments: [] 
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
 */
async function fetchFacebookPostDetails(storyUrl, pageId) {
  if (!storyUrl) return { caption: "", replies: [] };
  
  // Ép dùng m.facebook.com để giảm thiểu bị Facebook chặn hiển thị comment khi không đăng nhập
  storyUrl = storyUrl.replace('www.facebook.com', 'm.facebook.com');
  
  logInfo(`[Facebook] Đang lấy chi tiết bài viết và bình luận: ${storyUrl}`);
  let browser = null;
  
  try {
    browser = await puppeteer.launch({ 
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    // Mở rộng viewport để innerText không bị ngắt dòng URL
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Dùng domcontentloaded thay vì networkidle2 để tránh bị script FB phát hiện và redirect sang trang login
    await page.goto(storyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Đợi 8 giây để Facebook load xong bình luận qua AJAX 
    await new Promise(r => setTimeout(r, 3000));
    
    // Lấy toàn bộ chữ trên trang.
    const fullText = await page.evaluate(() => document.body.innerText);
    
    return {
      caption: fullText,
      replies: []
    };
  } catch (error) {
    logWarning(`[Facebook] Lỗi lấy chi tiết post ${storyUrl}: ${error.message}`);
    return { caption: "", replies: [] };
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = {
  fetchFacebookPosts,
  fetchFacebookPostDetails
};
