/* ================================================================
   AI / SETTINGS.JS — AI providers ki screens (list + add/edit)
   ----------------------------------------------------------------
   Settings screen ke head mein [AI] button se khulti hai :

   1) AI LIST screen : head = BACK + "AI" + [Add AI]
       - har saved provider ka CARD : provider ka naam, model line,
         OK ka nishan (✓ chip), three-dot (kebab) → Edit / Delete
         (delete = do-click confirm)
       - card TAP karo → wo ACTIVE (green + green tick) ho jaati hai
         → app ki saari AI calls usi provider par jaati hain
       - kitne bhi providers add kar sakte ho, cards neeche judte hain
   2) ADD / EDIT AI screen : head = BACK + title
       - provider chips (OpenAI / Gemini / Anthropic / Custom)
       - Base URL · Model · API key (eye toggle ke saath)
       - [Save AI] → list mein naya/updated card
   • Storage ai/engine.js sambhalta hai (achiva.ai.providers.v1);
     yahan sirf UI hai. Koi AI logic yahan NAHI.
   • ES5-only.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaAiSettingsLoaded) return;
  window.__achivaAiSettingsLoaded = true;

  var el = UI.el, esc = UI.esc;
  var H = function () { return window.AchivaAIHub; };

  var listScreen = null, formScreen = null;
  var opener = null;             /* jis screen se AI list khuli thi */

  function screenBase() {
    var s = el('section', 'screen');
    s.style.paddingTop = '58px';
    document.getElementById('app').appendChild(s);
    return s;
  }
  function headFor(s, title, onBack, rightBtn) {
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px 6px';
    var back = UI.miniBtn(UI.icons.back, 'Back');
    back.style.cssText += ';width:34px;height:34px;border-radius:50%;border:1px solid var(--s2);background:var(--chip-bg)';
    back.addEventListener('click', onBack);
    head.appendChild(back);
    var tt = el('b', null, title);
    tt.style.cssText = 'flex:1;min-width:0;font-family:var(--f-disp);font-size:17px;font-weight:700;' +
      'color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    head.appendChild(tt);
    if (rightBtn) head.appendChild(rightBtn);
    s.appendChild(head);
    return head;
  }
  function show(s) {
    if (window.SubjectListBridge) window.SubjectListBridge.show(s, true);
    else s.classList.add('active');
  }

  function providerLabel(id) {
    var ps = H().PROVIDERS;
    for (var i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i].label;
    return id || 'Provider';
  }

  /* ================================================================
     1) AI LIST SCREEN
  ================================================================ */
  function renderList() {
    if (!listScreen) listScreen = screenBase();
    listScreen.innerHTML = '';
    var addB = UI.pillBtn('+ Add AI');
    addB.style.cssText += ';padding:7px 13px;font-size:11.5px;font-weight:700';
    addB.addEventListener('click', function () { openForm(null); });
    headFor(listScreen, 'AI', function () {
      if (opener && document.body.contains(opener)) show(opener);
    }, addB);

    var scroll = el('div', 'scroll');
    var hint = el('div', null, 'Jo provider card chunoge (green tick), app ki saari AI calls usi par jaayengi. ' +
      'Kitne bhi providers add kar sakte ho.');
    hint.style.cssText = 'font-size:10.5px;color:var(--ash);line-height:1.6;margin:2px 18px 10px';
    scroll.appendChild(hint);

    var list = H().list();
    if (!list.length) {
      var e = el('div', null, 'Koi AI provider nahi hai.<br>+ Add AI se pehla provider add karo.');
      e.style.cssText = 'margin:26px 20px;padding:22px;border:1px dashed var(--s2);border-radius:18px;' +
        'color:var(--slate);font-size:12.5px;line-height:1.7;text-align:center';
      scroll.appendChild(e);
    } else {
      list.forEach(function (c) { scroll.appendChild(card(c)); });
    }
    listScreen.appendChild(scroll);
  }

  function card(c) {
    var ck0 = H().catOf(c);
    var active = (ck0 === 'both')
      ? !!((H().getActive('normal') && H().getActive('normal').id === c.id) || (H().getActive('audio') && H().getActive('audio').id === c.id))
      : !!(H().getActive(ck0) && H().getActive(ck0).id === c.id);
    var cardEl = el('div');
    cardEl.style.cssText = 'position:relative;display:flex;align-items:center;gap:10px;cursor:pointer;' +
      'margin:0 18px 10px;padding:13px 40px 13px 14px;border-radius:16px;' +
      'background:var(--tile-bg);box-shadow:inset 0 1px 0 var(--hl-soft);' +
      (active ? 'border:2px solid #2ea043' : 'border:1px solid var(--line)');

    var tile = el('div', 'sub-tile ' + (active ? 't1' : 't2'), esc(providerLabel(c.provider).charAt(0)));
    tile.style.cssText += ';width:40px;height:40px;font-size:17px;border-radius:12px';
    cardEl.appendChild(tile);

    var main = el('div');
    main.style.cssText = 'flex:1;min-width:0';
    var nm = el('div', null, esc(providerLabel(c.provider)));
    nm.style.cssText = 'font-size:13.5px;font-weight:700;color:var(--ink)';
    main.appendChild(nm);
    var ck = H().catOf(c);
    var catChip = UI.chip(ck === 'audio' ? 'AUDIO · transcript' : ck === 'normal' ? 'NORMAL · text/summary' : 'DONO · normal + audio');
    catChip.style.cssText += ';font-size:8.5px;' + (ck === 'audio'
      ? 'background:rgba(160,106,0,.12);color:#a06a00;border-color:rgba(160,106,0,.35)'
      : ck === 'normal'
        ? 'background:rgba(46,160,67,.12);color:#2ea043;border-color:rgba(46,160,67,.35)'
        : 'background:rgba(74,144,217,.12);color:#4a90d9;border-color:rgba(74,144,217,.35)');
    main.appendChild(catChip);
    var md = el('div', null, esc(c.model || c.audioModel || '(model khali)') +
      (c.audioModel ? ' · audio: ' + esc(c.audioModel) : '') +
      (c.baseUrl ? ' · ' + esc(c.baseUrl) : ''));
    md.style.cssText = 'font-size:10.5px;color:var(--ash);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    main.appendChild(md);
    cardEl.appendChild(main);

    /* OK ka nishan + active green tick */
    var marks = el('div');
    marks.style.cssText = 'display:flex;gap:5px;align-items:center;flex:none';
    var okc = UI.chip('✓');
    okc.style.cssText += ';font-size:10px;background:rgba(46,160,67,.12);color:#2ea043;border-color:rgba(46,160,67,.35)';
    marks.appendChild(okc);
    if (active) {
      var ac = UI.chip('chosen');
      ac.style.cssText += ';font-size:9px;background:#2ea043;color:#fff;border-color:#2ea043';
      marks.appendChild(ac);
    }
    cardEl.appendChild(marks);

    /* kebab : Edit / Delete (confirm ke saath) */
    var pop = UI.makeKebabPop(function () { openForm(c); }, function () {
      H().remove(c.id);
      renderList();
      show(listScreen);
    });
    var k = UI.miniBtn(UI.icons.kebab, 'Edit or delete');
    k.style.cssText += ';position:absolute;top:8px;right:8px';
    k.addEventListener('click', function (ev) { ev.stopPropagation(); UI.togglePop(pop); });
    cardEl.appendChild(k);
    cardEl.appendChild(pop);

    /* tap = choose */
    cardEl.addEventListener('click', function () {
      H().setActive(c.id);
      renderList();
      show(listScreen);
    });
    return cardEl;
  }

  function openList() {
    var act = document.querySelector('section.screen.active');
    if (act && (!listScreen || act !== listScreen) && (!formScreen || act !== formScreen)) opener = act;
    renderList();
    show(listScreen);
  }

  /* ================================================================
     2) ADD / EDIT AI SCREEN
  ================================================================ */
  function openForm(existing) {
    if (!formScreen) formScreen = screenBase();
    formScreen.innerHTML = '';
    headFor(formScreen, existing ? 'Edit AI' : 'Add AI', function () {
      renderList();
      show(listScreen);
    });

    var scroll = el('div', 'scroll');
    var box = el('div');
    box.style.cssText = 'margin:6px 18px 16px;padding:14px;border:1px solid var(--line);border-radius:18px;' +
      'background:var(--tile-bg);box-shadow:inset 0 1px 0 var(--hl-soft)';

    box.appendChild(UI.label('Provider'));
    var provR = UI.chipRow(H().PROVIDERS.map(function (p) { return p.label; }),
      existing ? providerLabel(existing.provider) : 'OpenAI');
    provR.row.style.margin = '6px 0 12px';
    box.appendChild(provR.row);

    box.appendChild(UI.label('Category (ye AI kis kaam ke liye hai)'));
    var catInit = (existing && existing.cat === 'audio') ? 'Audio (transcript)'
      : (existing && existing.cat === 'normal') ? 'Normal (text/summary)'
      : 'Dono (normal + audio)';
    var catR = UI.chipRow(['Normal (text/summary)', 'Audio (transcript)', 'Dono (normal + audio)'], catInit);
    catR.row.style.margin = '6px 0 12px';
    box.appendChild(catR.row);

    var baseF = UI.inputField('Base URL (Custom ke liye zaroori)', 'https://api.example.com/v1');
    if (existing) baseF.input.value = existing.baseUrl || '';
    box.appendChild(baseF.wrap);

    var modelF = UI.inputField('Model (chat / structured calls ke liye)', 'e.g. gpt-4o-mini / gemini-2.0-flash');
    if (existing) modelF.input.value = existing.model || '';
    box.appendChild(modelF.wrap);

    var audioF = UI.inputField('Audio model (optional — recording/transcript ke liye)',
      'OpenAI: whisper-1 · Gemini: khali chhodo (chat model hi chalega)');
    if (existing) audioF.input.value = existing.audioModel || '';
    box.appendChild(audioF.wrap);
    var audioNote = el('div', null, 'Khali chhoda to purpose-default lagega (OpenAI par whisper-1, ' +
      'Gemini par aapka chat model, Custom par aapka model). Jo aap yahan likhoge, wahi jaayega.');
    audioNote.style.cssText = 'font-size:10px;color:var(--ash);line-height:1.5;margin:-6px 0 12px';
    box.appendChild(audioNote);

    /* API key : password + eye */
    box.appendChild(UI.label('API key'));
    var keyWrap = el('div');
    keyWrap.style.cssText = 'position:relative;margin-bottom:12px';
    var keyIn = el('input');
    keyIn.type = 'password';
    keyIn.placeholder = 'apni API key';
    keyIn.autocomplete = 'off';
    keyIn.style.cssText = UI.fieldCss + ';padding-right:42px';
    if (existing) keyIn.value = existing.key || '';
    var eye = UI.miniBtn('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>', 'Key dekhein/chhupayein');
    eye.style.cssText += ';position:absolute;right:8px;top:50%;transform:translateY(-50%)';
    eye.addEventListener('click', function () {
      keyIn.type = keyIn.type === 'password' ? 'text' : 'password';
    });
    keyWrap.appendChild(keyIn);
    keyWrap.appendChild(eye);
    box.appendChild(keyWrap);

    var err = el('div');
    err.style.cssText = 'display:none;font-size:11.5px;line-height:1.5;color:#c0392b;margin-bottom:8px';
    box.appendChild(err);

    var saveB = UI.solidBtn('Save AI');
    saveB.addEventListener('click', function () {
      var provLabel = provR.get();
      var provId = 'openai';
      H().PROVIDERS.forEach(function (p) { if (p.label === provLabel) provId = p.id; });
      var key = (keyIn.value || '').trim();
      if (!key) {
        err.textContent = 'API key zaroori hai.';
        err.style.display = 'block';
        keyIn.focus();
        return;
      }
      var vals = {
        provider: provId,
        baseUrl: (baseF.input.value || '').trim(),
        model: (modelF.input.value || '').trim(),
        audioModel: (audioF.input.value || '').trim(),
        cat: (catR.get() === 'Audio (transcript)') ? 'audio'
          : (catR.get() === 'Normal (text/summary)') ? 'normal' : 'both',
        key: key
      };
      if (provId === 'custom' && !vals.baseUrl) {
        err.textContent = 'Custom provider ke liye Base URL zaroori hai.';
        err.style.display = 'block';
        return;
      }
      if (existing) H().update(existing.id, vals);
      else {
        var c = H().add(vals);
        /* apni role(s) mein pehla card → apne aap chosen */
        var roles = vals.cat === 'both' ? ['normal', 'audio'] : [vals.cat];
        roles.forEach(function (r) { if (!H().getActive(r)) H().setActive(c.id); });
      }
      renderList();
      show(listScreen);
    });
    box.appendChild(saveB);
    scroll.appendChild(box);
    formScreen.appendChild(scroll);
    show(formScreen);
  }

  /* ================================================================
     PER-FEATURE PICK SHEET — canvas/thought/waghaira isi se apni
     pasand ka AI chunte hain (list wahi jo Settings → AI mein hai)
  ================================================================ */
  function openPickSheet(currentId, onPick, filterCat) {
    var m = UI.modal({ zScrim: 94, zWrap: 95 });
    m.open('Choose AI', function (body) {
      var info = el('div', null, 'Is feature ke liye kaun sa AI provider use ho — yahan chuno. ' +
        '"App default" = Settings → AI mein jo chosen hai.');
      info.style.cssText = 'font-size:11px;color:var(--ash);line-height:1.6;margin-bottom:10px';
      body.appendChild(info);
      function row(label, id, isDefault) {
        var on = (id === '' && !currentId) || (id !== '' && currentId === id);
        var r = el('div');
        r.style.cssText = 'display:flex;align-items:center;gap:9px;padding:9px 4px;cursor:pointer;' +
          'border-bottom:1px solid var(--line)';
        r.appendChild(UI.roundCheck(on));
        var nm = el('div', null, esc(label));
        nm.style.cssText = 'flex:1;font-size:13px;font-weight:' + (on ? '700' : '500') + ';color:var(--ink)';
        r.appendChild(nm);
        if (isDefault) {
          var d = UI.chip('default');
          d.style.cssText += ';font-size:9px';
          r.appendChild(d);
        }
        r.addEventListener('click', function () {
          m.close();
          if (onPick) onPick(id);
        });
        body.appendChild(r);
      }
      var shown = H().list().filter(function (c) {
        if (!filterCat) return true;
        var ck = H().catOf(c);
        return ck === 'both' || ck === filterCat;
      });
      var act = H().getActive(filterCat === 'audio' ? 'audio' : 'normal');
      row('App default' + (act ? ' (' + act.provider + ' · ' + (act.model || 'default') + ')' : ''), '', true);
      shown.forEach(function (c) {
        var mName = (filterCat === 'audio')
          ? (c.audioModel || c.model || 'default')
          : (c.model || c.audioModel || 'default');
        row(c.provider + ' · ' + mName +
          (filterCat ? '' : (' · ' + H().catOf(c))), c.id, false);
      });
      if (!shown.length) {
        var add = UI.pillBtn('+ Settings → AI mein add karo');
        add.style.marginTop = '10px';
        add.addEventListener('click', function () {
          m.close();
          openList();
        });
        body.appendChild(add);
      }
    }, null);
  }

  window.AchivaAIHubSettings = {
    open: openList,
    openForm: openForm,
    openPickSheet: openPickSheet
  };
})();
