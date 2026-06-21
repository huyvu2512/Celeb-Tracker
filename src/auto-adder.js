/**
 * auto-adder.js - Module tự động kết bạn trên Locket Dio
 */

const puppeteer = require('puppeteer');
const { logInfo, logError, logWarning, delay } = require('./utils');

async function autoAddFriends(newCelebs) {
  const email = process.env.L_DIO_EMAIL;
  const password = process.env.L_DIO_PASSWORD;

  if (!email || !password) {
    logWarning('⚠️ Bỏ qua Auto-Add: Không tìm thấy biến môi trường L_DIO_EMAIL hoặc L_DIO_PASSWORD.');
    return null; // Không cấu hình
  }

  if (!newCelebs || newCelebs.length === 0) {
    return null;
  }

  logInfo(`🚀 Khởi động Auto-Adder: Đang xử lý kết bạn cho ${newCelebs.length} celeb mới...`);
  
  const results = {
    success: [],
    full: [],
    error: []
  };

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-notifications']
  });

  const context = browser.defaultBrowserContext();
  await context.overridePermissions('https://locket-dio.com', []); // Chặn camera popup

  const page = await browser.newPage();

  try {
    logInfo('🌐 Truy cập trang đăng nhập locket-dio.com...');
    await page.goto('https://locket-dio.com/login', { waitUntil: 'networkidle2' });

    const emailInput = await page.$('input[type="email"]') || await page.$('input[placeholder*="email" i]');
    if (emailInput) {
      await emailInput.type(email);
    } else {
      await page.keyboard.type(email);
    }

    const passInput = await page.$('input[type="password"]');
    if (passInput) {
      await passInput.type(password);
    } else {
      await page.keyboard.press('Tab');
      await page.keyboard.type(password);
    }

    const loginBtn = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.find(b => b.textContent.includes('Đăng Nhập'));
    });
    
    if (loginBtn) {
      await loginBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }

    logInfo('⏳ Chờ load vào giao diện chính...');
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('người bạn'));
    }, { timeout: 15000 });

    for (const celeb of newCelebs) {
      logInfo(`\n👥 Đang xử lý kết bạn với: @${celeb.username}`);
      
      try {
        // Mở khung tìm kiếm
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find(b => b.textContent.includes('người bạn'));
          if (btn) btn.click();
        });

        const searchInputSelector = 'input[placeholder="Thêm một người bạn mới..."]';
        await page.waitForSelector(searchInputSelector, { timeout: 5000 });

        // Xóa text cũ nếu có
        await page.click(searchInputSelector, { clickCount: 3 });
        await page.keyboard.press('Backspace');

        // Nhập username mới với delay chân thực
        await delay(1000);
        await page.type(searchInputSelector, celeb.username, { delay: 150 });
        await delay(1500); // Đợi React nhận data và hiển thị nút tìm kiếm

        // Bấm nút tìm kiếm
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const searchBtn = btns.find(b => b.textContent.includes('Tìm kiếm'));
          if (searchBtn && !searchBtn.disabled) {
            searchBtn.click();
          }
        });

        // Đợi kết quả
        try {
          await page.waitForFunction(() => {
            const text = document.body.textContent;
            return text.includes('Theo dõi') || text.includes('Đang chờ chấp nhận');
          }, { timeout: 15000 });
        } catch (e) {
          logError(`❌ Không tìm thấy nút Theo dõi cho ${celeb.username}. Bỏ qua.`);
          results.error.push(celeb.username);
          continue; // Sang celeb tiếp theo
        }
        
        await delay(2000); // Thêm delay trước khi click kết bạn để giống người thật

        // Kiểm tra trạng thái
        const followStatus = await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Theo dõi'));
          if (!btn) return { exists: false };
          return {
            exists: true,
            disabled: btn.disabled || btn.classList.contains('cursor-not-allowed')
          };
        });

        if (!followStatus.exists) {
           logInfo(`⚠️ ${celeb.username} Đã kết bạn từ trước (hiện 'Đang chờ chấp nhận').`);
           results.success.push(celeb.username);
        } else if (followStatus.disabled) {
          logInfo(`❌ ${celeb.username} Đã FULL bạn (Nút bị mờ).`);
          results.full.push(celeb.username);
        } else {
          const followBtn = await page.$('button.bg-yellow-500');
          if (followBtn) {
            const box = await followBtn.boundingBox();
            if (box) {
              const x = box.x + box.width / 2;
              const y = box.y + box.height / 2;
              await page.mouse.move(x, y);
              await new Promise(r => setTimeout(r, 100));
              await page.mouse.down();
              await new Promise(r => setTimeout(r, 50));
              await page.mouse.up();
            }
          }

          await page.waitForFunction(() => {
            return document.body.textContent.includes('Đang chờ chấp nhận');
          }, { timeout: 8000 });
          logInfo(`🎉 Gửi lời mời tới ${celeb.username} thành công!`);
          results.success.push(celeb.username);
        }

        // Nghỉ 1 chút trước khi đóng khung tìm kiếm (click ra ngoài hoặc reload để reset)
        await delay(5000); // Tăng delay lên 5 giây để mô phỏng người thật, tránh spam
        await page.goto('https://locket-dio.com/locket', { waitUntil: 'networkidle2' });
        await delay(2000);

      } catch (err) {
        logError(`💥 Lỗi khi xử lý ${celeb.username}: ${err.message}`);
        results.error.push(celeb.username);
      }
    }

  } catch (error) {
    logError('💥 Lỗi luồng chính Auto-Adder: ' + error.message);
  } finally {
    await browser.close();
  }

  return results;
}

module.exports = {
  autoAddFriends
};
