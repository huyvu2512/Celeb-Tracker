/**
 * tracker.js — Script điều phối chính cho Celeb App Tracker
 * 
 * Luồng chạy:
 * 1. Đọc celebs.json (danh sách celeb đã biết) + scan_state.json (trạng thái quét)
 * 2. Quét trang profile @appcameravn → Lấy danh sách post
 * 3. Lọc ra post cần quét: bài mới + bài chưa resolve lần trước
 * 4. Với mỗi post → Quét chi tiết (caption + bình luận @appcameravn)
 * 5. Tìm link App.cam → Resolve ra invite URL
 * 6. Cập nhật celebs.json + scan_state.json
 */

const { fetchProfilePosts, fetchPostDetails, fetchAllProfilePostsViaPuppeteer } = require('./threads-scraper');
const { resolveAppLink } = require('./link-resolver');
const {
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
  sendTelegramMessage,
  sendDiscordMessage,
  sendDiscordAutoAddReport,
  sendDiscordPrepMessage,
  extractDropTime,
  getVnTimeISOString,
} = require('./utils');

// ============================================================
// Cấu hình
// ============================================================

/** Tài khoản Threads cần quét */
const TARGET_USERNAME = Buffer.from('bG9ja2V0Y2FtZXJhdm4=', 'base64').toString();

/** Tài khoản Threads phụ (Backup) */
const BACKUP_USERNAME = Buffer.from('bG9ja2V0LmFzaWE=', 'base64').toString();

/** Link có sẵn từ trước (chưa mở), điền vào đây để rình lúc 21h */
const PRE_EXISTING_LINK = '';

/** Delay giữa các request (ms) để tránh bị rate limit */
const REQUEST_DELAY_MS = 1500;

/** Chế độ dry-run: chỉ log, không ghi file */
const DRY_RUN = process.argv.includes('--dry-run');

// ============================================================
// Logic chính
// ============================================================

