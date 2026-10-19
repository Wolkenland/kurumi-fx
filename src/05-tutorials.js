/* ============================================================
 * 05-tutorials.js  教学系统 + 章节剧情
 * 目标：让完全不懂股市/外汇的人，玩完就明白杠杆、保证金、爆仓、借贷
 * ============================================================ */

const Tutorials = (() => {
  'use strict';

  const DEFS = {
    welcome: {
      title: '开始之前', who: 'kurumiIn', pages: [
        { t: '这个游戏里没有真钱。一分钱都没有。', b: '你操作的汇率、爆掉的仓位、欠下的债，全部是程序编出来的数字。<br>所以你可以放心地把它玩坏——<b class="hl">因为这大概是唯一一次，你能安全地体验"爆仓"。</b>' },
        { t: '但规则是真的。', b: '杠杆多少倍、保证金怎么算、维持率跌到多少会被强平、借钱交易会发生什么——<br><b class="warn">这些规则和真实市场一模一样。</b>你在这里踩的坑，在现实里都会原样出现。' },
        { t: '妈妈亏掉了 2000 万。', b: '五年前，福贺梢在 FX 里爆仓，亏光了家里 2000 万日元的存款，然后从楼上跳了下去。<br>我要把这笔钱，从市场里拿回来。<br><b class="hl">这是复仇。</b>' },
      ]
    },
    chart: {
      title: '看懂 K 线', who: 'kurumiIn', pages: [
        { t: '一根蜡烛 = 一段时间', b: '每一根蜡烛代表 2 小时。<br>· <b class="hl">绿色</b>= 收盘价高于开盘价（涨）<br>· <b class="warn">红色</b>= 收盘价低于开盘价（跌）<br>影线的顶端和底端是这段时间里的最高价和最低价。' },
        { t: '数字在跳，就是钱在动', b: 'USD/JPY = 110.20 意思是：1 美元 = 110.20 日元。<br>它涨到 111.20，就是涨了 <b class="hl">100 pips</b>（1 日元 = 100 点）。<br>你赚多少，取决于你持有多少量。' },
        { t: '点和手数', b: '<b class="hl">pips（点）</b>是汇率的最小刻度，日元对通常是 0.01。<br><b class="hl">1 万通貨</b>时，1 pip 的波动 = <b>100 円</b>。<br>10 万通貨时，1 pip = 1000 円。<br>所以"手数"决定你每一跳的心跳幅度。' },
        { t: '图表是会骗人的', b: '拖动可以看历史，双指缩放，双击回到最新。<br>但请记住：<b class="warn">过去长什么样，完全不决定下一秒往哪走。</b>你以为的"规律"，很多时候只是你希望它有的形状。' },
      ]
    },
    leverage: {
      title: '杠杆：这个世界最危险的发明', who: 'kurumiIn', pages: [
        { t: '不用钱，也能持有大仓位', b: '你有 10 万日元。<br>用 1 倍杠杆，你只能买 10 万日元的美元。<br>用 10 倍杠杆，你能持有 <b class="hl">100 万日元</b>的美元——保证金只要 10 万。<br>听起来像变魔术，对吧？' },
        { t: '它同时放大了亏损', b: '持有的美元跌了 1%，你的仓位亏 1 万日元。<br>1 倍杠杆下，你亏本金的 10%。<br><b class="warn">10 倍杠杆下，你亏掉全部本金。</b><br>同一段行情，结局完全相反。' },
        { t: '杠杆让"爆仓距离"缩短', b: '爆仓不是"亏完"，是<b class="hl">在还没亏完的时候就被强制清仓</b>。<br>杠杆越大，行情只需要动一点点，你就撞线了。<br>· 10 倍杠杆：约 5% 的逆行就爆<br>· 100 倍杠杆：约 <b class="warn">0.5%</b> 的逆行就爆<br>0.5% 在外汇里，是几分钟的事。' },
        { t: '所以妈妈才会跳下去', b: '她不是"赌错了方向"。<br>她是用了一个方向对了也活不下来、方向错了立刻消失的杠杆。<br><b class="hl">杠杆不会让你赢，它只是让你输得更快、赢得更少次。</b>' },
      ]
    },
    margin: {
      title: '保证金与维持率', who: 'mochiko', pages: [
        { t: '「你连维持率都不知道，也敢下单？」', b: '<b class="hl">必要保证金</b> = 持仓量 × 汇率 ÷ 杠杆。<br><b class="hl">净值</b> = 账户现金 + 所有持仓的浮动盈亏。<br><b class="hl">维持率</b> = 净值 ÷ 必要保证金 × 100%。' },
        { t: '三个数字，三条命线', b: '· 维持率 <b class="hl">100%</b>：触发<b>追证</b>，券商要求你补钱。<br>· 维持率 <b class="warn">50%</b>：<b>强制平仓（ロスカット）</b>。券商不等你同意，直接砍掉。<br>· 顶部那条红色虚线就是它。<br>你可以在下单面板看到"爆仓价距离"——<b>所以你没有资格说"我不知道会爆在哪"。</b>' },
        { t: '怎么活下来', b: '· 手数小一点（保证金占用少）<br>· 杠杆低一点（爆仓距离远）<br>· <b class="hl">设止损</b>，并且真的让它执行<br>· 不要一边亏一边加仓<br>这四条，就是全部的风控。真的，就这四条。' },
      ]
    },
    debt: {
      title: '借钱：把人推向深渊的第二只手', who: 'mochiko', pages: [
        { t: '「借钱不丢人。丢人的是还不上。」', b: '游戏里有四种借钱渠道：<br>· 朋友（0%）<br>· 消費者金融（18%）<br>· 闇金融（36.5%）<br>· <b class="hl">我，年利 109%</b><br>利率越高，越容易借到——因为借你钱的人，本来就没打算让你还完再走。' },
        { t: '109% 是什么概念', b: '借 100 万，一年后是 209 万。<br>换算成日息，每天约 <b class="warn">0.3%</b>。<br>30 天吃掉 9%，100 天吃掉 30%，一年吃掉一倍。<br><b>你要跑赢市场 109% 才能打平。</b>这个世界上没人能年复一年做到。' },
        { t: '最致命的组合', b: '<b class="warn">借钱 + 高杠杆 = 双重爆仓。</b><br>市场把你保证金打爆，你的债<b>不会</b>跟着消失。<br>芽吹就是这么消失的：她不是输光了钱，是输光了钱之后，还欠着钱。' },
        { t: '所以，这一页请记住', b: '如果你要在现实里碰这些东西——<br><b class="hl">永远不要用借来的钱交易。</b><br>不需要"尽量"，不需要"就这一次"。<br>就是永远不要。' },
      ]
    },
    swap: {
      title: '隔夜利息与"必胜作战"', who: 'kurumiIn', pages: [
        { t: '持仓过夜会生利息', b: '<b class="hl">スワップ（隔夜利息）</b>= 两种货币的利率差。<br>买高息货币可以每天收钱，卖高息货币要每天付钱。<br>周三通常是三倍利息，周末不计息。' },
        { t: '久留美的"必胜作战"', b: '原作里久留美盯上了<b class="hl">瑞郎日元（CHF/JPY）</b>——<br>一个波动相对小、能做空吃利息的品种。<br>听着完美：赚利息 + 大概率不爆。<br><b class="warn">然后瑞士央行出手了。</b>' },
        { t: '没有"必胜"', b: '低波动 + 高利息 = 一个看起来安全的仓位。<br>但外汇市场里，<b>所有看起来安全的东西，代价都藏在尾部。</b><br>你能连续赚 200 天，然后一天全部还回去。<br>这就是 <b class="hl">コツコツドカン</b>（小赚大亏）。' },
      ]
    },
    psychology: {
      title: '止损为什么这么难', who: 'kurumiIn', pages: [
        { t: '因为你已经在心里赢了', b: '下单的那一刻，你已经在想象赚到钱的画面。<br>当行情反向，你不是在"亏钱"，你是在<b class="warn">失去那个已经属于你的未来。</b><br>所以你不肯平仓。这不是贪，是人的本能。' },
        { t: '沉没成本', b: '「已经亏了这么多，现在平掉不就白亏了」——<br>这句话是散户破产的第一大原因。<br><b class="hl">已经亏掉的，不管你怎么做，都回不来了。</b>你唯一能决定的是：从现在开始，还要再亏多少。' },
        { t: '摊平加仓（ナンピン）', b: '亏损时继续加仓拉低均价。<br>顺利的时候它让你更快回本；<br><b class="warn">不顺利的时候，它让你的爆仓价从"还很远"变成"就在脚下"。</b><br>妈妈用过这招。久留美也用过。' },
        { t: '久留美最后的结论', b: '「我知道应该止损。我当然知道。」<br>「但我不甘心。」<br><b class="hl">这个游戏想让你体会的，就是这句话的重量。</b><br>停手这件事，越早越容易，越晚越不可能。' },
      ]
    },
  };

  let core, ui, queue = [], showing = false;

  function init(c, u) { core = c; ui = u; }

  function play(id, force) {
    const def = DEFS[id];
    if (!def) return;
    if (!force && core.hasSeen(id)) return;
    queue.push({ id, def });
    if (!showing) next();
  }

  function next() {
    if (!queue.length) { showing = false; return; }
    showing = true;
    const { id, def } = queue.shift();
    let page = 0;
    const box = document.body;          // 固定定位：#tutSlot 会随屏幕 transform 产生包含块
    const node = el('div', 'tut');
    box.appendChild(node);
    const who = { kurumiIn: ['福賀久留美', '久'], mochiko: ['小金萌智子', '萌'],
                  mebuki: ['山師芽吹', '芽'], yasuko: ['高根やす子', '安'] }[def.who] || ['？？？', '？'];
    const render = () => {
      const p = def.pages[page];
      node.innerHTML = `
        <div class="who"><span class="av">${who[1]}</span>${who[0]}<span class="pages" style="margin-left:auto">${page + 1}/${def.pages.length}</span></div>
        <div class="body"><div style="font-weight:800;font-size:13.5px;margin-bottom:5px;color:var(--pink)">${p.t}</div>${p.b}</div>
        <div class="foot">
          <span style="font-size:10.5px;color:var(--tx3);flex:1">${def.title}</span>
          ${page > 0 ? '<button class="btn btn-ghost btn-xs" data-a="prev">上一页</button>' : ''}
          <button class="btn btn-gold btn-xs" data-a="next">${page === def.pages.length - 1 ? '明白了' : '下一页'}</button>
        </div>`;
      const g = node.querySelectorAll('button');
      g.forEach(b => {
        bindTap(b, () => {
          if (b.dataset.a === 'prev') { page--; render(); Sfx.click(); }
          else {
            if (page < def.pages.length - 1) { page++; render(); Sfx.click(); }
            else { close(); }
          }
        });
      });
    };
    const close = () => {
      core.seen(id);
      node.classList.remove('on');
      setTimeout(() => { node.remove(); next(); }, 300);
      Sfx.close();
    };
    render();
    requestAnimationFrame(() => node.classList.add('on'));
    Sfx.open();
  }

  return { DEFS, init, play, begin: () => Chapters.begin(), force: (id) => play(id, true), get busy() { return showing; } };
})();

