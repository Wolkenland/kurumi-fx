/* ============================================================
 * 09-ui-ai.js  把 AI 交易员接入界面
 *  - 「人物」页新增：AI 交易员卡 / 竞赛排名 / 对赌 / 挑战目标 / 洞察点与技能
 *  - 「設定」页新增：AI 交易员配置入口
 *  - 对话抽屉、配置抽屉、结算演出
 * ============================================================ */

const AIUI = (() => {
  'use strict';
  let core = null, ui = null, installed = false;
  let equityHist = [];        // AI 净值曲线（装饰用，不持久化）
  let sampleAcc = 0;
  let chatDraft = '';
  let cfgDraft = null;

  /* ---------------- 安装 ---------------- */
  function install(c, u) {
    if (installed) return;
    core = c; ui = u;
    AIPlayer.init(c, u);

    // 1) 人物页尾部插入 AI 区域
    const me = $$('#sc-me');
    if (me) {
      const box = el('div', '');
      box.id = 'aiZone';
      me.appendChild(el('div', 'h1', `AI 交易员<small>YUKI · 第四位参赛者</small>`)).style.fontSize = '15px';
      me.appendChild(box);
    }
    // 2) 設定页插入配置入口
    const setCard = $$('#setCard');
    if (setCard) {
      const row = el('div', 'kv', `<span class="k">🤖 AI 交易员（接入 API）</span><span class="v" id="aiCfgState">未配置</span>`);
      row.dataset.act = 'aiconfig';
      setCard.appendChild(row);
    }

    // 3) 主循环驱动
    core.on(ev => { if (ev.type === 'frame') drive(ev.dt); });
    core.on(ev => {
      if (ev.type === 'liquidated') setTimeout(() => render(), 900);
      if (ev.type === 'insight') { ui.toast(`获得 ${ev.n} 点洞察`, 'up'); }
    });

    // 4) 全局钩子
    ui.onAIActed = onAIActed;
    ui.onAIError = onAIError;
    ui.onChat = renderChatInto;
    ui.onContestSettled = onContestSettled;

    installed = true;
    render();
  }

  function drive(dt) {
    AIPlayer.onTick(dt);
    // 采样她的净值曲线
    sampleAcc += dt;
    if (sampleAcc > 1500) {
      sampleAcc = 0;
      const a = AIPlayer.agent;
      if (a) { equityHist.push(a.equity); if (equityHist.length > 70) equityHist.shift(); }
    }
    // 思考中的呼吸动画由 CSS 负责，这里只在需要时刷新文本
    if (ui.screen === 'me' && AIPlayer.agent && AIPlayer.agent.busy) {
      const n = $$('#aiThinkingDot');
      if (n) n.textContent = '思考中' + '.'.repeat(1 + (Math.floor(performance.now() / 400) % 3));
    }
  }

  /* ---------------- AI 事件 ---------------- */
  function onAIActed(r, agent) {
    const log = (r.log || []).join('，');
    if (log) {
      // 日志已在 AIPlayer.runOnce 里写入，这里只负责提示演出
      // 她交易时的浮动提示
      const d = el('div', '', `🤖 ${agent.name}：${log}`);
      d.style.cssText = `position:fixed;left:12px;right:12px;bottom:calc(var(--tabh) + var(--safe-b) + 8px);
        z-index:92;padding:9px 12px;border-radius:12px;font-size:11.5px;line-height:1.5;
        background:rgba(12,20,34,.95);border:1px solid rgba(140,180,255,.4);color:#dbe7ff;
        box-shadow:0 12px 34px rgba(0,0,0,.6);animation:toastIn2 .35s cubic-bezier(.16,1,.3,1)`;
      document.body.appendChild(d);
      setTimeout(() => { d.style.transition = 'all .35s'; d.style.opacity = '0'; d.style.transform = 'translateY(10px)';
        setTimeout(() => d.remove(), 380); }, 3800);
    }
    FX.bark('yuki', agent.lastQuote + '　' + agent.lastThought);
    if (ui.screen === 'me') render();
  }
  function onAIError(msg) {
    if (!msg) return;
    AIPlayer.disable();     // 出错自动停，避免一直刷请求
    ui.toast('AI 已暂停：' + msg, 'dn');
    Sheets.msg('AI 请求失败', `${msg}<br><br>
      <span style="font-size:11.5px;color:var(--tx2)">
      常见原因：<br>
      · API key 填错或已失效<br>
      · 余额/额度不足<br>
      · 接口地址不是 OpenAI 兼容格式（应以 <span class="mono">/v1/chat/completions</span> 结尾）<br>
      · 该服务商没有开启浏览器跨域（CORS）——这种情况只能换服务商，或用支持 CORS 的中转地址<br>
      · 网络不通<br><br>
      已自动暂停 AI 以避免重复请求。修好后在「设定 → AI 交易员」里重新启用。</span>`, 'bad');
    render();
  }
  function onContestSettled(r) {
    const lines = r.rows.map(x =>
      `${x.rank}. ${x.name}　<span class="mono" style="color:${x.ret >= 0 ? 'var(--up)' : 'var(--dn)'}">${U.sfmt(x.ret, 2)}%</span>`).join('<br>');
    Sheets.msg(`第 ${r.round} 期 · 竞赛结算`,
      `<div style="font-size:12.5px;line-height:2">${lines}</div>
       <div style="margin-top:12px;padding:10px 12px;border-radius:11px;
         background:rgba(255,209,102,.10);border:1px solid rgba(255,209,102,.3);font-size:12px;line-height:1.7">
         ${r.message}${r.rewards.length ? '<br><b style="color:var(--gold)">获得 ' +
         r.rewards.reduce((a, x) => a + x.insight, 0) + ' 点洞察</b>' : ''}
       </div>`, r.rewards.length ? 'pink' : 'warn');
    render();
  }

  /* ---------------- 渲染「人物」页的 AI 区 ---------------- */
  function render() {
    const box = $$('#aiZone');
    if (!box) return;
    const a = AIPlayer.agent;
    const cfg = LLM.get();
    const st = AIPlayer.standings();
    const ready = LLM.ready();
    const on = AIPlayer.enabled;

    let html = '';

    /* --- 1. AI 交易员卡 --- */
    if (!a) {
      html += `<div class="card">
        <div class="card-title"><span class="dot" style="background:var(--blue)"></span>未登场的第四位参赛者</div>
        <div style="font-size:12px;line-height:1.75;color:var(--tx2)">
          「ゆき」——一个和你同龄的交易员。没人知道她从哪来，只知道她的账户曲线异常平稳。<br><br>
          ${ready
            ? 'API 已就绪。<b style="color:var(--gold)">让她下场吧。</b>'
            : '<b style="color:var(--warn,#ffd166)">要让她登场，需要先在「設定 → AI 交易员」里填入 API key。</b><br><span style="font-size:11px;color:var(--tx3)">key 只保存在你手机本地，只会直接发给你填的那个接口。</span>'}
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn ${ready ? 'btn-gold' : 'btn-ghost'}" id="aiSpawn">${ready ? '让她登场' : '去配置 API'}</button>
          <button class="btn btn-ghost" id="aiOpenCfg">API 设置</button>
        </div>
      </div>`;
    } else {
      const posCount = a.positions.length;
      const loan = a.loan;
      const eq = a.equity;
      const startEq = a.core.st.stats.peakEquity || 300000;
      const pnl = a.core.st.stats.totalPnl;
      const good = pnl >= 0;
      html += `<div class="card">
        <div class="chara" style="border:0;padding:0">
          <div class="face" style="background:linear-gradient(140deg,#8cb4ff,#3ddc97);color:#08131f;position:relative">
            ゆ
            ${a.busy ? '<span style="position:absolute;inset:0;border:2px solid #8cb4ff;border-radius:13px;animation:aiPulse 1.1s infinite"></span>' : ''}
          </div>
          <div style="flex:1;min-width:0">
            <div class="nm">${a.name}<span class="tag ${on ? 'up' : ''}" style="margin-left:6px">${on ? '在盘中' : '已停手'}</span>
              <span class="tag purple" style="margin-left:4px">AI</span></div>
            <div class="ds">${a.method ? '模型 ' + a.method : '待接入'}　·　已决策 ${a.actions} 次${a.errors ? '　·　出错 ' + a.errors + ' 次' : ''}</div>
            <div class="ln">${a.lastQuote}</div>
          </div>
        </div>
        ${equityHist.length > 3 ? `<canvas id="aiSpark" style="width:100%;height:38px;margin-top:9px;display:block"></canvas>` : ''}
        <div class="grid3" style="margin-top:9px">
          <div class="hud-cell"><div class="k">净值</div><div class="v mono">${U.yenShort(eq)}</div></div>
          <div class="hud-cell"><div class="k">已实现盈亏</div><div class="v mono ${good ? 'tick-up' : 'tick-dn'}">${U.sfmt(pnl)}</div></div>
          <div class="hud-cell"><div class="k">持仓 / 负债</div><div class="v mono">${posCount} / ${loan > 0 ? U.yenShort(loan) : '0'}</div></div>
        </div>
        <div style="margin-top:9px;font-size:11.5px;color:var(--tx2);line-height:1.6">
          <b style="color:var(--blue)">她的判断：</b>${a.lastThought}
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn ${a.busy ? 'btn-ghost' : 'btn-gold'} btn-sm" id="aiThink" ${a.busy || !ready ? 'disabled' : ''}>
            ${a.busy ? '<span id="aiThinkingDot">思考中</span>' : '让她思考一次'}</button>
          <button class="btn btn-ghost btn-sm" id="aiTalk">和她说话</button>
        </div>
        <div class="row" style="margin-top:6px">
          <button class="btn btn-ghost btn-sm" id="aiToggle">${on ? '暂停她' : '让她继续交易'}</button>
          <button class="btn btn-ghost btn-sm" id="aiOpenCfg">API 设置</button>
        </div>
        ${!ready ? '<div style="margin-top:8px;font-size:11px;color:var(--dn)">API 未配置，她无法行动。</div>' : ''}
      </div>`;
    }

    /* --- 2. 竞赛排名 --- */
    if (st) {
      const me = st.rows.find(r => r.id === 'player');
      const lead = st.rows[0];
      html += `<div class="card">
        <div class="card-title"><span class="dot" style="background:var(--gold)"></span>三人 FX 竞赛
          <span class="right">第 ${st.round} 期 · 还剩 ${st.daysLeft} 天</span></div>
        <div style="font-size:11.5px;color:var(--tx2);margin-bottom:9px;line-height:1.6">
          每 7 天结算一次，按<b>净值增长率</b>排名。${me && me.rank === 1 ? '你现在是第一。' : lead ? `目前领头的是 ${lead.name}。` : ''}
        </div>
        ${st.rows.map(r => `
          <div style="display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05)">
            <div style="width:24px;text-align:center;font-weight:900;font-size:13px;
              color:${r.rank === 1 ? 'var(--gold)' : r.rank === 2 ? 'var(--tx2)' : 'var(--tx3)'}">${r.rank}</div>
            <div class="face" style="width:28px;height:28px;border-radius:9px;font-size:12px;
              background:linear-gradient(140deg,${r.c1},${r.c2});color:#0b0f16;display:flex;align-items:center;justify-content:center;font-weight:900">${r.ini}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12.5px;font-weight:700">${r.name}${r.id === 'player' ? '<span class="tag pink" style="margin-left:5px">你</span>' : ''}</div>
              <div style="font-size:10.5px;color:var(--tx3)" class="mono">净值 ${U.yenShort(r.now)}</div>
            </div>
            <div class="mono" style="font-size:14px;font-weight:800;color:${r.ret >= 0 ? 'var(--up)' : 'var(--dn)'}">
              ${U.sfmt(r.ret, 2)}%</div>
          </div>`).join('')}
        <div style="margin-top:9px;font-size:11px;color:var(--tx3);line-height:1.6">
          第 1 名 +3 洞察　第 2 名 +1 洞察　垫底没有奖励，但会被她记住
        </div>
      </div>`;

      /* --- 3. 对赌 --- */
      const bets = AIPlayer.myBets();
      const aiRow = st.rows.find(r => r.id === 'ai');
      html += `<div class="card">
        <div class="card-title"><span class="dot" style="background:var(--pink)"></span>对赌
          <span class="right">${bets.length ? '本期已押 ' + U.fmt(bets.reduce((s, b) => s + b.amount, 0)) : '本期未下注'}</span></div>
        <div style="font-size:11.5px;color:var(--tx2);line-height:1.68">
          押「${a ? a.name : 'ゆき'}」本期收益为正。<br>
          · 她赚了 → 你收回本金 + 按她收益率分成（最高 4 倍）<br>
          · 她亏了 → 你押的钱全没了<br>
          <b style="color:var(--gold)">用的是钱包里的钱，输光了不会影响保证金。</b>
        </div>
        ${aiRow ? `<div class="kv" style="margin-top:8px"><span class="k">她本期收益</span>
          <span class="v mono" style="color:${aiRow.ret >= 0 ? 'var(--up)' : 'var(--dn)'}">${U.sfmt(aiRow.ret, 2)}%</span></div>` : ''}
        ${bets.map(b => `<div class="kv"><span class="k">第 ${b.round} 期押注</span>
          <span class="v mono">${U.fmt(b.amount)} 円</span></div>`).join('')}
        <div class="row" style="margin-top:10px">
          <button class="btn btn-gold btn-sm" id="aiBet" ${!a ? 'disabled' : ''}>押她 10 万</button>
          <button class="btn btn-ghost btn-sm" id="aiBetC">自定义押注</button>
        </div>
      </div>`;

      /* --- 4. 挑战目标 --- */
      const gs = AIPlayer.goals();
      const active = gs.filter(g => !g.done);
      html += `<div class="card">
        <div class="card-title"><span class="dot" style="background:var(--purple)"></span>挑战目标
          <span class="right">${active.length}/3 进行中</span></div>
        <div style="font-size:11.5px;color:var(--tx2);line-height:1.68">
          给她设一个收益目标，让她去挑战。<br>
          <b style="color:var(--gold)">她达成 → 你领里程碑奖励（洞察点）。</b>她失败 → 触发她信心崩坏的剧情。
        </div>
        ${gs.length ? gs.slice(-6).reverse().map(g => {
          const cur = g.done ? 100 : U.clamp((g.current || 0) / g.target * 100, 0, 100);
          return `<div class="goal" style="margin-top:8px">
            <div class="h"><span>7 天 +${g.target}%</span>
              <span class="n mono">${g.done ? '✅ 达成于第' + g.doneDay + '天' : U.sfmt(g.current || 0, 1) + '%'}</span></div>
            <div class="pb"><i class="${cur > 80 ? 'shine' : ''}" style="width:${cur}%;
              background:linear-gradient(90deg,var(--purple),var(--gold))"></i></div>
          </div>`;
        }).join('') : ''}
        <div class="row" style="margin-top:9px">
          <button class="btn btn-ghost btn-sm" id="aiGoal" ${!a ? 'disabled' : ''}>设一个目标</button>
        </div>
      </div>`;
    }

    /* --- 5. 洞察点与技能 --- */
    const pts = core.st.insightPts;
    const perks = core.st.perks;
    html += `<div class="card">
      <div class="card-title"><span class="dot" style="background:var(--gold)"></span>洞察点 & 永久技能
        <span class="right"><b style="color:var(--gold);font-size:14px">${pts}</b> 点</span></div>
      <div style="font-size:11.5px;color:var(--tx2);line-height:1.68">
        洞察点来自竞赛优胜、对赌获胜、以及她的挑战达成。<br>
        它可以<b style="color:var(--gold)">永久强化你自己</b>，也可以直接<b style="color:var(--up)">换成现金</b>。
      </div>

      <!-- 洞察换钱 -->
      <div style="margin-top:10px;padding:10px 11px;border-radius:12px;
        background:rgba(61,220,151,.08);border:1px solid rgba(61,220,151,.28)">
        <div style="display:flex;align-items:baseline;gap:8px">
          <span style="font-size:12.5px;font-weight:800;color:var(--up)">💱 洞察换钱</span>
          <span style="font-size:10.5px;color:var(--tx3);margin-left:auto">
            1 点 = <b class="mono" style="color:var(--up)">${U.fmt(core.insightRate())}</b> 円</span>
        </div>
        <div style="font-size:11px;color:var(--tx2);line-height:1.62;margin-top:6px">
          ${pts > 0
            ? `你现在有 <b style="color:var(--gold)">${pts}</b> 点，最多可换
               <b class="mono" style="color:var(--up)">${U.fmt(pts * core.insightRate())}</b> 円。
               兑换后直接进钱包，不会自动入金。`
            : '还没有洞察点。去「三人 FX 竞赛」赢几期，或者押她一把。'}
        </div>
        <div class="row" style="margin-top:9px">
          <button class="btn ${pts >= 1 ? 'btn-gold' : 'btn-ghost'} btn-sm" id="ex1" ${pts >= 1 ? '' : 'disabled'}>
            兑换 1 点 → ${U.yenShort(core.insightRate())}</button>
          <button class="btn btn-ghost btn-sm" id="exAll" ${pts >= 1 ? '' : 'disabled'}>
            全部兑换 → ${U.yenShort(pts * core.insightRate())}</button>
        </div>
      </div>

      <div style="margin-top:12px">
        <div style="font-size:11px;font-weight:700;color:var(--tx3);margin-bottom:2px">永久技能</div>
        ${PERK_ORDER.map(k => {
          const lv = perks[k] || 0;
          const max = core.perkMax(k);
          const cost = core.perkCost(k, lv + 1);
          const can = lv < max && pts >= cost;
          return `<div style="display:flex;align-items:center;gap:9px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05)">
            <div style="flex:1;min-width:0">
              <div style="font-size:12.5px;font-weight:700">${PERK_DEFS[k].icon || ''} ${PERK_DEFS[k].short}
                <span class="tag ${lv ? 'gold' : ''}" style="margin-left:5px">Lv.${lv}/${max}</span></div>
              <div style="font-size:10.5px;color:var(--tx3);margin-top:2px">${PERK_DEFS[k].desc(lv)}</div>
              ${lv < max ? `<div style="font-size:10.5px;color:var(--tx3);margin-top:1px">下一级：${PERK_DEFS[k].desc(lv + 1)}</div>` : ''}
            </div>
            ${lv < max
              ? `<button class="btn ${can ? 'btn-gold' : 'btn-ghost'} btn-xs" data-perk="${k}" ${can ? '' : 'disabled'}
                   style="flex:0 0 auto;min-width:56px">${cost} 点</button>`
              : '<span class="tag gold" style="flex:0 0 auto">满级</span>'}
          </div>`;
        }).join('')}
      </div>
    </div>`;

    /* --- 6. 日志（她的动向） --- */
    const aiLogs = core.st.log.filter(l => l.kind === 'ai').slice(0, 6);
    if (aiLogs.length) {
      html += `<div class="card">
        <div class="card-title"><span class="dot" style="background:var(--blue)"></span>她的交易记录</div>
        ${aiLogs.map(l => `<div class="log-item"><span class="t mono">${l.day}d</span>
          <span style="color:var(--tx2)">${l.text}</span></div>`).join('')}
      </div>`;
    }

    box.innerHTML = html;

    /* --- 绑定 --- */
    const bind = (id, fn) => { const n = $$('#' + id); if (n) bindTap(n, fn); };
    bind('aiSpawn', () => {
      if (!LLM.ready()) return openConfig();
      AIPlayer.spawn({});
      confirmEula();
    });
    bind('aiOpenCfg', openConfig);
    bind('aiThink', async () => {
      if (!LLM.ready()) return openConfig();
      Sfx.click();
      render();
      const r = await AIPlayer.runOnce();
      render();
      if (r && r.error) onAIError(r.error);
      else if (r && r.ok) ui.toast(`${a ? a.name : 'ゆき'} 完成一次决策`, 'up');
    });
    bind('aiTalk', openChat);
    bind('aiToggle', () => {
      if (AIPlayer.enabled) { AIPlayer.disable(); ui.toast('她停手了', 'dn'); }
      else { AIPlayer.enable({}); ui.toast('她回到了盘面', 'up'); }
      render();
    });
    bind('ex1', () => doExchange(1));
    bind('exAll', () => doExchange(core.st.insightPts));
    bind('aiBet', () => doBet(100000));
    bind('aiBetC', () => {
      Sheets.number('对赌押注', `押「${a.name}」本期收益为正。<br>可押金额：<b class="mono">${U.fmt(core.st.wallet)} 円</b>（钱包里的钱）`,
        Math.min(100000, Math.max(1000, Math.floor(core.st.wallet))), '押注金额（円）', 0, (v) => doBet(v));
    });
    bind('aiGoal', () => {
      Sheets.number('给她设一个挑战', `让她在 7 天内把净值做到 +X%。<br>她达成你领里程碑奖励，失败会打击她的信心。<br>
        <span style="font-size:11px;color:var(--tx3)">建议 5% ~ 60%。定太高她会去冒不该冒的险。</span>`,
        20, '目标收益率（%）', 0, (v) => {
          const r = AIPlayer.addGoal(v);
          if (!r.ok) return ui.toast(r.why, 'dn');
          ui.toast(`已设下 +${v}% 的挑战`, 'up');
          render();
        });
    });
    $$$('[data-perk]', box).forEach(b => {
      bindTap(b, () => {
        const r = core.buyPerk(b.dataset.perk);
        if (!r.ok) return ui.toast(r.why, 'dn');
        ui.toast(`${PERK_DEFS[b.dataset.perk].short} 升到 Lv.${r.level}`, 'up');
        render(); ui.renderMe && 0;
      });
    });

    // 迷你曲线
    const sp = $$('#aiSpark');
    if (sp && equityHist.length > 3) {
      const up = equityHist[equityHist.length - 1] >= equityHist[0];
      drawSparkline(sp, equityHist, up ? 'rgb(61,220,151)' : 'rgb(255,77,109)');
    }
  }

  function doExchange(points) {
    const r = core.exchangeInsight(points);
    if (!r.ok) return ui.toast(r.why, 'dn');
    ui.toast(`换到 ${U.fmt(r.money)} 円（已进钱包）`, 'up');
    Sfx.coin(); Haptics.win();
    render();
  }

  function doBet(amount) {
    const r = AIPlayer.placeBet(amount);
    if (!r.ok) return ui.toast(r.why, 'dn');
    ui.toast(`已押 ${U.fmt(amount)} 円，赌她本期盈利`, 'up');
    Sfx.coin(); Haptics.tap();
    render(); ui.renderAll && 0;
  }

  /** 首次下场前的免责与提示 */
  function confirmEula() {
    const a = AIPlayer.agent;
    Sheets.msg(`${a.name} 登场了`,
      `「哦，你也在这儿。」<br>
       「那就一起玩吧。反正最后哭的不会是我。」<br><br>
       <span style="font-size:11.5px;color:var(--tx2);line-height:1.75">
       · 她会每约 1 分钟自主思考并交易一次（你在暂停时她也会停）<br>
       · 三人竞赛每 7 天结算，第一名 +3 洞察<br>
       · 你可以押她、可以给她设挑战目标、也可以和她说话<br>
       · 她的账户和你完全独立，她爆仓不会影响你（但她会闭嘴一阵子）<br><br>
       <b style="color:var(--gold)">注意：每次思考都会消耗你的 API 额度。嫌吵可以在上面暂停她。</b></span>`, 'pink');
    render();
  }

  /* ---------------- 对话抽屉 ---------------- */
  function openChat() {
    const sh = Sheets.base(`
      <h3>和 ${AIPlayer.agent ? AIPlayer.agent.name : 'ゆき'} 说话</h3>
      <div class="sub">她能看到自己的账户、持仓和当前行情。回复慢是因为真的在调模型。</div>
      <div id="chatList" style="max-height:44vh;overflow-y:auto;padding:2px 0"></div>
      <div class="field" style="margin-top:10px;display:flex;gap:7px;align-items:flex-end">
        <input type="text" id="chatIn" placeholder="说点什么…" style="flex:1;height:44px;font-size:14px" value="${chatDraft.replace(/"/g, '&quot;')}">
        <button class="btn btn-gold btn-sm" id="chatSend" style="height:44px;flex:0 0 auto;min-width:62px">发送</button>
      </div>
      <div style="font-size:10.5px;color:var(--tx3);margin-top:6px">
        你们的对话会保存在本机，最多 40 条。
      </div>`);
    renderChatInto();
    const inp = $('#chatIn', sh);
    const send = async () => {
      const t = (inp.value || '').trim();
      if (!t) return;
      inp.value = ''; chatDraft = '';
      const btn = $('#chatSend', sh);
      if (btn) { btn.disabled = true; btn.textContent = '…'; }
      renderChatInto({ pending: t });
      const r = await AIPlayer.talk(t);
      if (btn) { btn.disabled = false; btn.textContent = '发送'; }
      renderChatInto();
      if (r && r.error) ui.toast(r.error, 'dn');
      render();
    };
    $('#chatSend', sh).addEventListener('click', send);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    inp.addEventListener('input', () => { chatDraft = inp.value; });
    setTimeout(() => { try { inp.focus(); } catch (e) {} }, 320);
  }

  function renderChatInto(opt) {
    const list = $$('#chatList');
    if (!list) return;
    const rows = AIPlayer.chat.map(m => {
      const mine = m.role === 'user';
      return `<div style="display:flex;${mine ? 'justify-content:flex-end' : ''};margin-bottom:8px">
        <div style="max-width:82%;padding:8px 11px;border-radius:13px;font-size:12.5px;line-height:1.6;${
          mine ? 'background:rgba(255,143,177,.16);border:1px solid rgba(255,143,177,.32);border-bottom-right-radius:4px'
               : 'background:rgba(140,180,255,.13);border:1px solid rgba(140,180,255,.3);border-bottom-left-radius:4px'}">
          ${!mine ? `<div style="font-size:10px;font-weight:800;color:var(--blue);margin-bottom:3px">${AIPlayer.agent ? AIPlayer.agent.name : 'ゆき'}</div>` : ''}
          ${escapeHtml(m.text)}
        </div>
      </div>`;
    }).join('');
    const pend = opt && opt.pending
      ? `<div style="display:flex;justify-content:flex-end;margin-bottom:8px"><div style="max-width:82%;padding:8px 11px;
         border-radius:13px;background:rgba(255,143,177,.16);border:1px solid rgba(255,143,177,.32);font-size:12.5px">${escapeHtml(opt.pending)}</div></div>`
      : '';
    const loading = AIPlayer.chat.length && AIPlayer.chat[AIPlayer.chat.length - 1].role === 'user'
      ? `<div style="font-size:11.5px;color:var(--tx3);padding:4px 2px">她正在想…</div>` : '';
    list.innerHTML = rows || '<div class="empty" style="padding:22px">还没说过话。<br>试试问她「你觉得我该止损吗」。</div>';
    list.innerHTML += pend + loading;
    list.scrollTop = list.scrollHeight;
  }

  /* ---------------- 配置抽屉 ---------------- */
  function openConfig() {
    const cfg = LLM.get();
    const d = cfgDraft || {
      provider: cfg.provider || 'deepseek',
      url: cfg.url || LLM.presetUrl(cfg.provider || 'deepseek'),
      model: cfg.model || LLM.presetModel(cfg.provider || 'deepseek'),
      key: cfg.key || '',
      temp: cfg.temp === undefined ? 0.9 : cfg.temp,
      maxTok: cfg.maxTok || 420,
      enabled: cfg.enabled !== false,
    };
    cfgDraft = d;

    const sh = Sheets.base(`
      <h3>AI 交易员 · API 设置</h3>
      <div class="sub">接入任意 <b>OpenAI 兼容</b>的接口。Key 只保存在本机 localStorage，
        只会直接发给你填的这个地址 —— 本游戏不收集、不上传、不中转。</div>

      <div class="field">
        <label>服务商（自动填地址与模型）</label>
        <div class="amt-chips" id="pvChips">
          ${Object.keys(AI_PRESETS).map(k => `<button data-pv="${k}" class="${k === d.provider ? 'on' : ''}">${AI_PRESETS[k].name}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>接口地址（需以 /v1/chat/completions 结尾）</label>
        <input type="text" id="cfgUrl" value="${escapeAttr(d.url)}" placeholder="https://api.deepseek.com/v1/chat/completions"
          style="height:42px;font-size:12.5px;font-weight:600;letter-spacing:0">
      </div>
      <div class="field">
        <label>模型名</label>
        <input type="text" id="cfgModel" value="${escapeAttr(d.model)}" placeholder="deepseek-chat"
          style="height:42px;font-size:13px">
      </div>
      <div class="field">
        <label>API Key（保存在本机，不会离开这台设备）</label>
        <input type="text" id="cfgKey" value="${escapeAttr(d.key)}" placeholder="sk-..." autocomplete="off"
          spellcheck="false" style="height:42px;font-size:12.5px;letter-spacing:.02em">
      </div>
      <div class="field">
        <label>温度（越高越激进随意，建议 0.7 ~ 1.0）</label>
        <div class="lev-row">
          <input type="range" id="cfgTemp" min="0" max="150" step="5" value="${Math.round(d.temp * 100)}">
          <span class="lev-val" id="cfgTempV">${d.temp.toFixed(2)}</span>
        </div>
      </div>
      <div class="field">
        <label>单次回复上限 token（越小越省钱）</label>
        <input type="number" id="cfgTok" value="${d.maxTok}" style="height:42px;font-size:15px">
      </div>
      <div class="field">
        <label>思考频率（按真实时间计，不受游戏倍速影响）</label>
        <div class="amt-chips" id="thinkChips">
          ${THINK_PRESETS.map(t => `<button data-th="${t.id}" class="${t.id === AIPlayer.api.thinkId ? 'on' : ''}">${t.name}</button>`).join('')}
        </div>
        <div style="font-size:10.5px;color:var(--tx3);margin-top:5px" id="thinkHint">
          ${(THINK_PRESETS.find(x => x.id === AIPlayer.api.thinkId) || THINK_PRESETS[1]).hint}
        </div>
      </div>

      <div style="padding:9px 11px;border-radius:11px;background:rgba(255,77,109,.09);
        border:1px solid rgba(255,77,109,.28);font-size:11px;line-height:1.7;color:#ffd9e2;margin-bottom:12px">
        ⚠️ 安全提示：浏览器直连第三方接口时，Key 会出现在前端请求里。
        请使用<b>单独的、额度受限的 Key</b>，不要用你的主账号 Key。<br>
        若某服务商不允许浏览器跨域（CORS），请求会被拦截 —— 换服务商或改用支持 CORS 的中转地址。
      </div>
      <div id="cfgStatus" style="font-size:11.5px;color:var(--tx3);min-height:18px;margin-bottom:9px"></div>

      <div class="row" style="margin-bottom:7px">
        <button class="btn btn-ghost" id="cfgTest">测试连接</button>
        <button class="btn btn-gold" id="cfgSave">保存</button>
      </div>
      <div class="row">
        <button class="btn btn-ghost btn-sm" id="cfgCancel">取消</button>
        <button class="btn btn-danger btn-sm" id="cfgClear">清除 Key</button>
      </div>`);

    const status = (t, kind) => {
      const n = $('#cfgStatus', sh);
      if (!n) return;
      n.innerHTML = t;
      n.style.color = kind === 'ok' ? 'var(--up)' : kind === 'err' ? 'var(--dn)' : 'var(--tx3)';
    };

    // 思考频率
    if (typeof THINK_PRESETS !== 'undefined') {
      $$$('#thinkChips button', sh).forEach(b => {
        b.addEventListener('click', () => {
          $$$('#thinkChips button', sh).forEach(x => x.classList.toggle('on', x === b));
          AIPlayer.api.setThink(b.dataset.th);
          const hint = $$('#thinkHint', sh);
          const p = THINK_PRESETS.find(x => x.id === b.dataset.th);
          if (hint && p) hint.textContent = p.hint;
          Sfx.click();
        });
      });
    }

    $$$('#pvChips button', sh).forEach(b => {
      bindTap(b, () => {
        $$$('#pvChips button', sh).forEach(x => x.classList.toggle('on', x === b));
        const p = b.dataset.pv;
        d.provider = p;
        if (AI_PRESETS[p].url) $('#cfgUrl', sh).value = AI_PRESETS[p].url;
        if (AI_PRESETS[p].model) $('#cfgModel', sh).value = AI_PRESETS[p].model;
      });
    });
    const tR = $('#cfgTemp', sh);
    tR.addEventListener('input', () => { d.temp = +tR.value / 100; $('#cfgTempV', sh).textContent = d.temp.toFixed(2); });

    const collect = () => ({
      provider: d.provider,
      url: ($('#cfgUrl', sh).value || '').trim(),
      model: ($('#cfgModel', sh).value || '').trim(),
      key: ($('#cfgKey', sh).value || '').trim(),
      temp: d.temp,
      maxTok: Math.max(80, Math.min(4000, parseInt($('#cfgTok', sh).value, 10) || 420)),
      enabled: true,
    });

    $('#cfgTest', sh).addEventListener('click', async () => {
      const c2 = collect();
      if (!c2.url || !c2.model || !c2.key) return status('地址 / 模型 / Key 都要填', 'err');
      status('正在请求…');
      LLM.configure(c2);
      const r = await AIPlayer.test();
      if (r.ok) status(`✅ 连接成功（${r.ms} ms）　返回：${escapeHtml(String(r.text).slice(0, 30))}`, 'ok');
      else status('❌ ' + escapeHtml(r.error || '未知错误'), 'err');
    });

    $('#cfgSave', sh).addEventListener('click', () => {
      const c2 = collect();
      if (!c2.url || !c2.model || !c2.key) { status('地址 / 模型 / Key 都要填', 'err'); Sfx.error(); return; }
      if (!/^https?:\/\//.test(c2.url)) { status('地址必须以 http:// 或 https:// 开头', 'err'); Sfx.error(); return; }
      AIPlayer.configure(c2);
      cfgDraft = null;
      Sheets.close();
      ui.toast('AI 设置已保存', 'up');
      Sfx.coin();
      if (!AIPlayer.agent) { AIPlayer.spawn({}); confirmEula(); }
      else render();
      renderSetRow();
      ui.renderAll && 0;
    });
    $('#cfgCancel', sh).addEventListener('click', () => { cfgDraft = null; Sheets.close(); });
    $('#cfgClear', sh).addEventListener('click', () => {
      Confirm.ask('清除 API Key', '会删除本机保存的 Key，并让 AI 停手。<br>已产生的竞赛记录与洞察点不会丢。', '清除', () => {
        AIPlayer.disable();
        AIPlayer.configure({ key: '', enabled: false });
        cfgDraft = null;
        Sheets.close();
        ui.toast('已清除 Key', 'dn');
        render(); renderSetRow();
      });
    });
  }

  function renderSetRow() {
    const n = $$('#aiCfgState');
    if (!n) return;
    const cfg = LLM.get();
    n.textContent = LLM.ready() ? (cfg.model || '已配置') : '未配置';
    n.style.color = LLM.ready() ? 'var(--up)' : 'var(--tx3)';
  }

  /* ---------------- 小工具 ---------------- */
  function escapeHtml(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) { return escapeHtml(s); }

  return { install, render, openConfig, openChat, renderSetRow, get equityHist() { return equityHist; } };
})();