async function runScanCycle(scanState, celebs, newlyFoundCelebs, knownUsernames, isFastMode = false, includeBackup = true) {
  let newCelebsFound = 0;

  // 1. Phục hồi Token cho Celeb bị 404 (Auto-Retry)
  // ----------------------------------------------------------
  for (const existingCeleb of celebs) {
    if (existingCeleb.invite_url === null) {
      logInfo(`[Recovery] Đang thử lấy lại link cho Celeb bị lỗi 404 từ trước: @${existingCeleb.username}...`);
      const currentDelay = isFastMode ? 0 : REQUEST_DELAY_MS;
      if (currentDelay > 0) await delay(currentDelay);

      const resolved = await resolveAppLink(existingCeleb.app_cam_url);
      if (resolved) {
        logSuccess(`  🎉 ĐÃ LẤY ĐƯỢC LINK CHO CELEB BỊ 404 TỪ TRƯỚC: @${existingCeleb.username}`);
        
        const inviteTokenMatch = resolved.invite_url.match(/invites\/([^?]+)/);
        existingCeleb.invite_url = resolved.invite_url;
        existingCeleb.invite_token = inviteTokenMatch ? inviteTokenMatch[1] : null;
        existingCeleb.slot_limit = resolved.slot_limit;
        if (resolved.display_name) {
          existingCeleb.display_name = resolved.display_name;
        }

        newlyFoundCelebs.push({ ...existingCeleb, is_link_recovery: true });
        newCelebsFound++;
      } else {
        logWarning(`  ⚠️ Vẫn lỗi 404 cho @${existingCeleb.username}, sẽ thử lại sau.`);
      }
    }
  }

  // 2. Quét trang profile
  // ----------------------------------------------------------
  let profilePosts;
  try {
    const isFirstRun = Object.keys(scanState.scanned_posts).length === 0;
    if (isFirstRun) {
      logInfo('⚠️ Dữ liệu quét rỗng (First Run). Đang kích hoạt chế độ FULL SCAN bằng Puppeteer...');
      profilePosts = await fetchAllProfilePostsViaPuppeteer(TARGET_USERNAME);
      if (!profilePosts || profilePosts.length === 0) {
        logWarning('⚠️ Puppeteer không lấy được bài viết (có thể bị chặn). Đang dùng fallback sang API quét thông thường...');
        profilePosts = await fetchProfilePosts(TARGET_USERNAME);
      }
    } else {
      profilePosts = await fetchProfilePosts(TARGET_USERNAME);
    }
  } catch (err) {
    logError(`Không thể quét profile @${TARGET_USERNAME}: ${err.message}`);
    return 0; // Return 0 to avoid crashing, especially useful during Sniper Mode where we want to retry
  }

  if (profilePosts.length === 0) {
    logWarning('Không tìm thấy bài viết nào trên profile. Kết thúc.');
    return newCelebsFound;
  }

  // ----------------------------------------------------------
  // 3. Lọc ra post cần quét
  //    - Bài mới chưa từng quét
  //    - Bài đã quét nhưng chưa resolve (resolved: false)
  // ----------------------------------------------------------
  const postsToScan = [];
  const latestPostCode = profilePosts.length > 0 ? profilePosts[0].code : null;

  for (const post of profilePosts) {
    const state = scanState.scanned_posts[post.code];

    if (!state) {
      // Bài mới chưa từng quét
      postsToScan.push({ ...post, reason: 'MỚI' });
    } else if (state.resolved === false && post.code === latestPostCode) {
      // Chỉ quét lại BÀI GẦN NHẤT (nếu chưa tìm thấy link)
      postsToScan.push({ ...post, reason: 'QUÉT LẠI (BÀI MỚI NHẤT)' });
    } else if (state.resolved === false) {
      // Các bài cũ đã quét mà không có link -> Đánh dấu hoàn thành luôn để bỏ qua (bao gồm cả bài thông báo cũ nếu có bài mới hơn)
      scanState.scanned_posts[post.code].resolved = true;
    }
    // else: đã quét và đã resolve → bỏ qua
  }

  // Dọn dẹp rác: Những bài viết quá cũ (không còn nằm trong danh sách profilePosts)
  // nhưng vẫn bị kẹt ở trạng thái resolved: false thì ép sang true để JSON sạch sẽ
  const currentPostCodes = new Set(profilePosts.map(p => p.code));
  for (const code in scanState.scanned_posts) {
    if (scanState.scanned_posts[code].resolved === false && !currentPostCodes.has(code)) {
      scanState.scanned_posts[code].resolved = true;
    }
  }

  logInfo(`Số bài cần quét: ${postsToScan.length} (trong tổng ${profilePosts.length} bài trên profile)`);

  // 3.5 Quét trang phụ (Backup Page) nếu được yêu cầu
  if (includeBackup) {
    try {
      const backupPosts = await fetchProfilePosts(BACKUP_USERNAME);
      if (backupPosts && backupPosts.length > 0) {
        for (const backupPost of backupPosts) {
          backupPost.reason = 'BACKUP PAGE (Mới nhất)';
          backupPost.author = BACKUP_USERNAME; // Đánh dấu author để fetch đúng url

          const isResolved = scanState.scanned_posts[backupPost.code] && scanState.scanned_posts[backupPost.code].resolved;
          if (!isResolved) {
            if (!scanState.scanned_posts[backupPost.code]) {
              scanState.scanned_posts[backupPost.code] = { resolved: false };
            }
            postsToScan.push(backupPost);
            logInfo(`[Backup] Bổ sung bài viết của @${BACKUP_USERNAME} (${backupPost.code}) vào danh sách quét.`);
          }
        }
      }
    } catch (err) {
      logWarning(`[Backup] Không thể quét trang phụ @${BACKUP_USERNAME}: ${err.message}`);
    }
  }

  if (postsToScan.length === 0) {
    logInfo('Không có bài mới cần quét. Cập nhật timestamp và kết thúc.');
    return newCelebsFound;
  }

  // ----------------------------------------------------------
  // 4. Quét chi tiết từng post
  // ----------------------------------------------------------

  for (const post of postsToScan) {
    log('');
    log(`📋 Quét post [${post.reason}]: ${post.code}`);
    log(`   Caption: ${post.caption.substring(0, 100).replace(/\n/g, ' ')}...`);

    const currentDelay = isFastMode ? 0 : REQUEST_DELAY_MS;
    if (currentDelay > 0) await delay(currentDelay);

    let postDetails;
    let postAuthor = post.author || TARGET_USERNAME;
    try {
      postDetails = await fetchPostDetails(postAuthor, post.code);
    } catch (err) {
      logError(`  Lỗi khi quét post ${post.code}: ${err.message}`);
      // Đánh dấu chưa resolve để quét lại lần sau
      scanState.scanned_posts[post.code] = {
        resolved: false,
        error: err.message,
      };
      continue;
    }

    // --- Tìm link App.cam ---
    const foundTargets = [];

    // Nguồn 1: Caption của bài viết
    const captionLinks = extractAppCamLinks(postDetails.caption);
    for (const url of captionLinks) {
      foundTargets.push({ url, sourceType: 'caption', text: postDetails.caption });
    }

    // Nguồn 2: Bình luận của @appcameravn (chỉ chính chủ)
    for (const reply of postDetails.replies) {
      if (reply.author === postAuthor) {
        const replyLinks = extractAppCamLinks(reply.text);
        for (const url of replyLinks) {
          foundTargets.push({ url, sourceType: 'reply', text: reply.text });
        }
      }
    }

    if (foundTargets.length === 0) {
      logWarning(`  Không tìm thấy link App.cam trong post ${post.code}`);

      // NẾU KHÔNG CÓ LINK CELEB_TRACKER -> TÌM GIỜ VÀNG TRONG CAPTION!
      if (!scanState.scanned_posts[post.code]?.resolved) {
        const postTimeMs = (postDetails.taken_at || 0) * 1000;
        const postAgeHours = (Date.now() - postTimeMs) / (1000 * 60 * 60);

        if (postAgeHours <= 24) {
          const dropTime = extractDropTime(postDetails.caption || '', postTimeMs);
          if (dropTime && scanState.sniper_target_time !== dropTime) {
            scanState.sniper_target_time = dropTime;
            scanState.sniper_trigger_code = post.code;
            scanState.sniper_completed = false; // Reset cờ hoàn thành

            logSuccess(`🎯 LÊN LỊCH SNIPER MODE: Phát hiện thông báo giờ vàng: ${dropTime}`);

            const timeStr = new Intl.DateTimeFormat('vi-VN', {
              timeZone: 'Asia/Ho_Chi_Minh',
              hour: '2-digit', minute: '2-digit',
              day: '2-digit', month: '2-digit', year: 'numeric'
            }).format(new Date(dropTime));

            let msg = `<b>CHUẨN BỊ MỞ SLOT!</b>\n\n`;
            msg += `⏱ <b>Thời gian dự kiến:</b> ${timeStr}\n`;

            const postUrl = `https://www.threads.net/@${TARGET_USERNAME}/post/${post.code}`;
            const replyMarkup = {
              inline_keyboard: [
                [{ text: 'Xem bài viết thông báo', url: postUrl }]
              ]
            };
            await sendTelegramMessage(msg, replyMarkup);
            await sendDiscordPrepMessage(timeStr, postUrl);
          }
        } else {
          // Bài quá cũ (>24h), chữ "tối nay" hoặc "nay" đã không còn hiệu lực
          // logInfo(`  Bài viết ${post.code} quá cũ (${Math.round(postAgeHours)}h), bỏ qua tìm giờ vàng.`);
        }
      }

      scanState.scanned_posts[post.code] = {
        resolved: false,
      };
      continue;
    }

    logSuccess(`  Tìm thấy ${foundTargets.length} target link trong post`);

    // ----------------------------------------------------------
    // 5. Với mỗi link → Kiểm tra trùng → Resolve invite
    // ----------------------------------------------------------
    let anyResolved = false;

    for (const target of foundTargets) {
      const { url: appUrl, sourceType, text: sourceText } = target;
      const username = extractUsernameFromAppUrl(appUrl);
      if (!username) {
        logWarning(`  Không thể trích xuất username từ ${appUrl}`);
        continue;
      }

      const existingCeleb = celebs.find(c => c.username === username);
      const isKnown = !!existingCeleb;
      const isKnownAndResolved = isKnown && !!existingCeleb.invite_url;

      // ----------------------------------------------------------
      // AUTO-ADD THẦN TỐC TRƯỚC KHI LÀM BẤT CỨ VIỆC GÌ KHÁC!
      // Giới hạn tối đa 2 lần/run để tránh bị ban tài khoản
      // ----------------------------------------------------------
      let autoAddResults = null;
      if (!isKnown && !DRY_RUN) {
        if (global.autoAddCount === undefined) global.autoAddCount = 0;

        if (global.autoAddCount < 2) {
          logSuccess(`🚀 [SPEED ADD] Gọi Auto-Add ngay lập tức cho @${username} (Bất chấp 404)!`);
          const { autoAddFriends } = require('./auto-adder');
          autoAddResults = await autoAddFriends([{ username }]);
          global.autoAddCount++;
        } else {
          logWarning(`⚠️ Đã đạt giới hạn Auto-Add (2 lần/run). Bỏ qua Auto-Add cho @${username}`);
        }
      }

      const threadsDisplayName = extractDisplayNameFromText(sourceText);

      // Chỉ gọi request phân tích link nếu chưa có invite_url
      if (!isKnownAndResolved) {
        const currentDelay = isFastMode ? 0 : REQUEST_DELAY_MS;
        if (currentDelay > 0) await delay(currentDelay);
        const resolved = await resolveAppLink(appUrl);

        if (!resolved) {
          logWarning(`  Không resolve được ${appUrl} (Lỗi 404 hoặc Timeout)`);

          if (!isKnown) {
            logWarning(`  ⚠️ CELEB MỚI NHƯNG LỖI 404: @${username}. Đang lưu tạm để add tự động và lấy link sau.`);
            const displayName = threadsDisplayName || username;
            const newCeleb = {
              username: username,
              display_name: displayName,
              app_cam_url: appUrl,
              invite_url: null, // Chưa có link
              invite_token: 'lỗi 404',
              slot_limit: 'Không rõ',
              found_at: getVnTimeISOString(new Date((post.taken_at || postDetails.taken_at || (Date.now() / 1000)) * 1000)),
              bot_action_time: getVnTimeISOString(),
              source_post_code: post.code,
              source_type: sourceType,
              auto_add_results: autoAddResults,
            };
            celebs.push(newCeleb);
            newlyFoundCelebs.push(newCeleb); // Gửi thông báo lần 1 (lỗi 404)
            knownUsernames.add(username);
            newCelebsFound++;
          }
          // KHÔNG set anyResolved = true để post này tiếp tục được quét lại
          continue;
        }

        // Đã resolve thành công!
        const inviteTokenMatch = resolved.invite_url.match(/invites\/([^?]+)/);
        const inviteToken = inviteTokenMatch ? inviteTokenMatch[1] : null;

        if (isKnown) {
          // TRƯỜNG HỢP: Trước đó bị 404, giờ mới LẤY ĐƯỢC LINK (Recovery)
          logSuccess(`  🎉 ĐÃ LẤY ĐƯỢC LINK CHO CELEB BỊ 404 TỪ TRƯỚC: @${username}`);
          existingCeleb.invite_url = resolved.invite_url;
          existingCeleb.invite_token = inviteToken;
          existingCeleb.slot_limit = resolved.slot_limit;
          existingCeleb.display_name = threadsDisplayName || resolved.display_name || username;

          newlyFoundCelebs.push({ ...existingCeleb, is_link_recovery: true });
          newCelebsFound++;
          anyResolved = true;
          continue;
        }

        // Trường hợp: Hoàn toàn mới và lấy link thành công ngay lập tức!
        const displayName = threadsDisplayName || resolved.display_name || username;

        const newCeleb = {
          username: username,
          display_name: displayName,
          app_cam_url: appUrl,
          invite_url: resolved.invite_url,
          invite_token: inviteToken,
          slot_limit: resolved.slot_limit,
          found_at: getVnTimeISOString(new Date((post.taken_at || postDetails.taken_at || (Date.now() / 1000)) * 1000)),
          bot_action_time: getVnTimeISOString(),
          source_post_code: post.code,
          source_type: sourceType,
          auto_add_results: autoAddResults,
        };

        celebs.push(newCeleb);
        newlyFoundCelebs.push(newCeleb);
        knownUsernames.add(username);
        anyResolved = true;
        newCelebsFound++;

        logSuccess(`  🎉 CELEB MỚI: @${username} (${displayName})`);
        logSuccess(`     Invite: ${resolved.invite_url}`);
      } else {
        // Trường hợp: Đã biết và đã có link -> Chỉ check xem có tăng slot hay không
        await delay(REQUEST_DELAY_MS);
        const resolved = await resolveAppLink(appUrl);
        if (resolved) {
          if (resolved.slot_limit && existingCeleb.slot_limit && resolved.slot_limit > existingCeleb.slot_limit) {
            logSuccess(`  🆙 TĂNG SLOT: @${username} mở thêm slot (${existingCeleb.slot_limit} -> ${resolved.slot_limit})`);
            existingCeleb.slot_limit = resolved.slot_limit;
            existingCeleb.found_at = getVnTimeISOString();

            newlyFoundCelebs.push({ ...existingCeleb, is_update: true });
            newCelebsFound++;
          } else {
            logInfo(`  Celeb @${username} đã tồn tại và không tăng slot, bỏ qua.`);
          }
        }
        anyResolved = true;
      }
    }

    // Cập nhật trạng thái post
    scanState.scanned_posts[post.code] = {
      resolved: anyResolved,
    };
  }

  // ----------------------------------------------------------
  // 5.5 Luồng 3: Kiểm tra Link có sẵn từ trước
  // Nếu chưa có celeb nào được add trong vòng quét này
  // ----------------------------------------------------------
  if (PRE_EXISTING_LINK && !scanState.pre_existing_resolved && newCelebsFound === 0) {
    const username = extractUsernameFromAppUrl(PRE_EXISTING_LINK) || 'unknown_pre_existing';
    const isKnownAndResolved = celebs.some(c => c.username === username && c.invite_url);

    if (!isKnownAndResolved) {
      logInfo(`[Luồng 3] Đang rình Link có sẵn từ trước: ${PRE_EXISTING_LINK}`);

      const currentDelay = isFastMode ? 0 : REQUEST_DELAY_MS;
      if (currentDelay > 0) await delay(currentDelay);

      const resolved = await resolveAppLink(PRE_EXISTING_LINK);
      if (resolved) {
        // Auto add thần tốc (chỉ chạy nếu lấy được username từ app.cam)
        let autoAddResults = null;
        if (username !== 'unknown_pre_existing' && !DRY_RUN) {
          if (global.autoAddCount === undefined) global.autoAddCount = 0;
          if (global.autoAddCount < 2) {
            logSuccess(`🚀 [SPEED ADD] Gọi Auto-Add ngay lập tức cho Link Có Sẵn (@${username})!`);
            const { autoAddFriends } = require('./auto-adder');
            autoAddResults = await autoAddFriends([{ username }]);
            global.autoAddCount++;
          }
        }

        const inviteTokenMatch = resolved.invite_url.match(/invites\/([a-zA-Z0-9]+)/);
        const inviteToken = inviteTokenMatch ? inviteTokenMatch[1] : null;

        const newCeleb = {
          username: username !== 'unknown_pre_existing' ? username : (resolved.display_name || 'unknown'),
          display_name: resolved.display_name || username,
          app_cam_url: PRE_EXISTING_LINK,
          invite_url: resolved.invite_url,
          invite_token: inviteToken,
          slot_limit: resolved.slot_limit,
          found_at: getVnTimeISOString(),
          bot_action_time: getVnTimeISOString(),
          source_post_code: 'PRE_EXISTING',
          source_type: 'Link có sẵn',
          auto_add_results: autoAddResults,
        };

        celebs.push(newCeleb);
        newlyFoundCelebs.push(newCeleb);
        if (username !== 'unknown_pre_existing') knownUsernames.add(username);
        newCelebsFound++;

        scanState.pre_existing_resolved = true;
        logSuccess(`  🎉 CELEB MỚI TỪ LUỒNG 3: ${resolved.invite_url}`);
      } else {
        logWarning(`  [Luồng 3] Link có sẵn vẫn chưa mở (Báo 404)`);
      }
    } else {
      scanState.pre_existing_resolved = true;
    }
  }

  // ----------------------------------------------------------
  // 5b. Quét Instagram Stories (Nếu có cấu hình RapidAPI)
  // ----------------------------------------------------------
  const rapidApiKey = process.env.RAPIDAPI_KEY;

  // Tính giờ Việt Nam (UTC+7)
  const nowUtc = new Date();
  const vnTime = new Date(nowUtc.getTime() + 7 * 60 * 60 * 1000);
  const vnHour = vnTime.getUTCHours();

  // Tạo signature để ghi nhớ (tránh quét nhiều lần trong cùng 1 tiếng)
  const dateSignature = `${vnTime.getUTCFullYear()}-${vnTime.getUTCMonth()}-${vnTime.getUTCDate()}-${vnHour}`;

  const targetHours = [0, 6, 12, 18];
  const isTargetHour = targetHours.includes(vnHour);
  const shouldScanIg = isTargetHour && (scanState.last_ig_scan_signature !== dateSignature);

  if (rapidApiKey) {
    if (shouldScanIg) {
      log('');
      log('='.repeat(60));
      try {
        const { fetchInstagramStories } = require('./insta-scraper');
        // Chú ý: Insta dùng appcamera, Threads dùng appcameravn
        const stories = await fetchInstagramStories(Buffer.from('bG9ja2V0Y2FtZXJh', 'base64').toString(), rapidApiKey);
        const storyLinks = [];

        for (const story of stories) {
          // Chuyển toàn bộ object story thành chuỗi để quét link ở bất kỳ thuộc tính nào (sticker, cta, ...)
          const storyText = JSON.stringify(story);
          const links = extractAppCamLinks(storyText);
          for (const url of links) {
            storyLinks.push({
              url,
              sourceType: 'ig_story',
              text: `IG_Story_${story.pk || 'unknown'}`
            });
          }
        }

        if (storyLinks.length > 0) {
          logSuccess(`  Tìm thấy ${storyLinks.length} target link trong Instagram Stories`);

          for (const target of storyLinks) {
            const { url: appUrl, sourceType, text: sourceText } = target;
            const username = extractUsernameFromAppUrl(appUrl);
            if (!username) continue;

            let autoAddResults = null;
            if (!knownUsernames.has(username) && !DRY_RUN) {
              if (global.autoAddCount === undefined) global.autoAddCount = 0;

              if (global.autoAddCount < 2) {
                logSuccess(`🚀 [SPEED ADD] Gọi Auto-Add ngay lập tức cho @${username} từ IG Story!`);
                const { autoAddFriends } = require('./auto-adder');
                autoAddResults = await autoAddFriends([{ username }]);
                global.autoAddCount++;
              } else {
                logWarning(`⚠️ Đã đạt giới hạn Auto-Add (2 lần/run) để chống ban. Bỏ qua Auto-Add cho @${username}`);
              }
            }

            await delay(REQUEST_DELAY_MS);
            const resolved = await resolveAppLink(appUrl);
            if (!resolved) continue;

            const inviteTokenMatch = resolved.invite_url.match(/invites\/([^?]+)/);
            const inviteToken = inviteTokenMatch ? inviteTokenMatch[1] : null;

            if (knownUsernames.has(username)) {
              const existingCeleb = celebs.find(c => c.username === username);
              if (existingCeleb && resolved.slot_limit && existingCeleb.slot_limit && resolved.slot_limit > existingCeleb.slot_limit) {
                logSuccess(`  🆙 TĂNG SLOT (IG Story): @${username} mở thêm slot (${existingCeleb.slot_limit} -> ${resolved.slot_limit})`);
                existingCeleb.slot_limit = resolved.slot_limit;
                existingCeleb.found_at = getVnTimeISOString();

                newlyFoundCelebs.push({ ...existingCeleb, is_update: true });
                newCelebsFound++;
              } else {
                logInfo(`  Celeb @${username} (từ IG Story) đã tồn tại, bỏ qua.`);
              }
              continue;
            }

            // Story thường không có caption nên lấy display_name trực tiếp từ app page
            const displayName = resolved.display_name || username;

            const newCeleb = {
              username: username,
              display_name: displayName,
              app_cam_url: appUrl,
              invite_url: resolved.invite_url,
              invite_token: inviteToken,
              slot_limit: resolved.slot_limit,
              found_at: getVnTimeISOString(),
              source_post_code: sourceText,
              source_type: sourceType,
              auto_add_results: autoAddResults,
            };

            celebs.push(newCeleb);
            newlyFoundCelebs.push(newCeleb);
            knownUsernames.add(username);
            newCelebsFound++;

            logSuccess(`  🎉 CELEB MỚI (IG Story): @${username} (${displayName})`);
            logSuccess(`     Invite: ${resolved.invite_url}`);
          }
        } else {
          logInfo('  Không tìm thấy link App.cam nào trong Instagram Stories.');
        }
      } catch (err) {
        logError(`  Lỗi quét Instagram Stories: ${err.message}`);
      } finally {
        // Đánh dấu thời điểm quét IG mới nhất
        scanState.last_ig_scan = getVnTimeISOString();
        scanState.last_ig_scan_signature = dateSignature;
      }
    } else {
      log('');
      logInfo(`⏳ Bỏ qua quét Instagram. Lịch quét mặc định: 0h, 6h, 12h, 18h VN (Hiện tại: ${vnHour}h).`);
    }
  } else {
    log('');
    logInfo('ℹ️ Bỏ qua quét Instagram Stories vì không có RAPIDAPI_KEY trong environment.');
  }

  // ----------------------------------------------------------

  return newCelebsFound;
}