/* ============================================================
 * 章节 / 剧情推进
 * ============================================================ */
const Chapters = (() => {
  'use strict';
  let core, ui, cur = -1, fired = {};

  const STORY = [
    {
      id: 'prologue', title: '序章：被夺走的 2000 万',
      cond: c => true,
      onEnter(c) {
        Tutorials.play('welcome');
        c.st.flags.prologue = true;
      },
      goals: ['用 30 万本金，把账户做到 35 万'],
    },
    {
      id: 'first_trade', title: '第一笔交易',
      cond: c => c.st.positions.length + c.st.closed.length >= 1,
      onEnter(c, u) { Tutorials.play('chart'); },
    },
    {
      id: 'leverage', title: '杠杆的滋味',
      cond: c => c.st.positions.some(p => p.lev >= 10) || c.st.closed.some(r => r.lev >= 10),
      onEnter(c) { Tutorials.play('leverage'); },
    },
    {
      id: 'meet_mochiko', title: '同班同学',
      cond: c => c.st.stats.level >= 2,
      onEnter(c, u) {
        c.st.flags.metMochiko = true;
        c.bark('idle', 'mochiko');
        Sheets.msg('小金萌智子', `<span style="font-size:11px;color:var(--tx3)">大学 2 年，据说资产已经过 1000 万。</span><br><br>
          「福賀同学。你在做 FX 吧。」<br>
          「别装。你的表情很好认——<b style="color:var(--gold)">那种想把失去的东西抢回来的表情。</b>」<br><br>
          「我教你一件事吧：<b>维持率是怎么算的</b>。」`, 'pink');
        setTimeout(() => Tutorials.play('margin'), 3200);
      },
    },
    {
      id: 'debt_intro', title: '第一笔借款',
      cond: c => c.st.cash < 60000 && c.st.stats.level >= 2,
      onEnter(c) {
        c.st.flags.hasJob = true;
        Sheets.msg('钱不够了', `保证金只剩下 <b class="mono" style="color:var(--dn)">${U.fmt(c.st.cash)} 円</b>。<br><br>
          没有本金就没法交易，没有交易就赚不回 2000 万。<br>
          借钱的选项已经解锁了——<br><b style="color:var(--gold)">这是芽吹走过的第一条岔路。</b>`, 'warn');
        setTimeout(() => Tutorials.play('debt'), 3000);
      },
    },
    {
      id: 'meet_mebuki', title: '芽吹',
      cond: c => c.totalLoan() > 0,
      onEnter(c) {
        c.st.flags.metMebuki = true;
        Sheets.msg('山師芽吹', `<span style="font-size:11px;color:var(--tx3)">萌智子介紹来的朋友。听说是被拉来看盘的。</span><br><br>
          「诶，这就是 FX 啊？」<br>
          「<b style="color:var(--gold)">我啊，最讨厌工作了。</b>所以我想靠这个活下去。」<br><br>
          「久留美，教教我嘛。买哪边能赚？」`, 'pink');
      },
    },
    {
      id: 'mebuki_wins', title: '反着做就对了',
      cond: c => c.st.flags.metMebuki && c.st.closed.filter(r => r.pnl > 0).length >= 3,
      onEnter(c, u) {
        Sheets.msg('芽吹的连胜', `芽吹完全不懂行情，只是随便押。<br>而她的预测，<b style="color:var(--gold)">大概都是错的</b>——所以我只要反着做，就一直赢。<br><br>
          「久留美好厉害！我以后都听你的！」<br>
          <span style="font-size:11px;color:var(--tx3)">——但她开始想自己下单了。</span>`, 'pink');
        c.st.flags.yasukoUnlock = true;
      },
    },
    {
      id: 'yasuko', title: 'あふぃちゃん',
      cond: c => c.st.closed.length >= 8,
      onEnter(c) {
        c.st.flags.metYasuko = true;
        Sheets.msg('高根やす子', `<span style="font-size:11px;color:var(--tx3)">芽吹的朋友。用「あふぃちゃん」的笔名写 FX 战绩博客。</span><br><br>
          「我、我已经不做了……」<br>
          「之前亏得太多，就停手了。<b style="color:var(--gold)">我现在只想画我的角色。</b>」<br><br>
          「不过……芽吹一个人在那边，我有点担心她。」`, 'pink');
      },
    },
    {
      id: 'mochiko_deal', title: '年利 109%',
      cond: c => c.st.flags.metMochiko && c.st.loans.length >= 2,
      onEnter(c) {
        c.st.flags.mochikoDeal = true;
        Sheets.msg('萌智子的报价', `「你在到处借钱。」<br>
          「消费者金融、闇金……你连那种地方都去了。可惜利率还是不够高。」<br><br>
          「我借给你。<b style="color:var(--purple)">年利 109%。</b>」<br>
          「个人间融资的法定最高利率。换句话说——<b>这是法律允许我吃掉你的最快速度。</b>」<br><br>
          「不用谢。我只是想看看，你会走到哪一步。」`, 'bad');
        Sfx.loan(); Haptics.lose();
      },
    },
    {
      id: 'dad_money', title: '爸爸的存款',
      cond: c => c.st.cash < 20000 && c.st.positions.length > 0 && c.st.stats.level >= 3,
      onEnter(c, u) {
        Sheets.msg('衣柜里的信封', `爸爸的存款。<b class="mono">300 万円</b>。<br>
          他每天加班到末班车，一点一点攒下来的。<br><br>
          <b style="color:var(--dn)">「先借用一下，赚回来就还回去。」</b><br>
          「反正是同一个家。反正马上就还。」<br><br>
          <span style="font-size:11px;color:var(--tx3)">——这是久留美在漫画里真正做过的事。</span>`, 'bad');
        Confirm.ask('拿走这 300 万吗？',
          '这一笔钱会进入你的账户。<br><b style="color:var(--dn)">家庭信任将永久受损，但你的账户会活过来。</b><br>这是久留美在漫画里的选择——也是她最后一次说服自己"只是一时的"。',
          '拿走', () => {
            c.st.wallet += 3000000;
            c.st.flags.dadMoney = true;
            c.st.stats.mental = U.clamp(c.st.stats.mental - 25, 0, 100);
            c.emit('dadmoney');
            ui.toast('300 万円 入账', 'up');
            ui.renderAll();
          });
      },
    },
    {
      id: 'despair', title: '和妈妈一样',
      cond: c => c.st.stats.mental < 40 && c.st.stats.liquidated >= 1,
      onEnter(c) {
        c.st.flags.despairSeen = true;
        Sheets.msg('深夜', `我又被强平了。<br><br>
          屏幕上还是那个停住的数字。<br>
          我突然想起来——<b>妈妈当年也是一个人坐在这里，看着同一个画面。</b><br><br>
          「我是不是，正在变成她。」<br><br>
          <span style="font-size:11px;color:var(--tx3)">冷静值已降到 40 以下。闇金融的渠道已经解锁——<br>这正是最不该借钱的时候。</span>`, 'bad');
        Sfx.heart();
        Camera.shake();
      },
    },
    {
      id: 'quitting', title: '第五次戒赌',
      cond: c => c.st.stats.liquidated >= 3,
      onEnter(c, u) {
        Sheets.msg('发誓', `「我不做了。」<br>
          「这次真的不做了。」<br><br>
          上一次说这句话，是大约 <b>${c.st.stats.daysPlayed}</b> 天前。<br>
          再上一次，是再往前一点。<br><br>
          <b style="color:var(--gold)">「我知道应该止损。我当然知道。但我不甘心。」</b>`, 'warn');
        setTimeout(() => Tutorials.play('psychology'), 3600);
      },
    },
    {
      id: 'swap_plan', title: '必胜作战',
      cond: c => c.st.cash >= 3000000 && c.totalLoan() === 0,
      onEnter(c, u) {
        Sheets.msg('久留美的作战', `本金够了。<现在要找一条"绝对不会输"的路。<br><br>
          <b style="color:var(--gold)">瑞郎日元（CHF/JPY）</b>——<br>
          · 波动小，不容易被打到强平线<br>
          · 做空可以每天收隔夜利息<br>
          · 长期持有，复利滚动<br><br>
          完美。太完美了。<br>
          <span style="font-size:11px;color:var(--dn)">历史上，无数人在这条路上走到了同一个地方。</span>`, 'pink');
        setTimeout(() => Tutorials.play('swap'), 3400);
        c.st.flags.swapPlan = true;
      },
    },
    {
      id: 'goal_2000', title: '2000 万',
      cond: c => c.netAsset() >= 20000000,
      onEnter(c, u) {
        Sfx.bigwin(); Haptics.win();
        Sheets.msg('达成', `<b style="color:var(--up);font-size:20px">2000 万円</b><br><br>
          我做到了。<br>
          妈妈亏掉的钱，我全部拿回来了。<br><br>
          <span style="font-size:11.5px;color:var(--tx2)">……然后呢？<br>
          目标完成之后，一个真正的赌徒会做的事只有一件：<b style="color:var(--gold)">设一个更大的目标。</b></span>`, 'pink');
        c.st.flags.goalDone = true;
      },
    },
    {
      id: 'epilogue', title: '尾声：漫画的结局',
      cond: c => c.st.flags.goalDone && c.netAsset() < 1000000,
      onEnter(c, u) {
        Sheets.msg('尾声', `2000 万，变成这样了。<br><br>
          漫画连载到现在，久留美<b>一次都没有上岸</b>。<br>
          作者本人也还在里面。<br><br>
          <span style="font-size:11.5px;line-height:1.8">
          · 芽吹输光了钱，背上债，才终于停下。<br>
          · やす子早早认输离场，把剩下的钱投到自己的作品上，成了职业漫画家。<br>
          · 萌智子一直在旁边看着，从不亏钱，也从不真正赢到什么。<br>
          · 久留美……还在赌。她的复仇早就变成了别的东西。</span><br><br>
          <b style="color:var(--gold)">这个结局不好看。<br>但它是唯一真实的那个。</b><br><br>
          <span style="font-size:11px;color:var(--tx3)">你可以在「设定 → 重置」重新开始。<br>
          不过说真的——玩到这里，你已经知道问题不在运气了。</span>`, 'bad');
      },
    },
  ];

  function init(c, u) {
    // 换绑 Core 时必须清空已触发记录，否则新开一局会"继承"上一局的剧情进度
    if (core !== c) { fired = {}; cur = -1; }
    core = c; ui = u;
  }

  function begin() { Chapters.begin(); }

  /** 开场一次性：登记已完成章节，补播序章 */
  function chapterBegin() {
    if (!core) return;
    core.st.chapter = core.st.chapter || 0;
    STORY.forEach((s, i) => { if (core.st.chapterDone[s.id]) fired[s.id] = true; });
    // 补播序章
    if (!fired.prologue) { fired.prologue = true; STORY[0].onEnter(core, ui); core.st.chapterDone.prologue = 1; core.save(); }
    check();
  }

  function check() {
    for (const s of STORY) {
      if (fired[s.id]) continue;
      let ok = false;
      try { ok = s.cond(core); } catch (e) { ok = false; }
      if (ok) {
        fired[s.id] = true;
        core.st.chapterDone[s.id] = 1;
        core.st.chapter++;
        try { s.onEnter(core, ui); } catch (e) { console.warn('chapter', s.id, e); }
        ui.toast('剧情推进：' + s.title, 'up');
        setTimeout(() => ui.renderAll(), 200);
        core.save();
        break;
      }
    }
  }

  /** 人物列表（用于"人物"页） */
  function people(c) {
    const f = c.st.flags;
    const last = c.st.closed[c.st.closed.length - 1];
    const ppl = [
      { name: '福賀久留美', role: '主角', tagCls: 'pink', ini: '久', c1: '#ff8fb1', c2: '#c084fc',
        ds: `20 岁・大学生・Lv.${c.st.stats.level}・交易 ${c.st.stats.wins + c.st.stats.losses} 次`,
        line: c.st.stats.mental < 40 ? BARKS.kurumiIn.despair[0] : c.st.stats.totalPnl > 0 ? BARKS.kurumiIn.euphoria[0] : BARKS.kurumiIn.idle[0] },
    ];
    if (f.metMochiko) ppl.push({ name: '小金萌智子', role: '观察者', tagCls: 'purple', ini: '萌', c1: '#c084fc', c2: '#8cb4ff',
      ds: '同班同学・资产 1000 万＋・从不亏钱',
      line: c.totalLoan() > 2000000 ? BARKS.mochiko.loan[0] : last && last.pnl < 0 ? BARKS.mochiko.loss[0] : BARKS.mochiko.idle[0] });
    if (f.metMebuki) ppl.push({ name: '山師芽吹', role: '同行者', tagCls: 'up', ini: '芽', c1: '#3ddc97', c2: '#8cb4ff',
      ds: '萌智子的朋友・"不想工作"・零基础入市',
      line: last && last.pnl < 0 ? BARKS.mebuki.loss[1] : BARKS.mebuki.idle[0] });
    if (f.metYasuko) ppl.push({ name: '高根やす子', role: '旁观者', tagCls: 'gold', ini: '安', c1: '#ffd166', c2: '#ff8fb1',
      ds: '绘本作者「あふぃちゃん」・已提前离场',
      line: BARKS.yasuko.idle[1] });
    if (f.dadMoney) ppl.push({ name: '福賀郁夫', role: '父亲', tagCls: 'dn', ini: '父', c1: '#8cb4ff', c2: '#5b7fc7',
      ds: '单身上班族・存款被你拿走了 300 万',
      line: '「……你怎么会变成这样。」' });
    if (f.mochikoDeal) ppl.push({ name: '闇金融', role: '债主', tagCls: 'dn', ini: '闇', c1: '#ff4d6d', c2: '#7a1030',
      ds: '年利 36.5%・上门催收',
      line: '「利息每天都长。你跑不掉的。」' });
    return ppl;
  }

  return { STORY, init, begin: chapterBegin, check, people, get index() { return core ? core.st.chapter : 0; } };
})();
