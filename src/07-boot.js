/* ============================================================
 * 07-boot.js  启动、序章、主循环、存档
 * ============================================================ */
(function () {
  'use strict';
  let core, ui;

  function preload() {
    // 占位：本项目零外部资源，无需预载
    return Promise.resolve();
  }

  function boot() {
    core = new Core();
    const had = core.load();          // 返回 {ok, fromBackup?, migrated?}

    ui = UI;
    ui.init(core);
    Tutorials.init(core, ui);
    Chapters.init && Chapters.init(core, ui);

    // 速率同步
    core.st.settings.sfx = core.st.settings.sfx !== false;
    Sfx.setEnabled(core.st.settings.sfx);
    ui.effects = core.st.settings.effects !== false;

    core.on(ev => {
      if (ev.type === 'newday') { ui.renderLite(); Chapters.check(); }
      if (ev.type === 'close' || ev.type === 'open' || ev.type === 'borrow') {
        ui.saveTick();
        setTimeout(() => Chapters.check(), 300);
      }
    });

    // 每秒检查一次剧情条件
    setInterval(() => { try { Chapters.check(); } catch (e) {} }, 1200);
    // 每 8 秒自动存档
    setInterval(() => core.save(), 8000);
    window.addEventListener('pagehide', () => core.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) core.save(); });

    core.start();
    ui.renderAll();

    // 调试句柄（只读用途；不给任何外部通讯能力）
    window.__FXK__ = { core, ui, Tutorials, Chapters, AIUI, AIPlayer, LLM, version: '1.2.0' };

    // 序章
    if (had.ok && (core.st.stats.daysPlayed > 0 || core.st.stats.level > 1)) {
      // 读档：直接进入
      hideCover();
      if (had.fromBackup) UI.toast('主存档损坏，已从备份恢复', 'dn');
      else if (had.migrated) UI.toast('旧版存档已自动迁移', 'up');
      else UI.toast('已读取存档 · 第 ' + core.st.date.day + ' 天', 'up');
      Chapters.begin();
    } else {
      showCover();
    }
  }

  /* ---------------- 开场 ---------------- */
  function showCover() {
    const cv = document.getElementById('cover');
    const lines = [
      '2008 年，我的妈妈在 FX 里亏掉了 2000 万日元，然后从楼上跳了下去。',
      '五年来我一直在学这件事。我把每一根 K 线、每一个数字都记下来。',
      '现在我 20 岁，存了 30 万。我要把那 2000 万，从市场里原样拿回来。',
      '「这是复仇。」',
    ];
    const txt = cv.querySelector('.cv-line');
    const btn = cv.querySelector('.cv-btn');
    btn.style.opacity = '0';
    btn.style.pointerEvents = 'none';
    let i = 0;
    const step = () => {
      if (i >= lines.length) {
        btn.style.transition = 'opacity .6s';
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        return;
      }
      txt.style.transition = 'opacity .35s';
      txt.style.opacity = '0';
      setTimeout(() => {
        txt.textContent = lines[i++];
        txt.style.opacity = '1';
        Sfx.boot();
        setTimeout(step, 1900);
      }, 360);
    };
    txt.textContent = '';
    setTimeout(step, 700);

    btn.addEventListener('click', () => {
      Sfx.boot(); Sfx.resume(); Haptics.press();
      hideCover();
      Tutorials.init(core, ui);
      Chapters.begin();
      core.save();
    });
  }

  function hideCover() {
    const cv = document.getElementById('cover');
    if (!cv) return;
    cv.classList.add('off');
    setTimeout(() => cv.remove(), 700);
    Sfx.resume();
  }

  /* ---------------- 全局手势/按键 ---------------- */
  function bindGlobal() {
    // 抽屉遮罩
    document.getElementById('mask').addEventListener('click', () => Sheets.close());
    // 返回键
    window.addEventListener('popstate', () => {
      if (Sheets._open) { Sheets.close(); history.pushState(null, '', location.href); return; }
      if (UI.screen !== 'trade') { UI.showScreen('trade'); history.pushState(null, '', location.href); }
    });
    history.pushState(null, '', location.href);

    // 桌面键盘（方便开发者调试）
    window.addEventListener('keydown', e => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const map = { 'b': () => UI.doOpen(1), 's': () => UI.doOpen(-1), ' ': () => UI.syncSpeed() };
      if (e.key === ' ') { e.preventDefault(); core.st.speed = core.st.speed === 0 ? 1 : 0; UI.syncSpeed(); }
      else if (map[e.key]) map[e.key]();
    });

    // 防止双指缩放页面
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('touchmove', e => {
      if (e.touches.length > 1 && !e.target.closest('#chart')) e.preventDefault();
    }, { passive: false });

    // 第一次触摸解锁音频
    const unlock = () => { Sfx.boot(); Sfx.resume(); document.removeEventListener('touchstart', unlock); };
    document.addEventListener('touchstart', unlock);

    // resize
    let rt;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        if (UI.chart) { UI.chart.s.resize(); }
      }, 180);
    });
  }

  function main() {
    bindGlobal();
    preload().then(() => {
      try { boot(); }
      catch (e) {
        document.body.innerHTML = '<div style="padding:24px;color:#ff4d6d;font-family:monospace;font-size:12px;white-space:pre-wrap">启动失败：\n' + (e && e.stack || e) + '</div>';
        console.error(e);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
})();