async function main() {
  log('='.repeat(60));
  log('🚀 Celeb App Tracker — Bắt đầu quét');
  if (DRY_RUN) logWarning('CHẾ ĐỘ DRY-RUN: Không ghi file');
  log('='.repeat(60));

  // ----------------------------------------------------------
  // 1. Đọc dữ liệu hiện tại
  // ----------------------------------------------------------
  const celebs = readJsonFile('celebs.json', []);
  const scanState = readJsonFile('scan_state.json', {
    last_scan: null,
    last_ig_scan: null,
    last_ig_scan_signature: null,
    scanned_posts: {},
  });

  // Đảm bảo scanned_posts luôn là object để tránh lỗi crash khi file JSON bị xóa trắng thành {}
  if (!scanState.scanned_posts) {
    scanState.scanned_posts = {};
  }

  const newlyFoundCelebs = [];
  const knownUsernames = new Set(celebs.map(c => c.username));
  logInfo(`Số celeb đã biết: ${knownUsernames.size}`);
  logInfo(`Số post đã quét: ${Object.keys(scanState.scanned_posts).length}`);

  // 1. CHẠY MỘT LƯỢT QUÉT ĐẦU TIÊN ĐỂ CẬP NHẬT GIỜ G (NẾU CÓ)
  let newCelebsFound = await runScanCycle(scanState, celebs, newlyFoundCelebs, knownUsernames, true, true);
  
  let isInSniperMode = false;

  // ==========================================================
  // SNIPER WAIT LOGIC
  // ==========================================================
  if (scanState.sniper_target_time && !scanState.sniper_completed) {
    const targetTime = new Date(scanState.sniper_target_time).getTime();
    const now = Date.now();
    const timeDiff = targetTime - now;

    // Nếu cách giờ G dưới 30 phút và chưa qua giờ G
    if (timeDiff > 0 && timeDiff <= 30 * 60 * 1000) {
      isInSniperMode = true;
      logInfo(`🎯 Sắp đến giờ G! Đang đợi ${Math.round(timeDiff / 1000 / 60)} phút nữa tới thời khắc vàng...`);
      await delay(timeDiff); // NGỦ ĐÔNG CHỜ ĐẾN GIỜ G

      logSuccess(`🔥 GIỜ G ĐÃ ĐIỂM! KÍCH HOẠT SNIPER MODE TRONG 60 PHÚT!`);
      const sniperEndTime = Date.now() + 60 * 60 * 1000;

      while (Date.now() < sniperEndTime) {
        const minutesPassed = 60 - ((sniperEndTime - Date.now()) / (60 * 1000));
        const isFastMode = minutesPassed <= 10;

        logInfo(`  -> Bắn tỉa: đang quét bài viết... (Còn ${Math.round((sniperEndTime - Date.now()) / 1000)}s) [FastMode: ${isFastMode}]`);
        const found = await runScanCycle(scanState, celebs, newlyFoundCelebs, knownUsernames, isFastMode, true);
        const hasInviteUrl = newlyFoundCelebs.some(c => c.invite_url !== null);
        const hasSpeedAddSuccess = newlyFoundCelebs.some(c => c.auto_add_results && (c.auto_add_results.success || c.auto_add_results.skipped || c.auto_add_results.full));

        if (hasInviteUrl || hasSpeedAddSuccess) {
          logSuccess(`🎯 SNIPER THÀNH CÔNG! Đã lấy được link Invite hoặc Auto-Add thành công! Kết thúc Sniper Mode.`);
          newCelebsFound += found;
          scanState.sniper_completed = true; // Đánh dấu hoàn thành
          break;
        } else if (found > 0) {
          logInfo(`⏳ Vừa bắt được Celeb mới nhưng bị 404. Tiếp tục Sniper Mode chờ link...`);
          newCelebsFound += found;
        }
        if (isFastMode) {
          logInfo(`  -> [10p đầu] Chưa thấy link. Spam quét lại NGAY LẬP TỨC...`);
        } else {
          logInfo(`  -> Chưa thấy link. Chờ 5 giây rồi quét lại...`);
          await delay(5000); // Rình 5 giây 1 lần
        }
      }

      if (!scanState.sniper_completed) {
        logWarning(`😢 Hết 60 phút Sniper Mode nhưng không bắt được Celeb nào.`);
        scanState.sniper_completed = true;
      }
    } else if (timeDiff < 0 && timeDiff > -2 * 60 * 60 * 1000) {
      // Nếu lỡ quá giờ 2 tiếng thì bỏ qua luôn (tránh kẹt)
      scanState.sniper_completed = true;
    }
  }

  // ==========================================================
  // VÒNG LẶP 5 PHÚT MẶC ĐỊNH (NẾU KHÔNG VÀO SNIPER MODE)
  // ==========================================================
  if (!isInSniperMode) {
    const hasInviteUrlInit = newlyFoundCelebs.some(c => c.invite_url !== null);
    const hasSpeedAddSuccessInit = newlyFoundCelebs.some(c => c.auto_add_results && (c.auto_add_results.success || c.auto_add_results.skipped || c.auto_add_results.full));

    if (!(hasInviteUrlInit || hasSpeedAddSuccessInit)) {
      logInfo(`⏳ Kích hoạt vòng lặp quét liên tục tốc độ cao trong 5 phút...`);
      const loopEndTime = Date.now() + 5 * 60 * 1000;
      
      while (Date.now() < loopEndTime) {
        const found = await runScanCycle(scanState, celebs, newlyFoundCelebs, knownUsernames, true, true);
        
        const hasInviteUrl = newlyFoundCelebs.some(c => c.invite_url !== null);
        const hasSpeedAddSuccess = newlyFoundCelebs.some(c => c.auto_add_results && (c.auto_add_results.success || c.auto_add_results.skipped || c.auto_add_results.full));

        if (hasInviteUrl || hasSpeedAddSuccess) {
          logSuccess(`🎯 Đã lấy được link Invite hoặc Auto-Add thành công! Kết thúc vòng lặp sớm.`);
          newCelebsFound += found;
          break;
        } else if (found > 0) {
          logInfo(`⏳ Vừa bắt được Celeb mới nhưng bị 404. Tiếp tục vòng lặp chờ link...`);
          newCelebsFound += found;
        }

        // Chờ 0 giây (chạy liên tục tốc độ cao)
        await delay(0);
      }
    }
  }

  // ----------------------------------------------------------
  // 6. Sắp xếp & Lưu dữ liệu
  // ----------------------------------------------------------

  // Sắp xếp celebs mới nhất lên đầu tiên
  celebs.sort((a, b) => new Date(b.found_at) - new Date(a.found_at));

  log('');
  log('='.repeat(60));
  if (newCelebsFound > 0) {
    logSuccess(`Tổng cộng tìm thấy ${newCelebsFound} celeb mới!`);

    for (const c of newlyFoundCelebs) {
      // Chuyển đổi định dạng thời gian cho đẹp (UTC+7)
      const d = new Date(new Date(c.found_at).getTime() + 7 * 60 * 60 * 1000);
      const postTimeStr = `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}:${d.getUTCSeconds().toString().padStart(2, '0')} ${d.getUTCDate().toString().padStart(2, '0')}/${(d.getUTCMonth() + 1).toString().padStart(2, '0')}/${d.getUTCFullYear()}`;

      const b = new Date(new Date(c.bot_action_time || Date.now()).getTime() + 7 * 60 * 60 * 1000);
      const botTimeStr = `${b.getUTCHours().toString().padStart(2, '0')}:${b.getUTCMinutes().toString().padStart(2, '0')}:${b.getUTCSeconds().toString().padStart(2, '0')}`;

      let sourceTextStr = '';
      if (c.source_type === 'ig_story') sourceTextStr = 'Instagram (tin)';
      else if (c.source_type === 'reply') sourceTextStr = 'Threads (comment)';
      else if (c.source_type === 'caption') sourceTextStr = 'Threads (bài viết)';
      else sourceTextStr = c.source_type;

      let msg = c.is_update ? `<b>CELEBRITY TĂNG SLOT!</b>\n\n` : `<b>CELEBRITY MỚI!</b>\n\n`;
      msg += `👤 <b>Tên:</b> ${c.display_name}\n`;
      msg += `🎫 <b>Slot:</b> ${c.slot_limit ? c.slot_limit.toLocaleString('en-US') : 'Không rõ'}\n`;
      msg += `🆔 <b>Username:</b> @ ${c.username}\n`;
      if (c.invite_token) {
        msg += `🔑 <b>Token:</b> <code>${c.invite_token}</code>\n`;
      }
      msg += `🕒 <b>Giờ đăng bài:</b> ${postTimeStr}\n`;
      msg += `⚡ <b>Giờ vồ mồi:</b> ${botTimeStr}\n`;
      msg += `📍 <b>Nguồn:</b> ${sourceTextStr}\n`;

      const replyMarkup = c.invite_url ? {
        inline_keyboard: [
          [{ text: `➕ Kết bạn với ${c.display_name}`, url: c.invite_url }]
        ]
      } : null;

      // 1. Ưu tiên gửi Telegram trước (Thông báo chính)
      await sendTelegramMessage(msg, replyMarkup);

      let successMsg = '';
      let shouldSendAutoAdd = false;

      if (c.auto_add_results) {
        successMsg = `🤖 <b>AUTO ADD CELEB</b>\n\n`;
        successMsg += `👤 <b>Tên:</b> ${c.display_name}\n`;
        successMsg += `🆔 <b>Username:</b> @ ${c.username}\n`;
        successMsg += `🎫 <b>Slot:</b> ${c.slot_limit ? c.slot_limit.toLocaleString('en-US') : 'Không rõ'}\n`;

        if (c.auto_add_results.success && c.auto_add_results.success.includes(c.username)) {
          successMsg += `✅ <b>Đã kết bạn thành công!</b>\n`;
          shouldSendAutoAdd = true;
        } else if (c.auto_add_results.full && c.auto_add_results.full.includes(c.username)) {
          successMsg += `❌ <b>Thất bại (Hết Slot hoặc Xếp hàng)</b>\n`;
          shouldSendAutoAdd = true;
        } else if (c.auto_add_results.skipped && c.auto_add_results.skipped.includes(c.username)) {
          successMsg += `⚠️ <b>Đã là Bạn bè từ trước!</b>\n`;
          shouldSendAutoAdd = true;
        }

        if (shouldSendAutoAdd) {
          successMsg += `🕒 <b>Giờ đăng bài:</b> ${postTimeStr}\n`;
          successMsg += `⚡ <b>Giờ vồ mồi:</b> ${botTimeStr}\n`;
          // Ưu tiên gửi Telegram tiếp (Thông báo Auto-add)
          await sendTelegramMessage(successMsg);
        }
      }

      await delay(500); // Tránh rate limit của Telegram khi gửi nhiều

      // 2. Gửi Discord sau cùng
      await sendDiscordMessage(c, postTimeStr, sourceTextStr);
      if (shouldSendAutoAdd) {
        await sendDiscordAutoAddReport(c);
      }
      await delay(500);
    }

  } else {
    logInfo('Không tìm thấy celeb mới trong lần quét này.');
  }

  if (!DRY_RUN) {
    scanState.last_scan = getVnTimeISOString();
    celebs.forEach(c => delete c.auto_add_results);
    writeJsonFile('celebs.json', celebs);
    writeJsonFile('scan_state.json', scanState);
    logSuccess('Đã lưu celebs.json và scan_state.json');
  } else {
    logWarning('DRY-RUN: Không ghi file. Dữ liệu mới:');
    console.log(JSON.stringify(celebs.slice(-newCelebsFound || undefined), null, 2));
  }

  log('='.repeat(60));
  log('🏁 Kết thúc quét');
}

// Chạy
main().catch(err => {
  logError(`Lỗi không mong muốn: ${err.message}`);
  console.error(err);
  process.exit(1);
});

