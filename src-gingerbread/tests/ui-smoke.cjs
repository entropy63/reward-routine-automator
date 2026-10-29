const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { browserOptions, browserName } = require('./browser-fixture.cjs');
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gingerbread-ui-check-'));
  const output = process.env.GINGERBREAD_UI_EVIDENCE || fs.mkdtempSync(path.join(os.tmpdir(), 'gingerbread-ui-evidence-'));
  fs.mkdirSync(output, {recursive: true});
  let context;
  try {
    const build = path.resolve(__dirname, '../dist');
    context = await chromium.launchPersistentContext(profile, browserOptions(build));
    context.setDefaultTimeout(15000);
    await context.route('https://**/*', route => route.fulfill({status:404,body:'offline fixture'}));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    async function checkRewardsLink(page) {
      const link=page.getByRole('link',{name:'Open Bing Rewards',exact:true});
      assert.equal(await link.getAttribute('href'),'https://rewards.bing.com/dashboard');
      const opened=context.waitForEvent('page');
      await link.click();
      const rewards=await opened;
      await rewards.waitForURL('https://rewards.bing.com/dashboard');
      assert.ok((await worker.evaluate(()=>chrome.windows.getAll())).every(window=>window.type==='normal'));
      await rewards.close();
    }
    async function waitLayout(test, message) {
      const until=Date.now()+10000;
      while(Date.now()<until){const state=await worker.evaluate(()=>chrome.storage.local.get(['popupWidgetLayout','dashHiddenWidgets','dashLayout']));if(test(state))return;await new Promise(resolve=>setTimeout(resolve,50))}
      throw Error(message);
    }
    await worker.evaluate(async () => {
      const {settings} = await chrome.storage.sync.get('settings');
      await chrome.storage.sync.set({settings:{...settings,startupEnabled:false,randomSearchEnabled:false,scheduledRunEnabled:false,refreshStatsOnPopupOpen:false,background:'cursor',animationsEnabled:true,lowPowerMode:false,mouseEscapeEnabled:false,appearance:'dark'}});
      await chrome.storage.local.set({pointsHistory:[{day:'2026-10-27',first:50,last:150,at:99},{day:'2026-10-28',first:100,last:250,at:100}],lastOrders:{at:100,total:1,orders:[{title:'coins',orderNo:'one',code:'PRIVATE_CODE'}]},
        lastStats:{at:Date.now(),availablePoints:250,activities:{bingApp:'0/1'}},redeemRestockNews:{at:100,labels:['500 coins']},redeemSoldOutNews:{at:101,labels:['2000 coins']}});
    });
    const errors=[];
    const popup = await context.newPage();
    popup.on('pageerror',error=>errors.push(error.message));
    await popup.setViewportSize({width:440,height:600});
    await popup.goto(`chrome-extension://${id}/index.html`);
    const noticeNames=['Bing app','restock','sold-out'];
    for (const name of noticeNames) await popup.getByRole('button',{name:`Dismiss ${name} notification`,exact:true}).waitFor();
    assert.ok(await popup.locator('.notice').evaluateAll(cards=>cards.every(card=>card.getBoundingClientRect().width<=344&&card.scrollWidth<=card.clientWidth)));
    await popup.screenshot({path:path.join(output,'compact-notifications.png')});
    await checkRewardsLink(popup);
    await popup.getByRole('button',{name:'Dismiss Bing app notification',exact:true}).focus();
    await popup.keyboard.press('Enter');
    for (const name of ['restock','sold-out']) await popup.getByRole('button',{name:`Dismiss ${name} notification`,exact:true}).click();
    const acknowledgements=await worker.evaluate(()=>chrome.storage.local.get(['dismissedNotice:bingApp','dismissedNotice:restock','dismissedNotice:soldOut']));
    assert.equal(Object.keys(acknowledgements).length,3);
    await popup.reload();
    await popup.locator('.brand-glyph').waitFor();
    assert.equal(await popup.locator('.notice').count(),0);
    await worker.evaluate(()=>chrome.storage.local.set({redeemRestockNews:{at:102,labels:['500 coins','1000 coins']}}));
    await popup.getByRole('button',{name:'Dismiss restock notification',exact:true}).waitFor();
    assert.equal(await popup.locator('.notice').count(),1,'New news appears after an earlier dismissal');
    await popup.getByRole('button',{name:'Dismiss restock notification',exact:true}).click();
    assert.deepEqual((await worker.evaluate(()=>chrome.storage.local.get('redeemRestockNews'))).redeemRestockNews,{at:102,labels:['500 coins','1000 coins']});
    const liveAcknowledgements=await worker.evaluate(()=>chrome.storage.local.get(['dismissedNotice:bingApp','dismissedNotice:restock','dismissedNotice:soldOut']));
    await worker.evaluate(async()=>{const{settings}=await chrome.storage.sync.get('settings');await chrome.storage.sync.set({settings:{...settings,developerOptionsEnabled:true}})});
    await popup.getByRole('button',{name:'Preview every banner',exact:true}).click();
    for (const name of noticeNames) await popup.getByRole('button',{name:`Dismiss ${name} notification`,exact:true}).waitFor();
    assert.ok(await popup.locator('.topbar').evaluate(e=>e.scrollWidth<=e.clientWidth),'Developer toolbar fits with the new shortcut');
    await popup.getByRole('button',{name:'Dismiss Bing app notification',exact:true}).click();
    assert.deepEqual(await worker.evaluate(()=>chrome.storage.local.get(['dismissedNotice:bingApp','dismissedNotice:restock','dismissedNotice:soldOut'])),liveAcknowledgements,'Preview dismissal does not change real acknowledgements');
    await popup.getByRole('button',{name:'Preview every banner',exact:true}).click();
    assert.equal(await popup.locator('.notice').count(),0);
    await popup.getByRole('button',{name:'Preview every banner',exact:true}).click();
    await popup.getByRole('button',{name:'Dismiss Bing app notification',exact:true}).waitFor();
    await popup.getByRole('button',{name:'Preview every banner',exact:true}).click();
    const update=await context.newPage();
    await update.addInitScript(()=>{window.__diskVersion='6.99.1';const original=window.fetch.bind(window);window.fetch=(input,options)=>String(input).endsWith('/manifest.json')?Promise.resolve(new Response(JSON.stringify({version:window.__diskVersion}),{status:200})):original(input,options)});
    await update.goto(`chrome-extension://${id}/index.html`);
    await update.getByRole('button',{name:'Dismiss update notification',exact:true}).click();
    assert.equal((await worker.evaluate(()=>chrome.storage.local.get('dismissedNotice:update')))['dismissedNotice:update'],'6.99.1');
    await update.reload();
    await update.locator('.brand-glyph').waitFor();
    assert.equal(await update.getByRole('button',{name:'Dismiss update notification',exact:true}).count(),0);
    await update.evaluate(()=>{window.__diskVersion='6.99.2';window.dispatchEvent(new Event('focus'))});
    await update.getByRole('button',{name:'Dismiss update notification',exact:true}).waitFor();
    await update.close();
    await worker.evaluate(async()=>{const{settings}=await chrome.storage.sync.get('settings');await chrome.storage.sync.set({settings:{...settings,developerOptionsEnabled:false}})});
    await popup.getByRole('navigation').getByRole('button',{name:'Today',exact:true}).click();
    await worker.evaluate(()=>chrome.storage.local.set({lastStats:{at:Date.now(),availablePoints:250,searchPoints:'60/60',activities:{bingSearch:'Day 4 of 7 · 1/1',dailySet:'Day 3 of 7 · 0/3',bingApp:'Day 2 of 7 · 0/1',visualSearch:'Day 0 of 7 · 0/1'}}}));
    const streakWidget=popup.locator('[data-widget-id="streaks"]');
    await streakWidget.locator('.streak-week').first().waitFor();
    assert.equal(await streakWidget.locator('.streak-week').count(),4);
    assert.equal(await streakWidget.locator('.streak-week').first().getByRole('listitem').count(),7);
    assert.equal(await streakWidget.locator('.streak-week').first().locator('[data-state="completed"]').count(),4);
    assert.equal(await streakWidget.locator('.streak-week').nth(1).locator('[data-state="pending"]').count(),1);
    await popup.screenshot({path:path.join(output,'redesigned-popup.png')});
    await popup.getByRole('button',{name:'Edit widgets',exact:true}).click();
    await popup.getByRole('combobox',{name:"Size of Today's streaks",exact:true}).selectOption('compact');
    await waitLayout(state=>state.popupWidgetLayout?.items.some(item=>item.id==='streaks'&&item.size==='compact'),'Popup widget size not saved');
    await popup.getByRole('button',{name:'Remove Points history',exact:true}).click();
    await waitLayout(state=>!state.popupWidgetLayout?.items.some(item=>item.id==='history'),'Popup widget removal not saved');
    await popup.reload();
    await popup.locator('[data-widget-id="streaks"].popup-widget--compact').waitFor();
    assert.equal(await popup.locator('[data-widget-id="history"]').count(),0);
    await popup.getByRole('button',{name:'Add widgets',exact:true}).click();
    const todayChooser=popup.getByRole('dialog',{name:'Today widgets',exact:true});
    await todayChooser.getByLabel('Points history',{exact:true}).check();
    await todayChooser.getByRole('button',{name:'Close',exact:true}).click();
    await popup.locator('[data-widget-id="history"] .history-chart').waitFor();
    await popup.getByRole('button',{name:'Add widgets',exact:true}).click();
    for(const label of ['Balance',"Today's streaks",'Points history','Points goal','Next routine'])await todayChooser.getByLabel(label,{exact:true}).uncheck();
    await todayChooser.getByRole('button',{name:'Close',exact:true}).click();
    await waitLayout(state=>state.popupWidgetLayout?.items.length===0,'Explicit empty popup layout not saved');
    await popup.getByRole('heading',{name:'Make room for what matters'}).waitFor();
    await popup.getByRole('button',{name:'Edit widgets',exact:true}).click();
    await popup.getByRole('button',{name:'Reset layout',exact:true}).click();
    await waitLayout(state=>!state.popupWidgetLayout,'Popup default layout not restored');
    await popup.getByRole('button',{name:'Done editing',exact:true}).click();
    await popup.getByRole('button',{name:'Settings',exact:true}).click();
    await popup.getByRole('heading',{name:'Backup and restore',exact:true}).waitFor();
    const downloadEvent=popup.waitForEvent('download');
    await popup.getByRole('button',{name:'Export backup',exact:true}).click();
    const download=await downloadEvent;
    await download.saveAs(path.join(output,'fixture-backup.json'));
    const backup=JSON.parse(fs.readFileSync(path.join(output,'fixture-backup.json'),'utf8'));
    assert.equal(backup.data.lastOrders,undefined);
    assert.equal(backup.settings.background,'cursor');
    backup.settings.redeemGoalPts=9999;
    backup.data.pointsHistory=[{day:'2026-10-28',first:0,last:1,at:1},{day:'2026-10-27',first:10,last:20,at:1}];
    // A download can complete before React commits the end of Export's busy
    // state. Use the real button so Playwright waits for actionability instead
    // of bypassing its disabled state through the hidden input.
    const chooseEvent=popup.waitForEvent('filechooser');
    await popup.getByRole('button',{name:'Choose backup',exact:true}).click();
    const chooser=await chooseEvent;
    await chooser.setFiles({name:'restore.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
    try { await popup.getByRole('heading',{name:'Review restore'}).waitFor() }
    catch (error) {
      console.error('Backup import did not reach review',await popup.locator('.backup-card').evaluate(card=>({
        error:card.querySelector('.backup-error')?.textContent,
        message:card.querySelector('.backup-message')?.textContent,
        buttons:[...card.querySelectorAll('button')].map(button=>({label:button.textContent,disabled:button.disabled})),
      })));
      throw error;
    }
    await popup.getByRole('button',{name:'Restore reviewed backup',exact:true}).click();
    await popup.getByRole('status').filter({hasText:'Backup restored.'}).waitFor();
    const restored=await worker.evaluate(async()=>({sync:await chrome.storage.sync.get('settings'),local:await chrome.storage.local.get(['pointsHistory','lastOrders','gingerbreadBeforeRestore'])}));
    assert.equal(restored.sync.settings.redeemGoalPts,9999);
    assert.equal(restored.local.pointsHistory.find(day=>day.day==='2026-10-28').last,250);
    assert.equal(restored.local.lastOrders.orders[0].code,'PRIVATE_CODE');
    assert.ok(restored.local.gingerbreadBeforeRestore);
    await popup.getByRole('heading',{name:'Backup and restore'}).scrollIntoViewIfNeeded();
    await popup.screenshot({path:path.join(output,'backup-settings.png')});
    const finish=await context.newPage();
    finish.on('pageerror',error=>errors.push(error.message));
    await finish.addInitScript(()=>{const original=window.fetch.bind(window);window.fetch=(input,options)=>String(input).endsWith('/manifest.json')?Promise.resolve(new Response(JSON.stringify({version:'6.99.3'}),{status:200})):original(input,options)});
    await finish.setViewportSize({width:1100,height:780});
    await finish.goto(`chrome-extension://${id}/dashboard.html?dev=1&q=claim:unverified;keepEarning:unverified`);
    await finish.getByRole('dialog').waitFor();
    await finish.getByRole('button',{name:'Restart',exact:true}).waitFor();
    assert.equal(await finish.locator('.bg').count(),1);
    assert.equal(await finish.locator('.dash-gear').count(),0);
    assert.equal(await finish.locator('.finish-glyph').count(),0);
    assert.equal(await finish.evaluate(()=>document.activeElement?.textContent),'Done');
    await finish.keyboard.press('Tab');
    assert.equal(await finish.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Open Bing Rewards');
    await finish.keyboard.press('Shift+Tab');
    assert.equal(await finish.evaluate(()=>document.activeElement?.textContent),'Done');
    await checkRewardsLink(finish);
    for(const width of [320,380,768,1024,1440]){
      await finish.setViewportSize({width,height:780});
      assert.ok(await finish.locator('.finish-actions').evaluate(e=>e.scrollWidth<=e.clientWidth),'Finish actions fit narrow screens');
    }
    await finish.setViewportSize({width:1100,height:780});
    await finish.screenshot({path:path.join(output,'finish-one-background.png')});
    await finish.getByRole('button',{name:'Done',exact:true}).click();
    await finish.locator('.dash-gear').waitFor();
    await finish.locator('.dash-panel').first().waitFor();
    assert.equal(await finish.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Settings');
    await checkRewardsLink(finish);
    const controls=finish.locator('[data-panel-id="controls"]');
    await finish.getByRole('button',{name:'Add widgets',exact:true}).click();
    const dashboardChooser=finish.getByRole('dialog',{name:'Dashboard widgets',exact:true});
    await dashboardChooser.getByLabel("Today's streaks",{exact:true}).uncheck();
    await dashboardChooser.getByRole('button',{name:'Close',exact:true}).click();
    await waitLayout(state=>state.dashHiddenWidgets?.includes('streaks'),'Dashboard hide not saved');
    await finish.locator('[data-panel-id="streaks"]').waitFor({state:'hidden'});
    await finish.getByRole('button',{name:'Add widgets',exact:true}).click();
    await dashboardChooser.getByLabel("Today's streaks",{exact:true}).check();
    await dashboardChooser.getByRole('button',{name:'Close',exact:true}).click();
    await finish.locator('[data-panel-id="streaks"]').waitFor();
    await finish.getByRole('button',{name:'Edit layout',exact:true}).click();
    const size=controls.getByRole('combobox',{name:'Size of Run controls',exact:true});
    const nextSize=await size.locator('option').nth(1).getAttribute('value');
    await size.selectOption(nextSize);
    await waitLayout(state=>state.dashLayout?.items.some(item=>item.i==='controls'&&`${item.w}x${item.h}`===nextSize),'Dashboard resize not saved');
    await finish.getByRole('button',{name:'Default layout',exact:true}).click();
    await finish.getByRole('button',{name:'Done',exact:true}).click();
    assert.ok(await controls.locator('.dash-panel-body').evaluate(e=>e.scrollHeight<=e.clientHeight+1),'Smallest dashboard controls fit without scrolling');
    await controls.getByRole('button',{name:'More controls',exact:true}).click();
    await finish.getByRole('dialog',{name:'Routine controls',exact:true}).waitFor();
    assert.equal(await finish.evaluate(()=>document.activeElement?.textContent),'Close');
    await finish.keyboard.press('Escape');
    assert.equal(await finish.evaluate(()=>document.activeElement?.textContent),'More controls');
    for (const width of [380,768,1100,1440]) {
      await finish.setViewportSize({width,height:780});
      for (const automatic of [true,false]) {
        await worker.evaluate(async automatic=>{const{settings}=await chrome.storage.sync.get('settings');await chrome.storage.sync.set({settings:{...settings,rightSizeSearchBatch:automatic,experimentalFeatures:true}})},automatic);
        await controls.getByRole('spinbutton',{name:'Searches per batch',exact:true}).waitFor({state:automatic?'hidden':'visible'});
        try { await finish.waitForFunction(()=>{const body=document.querySelector('[data-panel-id="controls"] .dash-panel-body');return body&&body.scrollHeight<=body.clientHeight+1},undefined,{timeout:3000}) }
        catch (error) {
          console.error('Controls overflow', {viewportWidth:width,automatic,...await controls.locator('.dash-panel-body').evaluate(e=>({height:e.clientHeight,scroll:e.scrollHeight,bodyWidth:e.clientWidth}))});
          await finish.screenshot({path:path.join(output,'controls-overflow.png')});throw error;
        }
      }
    }
    await finish.setViewportSize({width:1100,height:780});
    await finish.waitForFunction(()=>Array.from(document.querySelectorAll('.react-grid-item')).every(item=>item.getBoundingClientRect().right<=window.innerWidth+1));
    await finish.screenshot({path:path.join(output,'dashboard-controls.png')});
    await worker.evaluate(async()=>{const{settings}=await chrome.storage.sync.get('settings');await chrome.storage.sync.set({settings:{...settings,lowPowerMode:true}})});
    await finish.locator('.cursor-glow--rest').waitFor();
    await worker.evaluate(async()=>{const{settings}=await chrome.storage.sync.get('settings');await chrome.storage.sync.set({settings:{...settings,lowPowerMode:false,theme:'nord'}})});
    await finish.locator('.cursor-dot').waitFor();
    assert.equal(await finish.locator('html').getAttribute('data-theme'),'nord');
    await finish.emulateMedia({reducedMotion:'reduce'});
    await finish.locator('.cursor-glow--rest').waitFor();
    await finish.emulateMedia({reducedMotion:'no-preference'});
    await finish.locator('.cursor-dot').waitFor();
    await finish.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))});
    await finish.locator('.cursor-glow--rest').waitFor();
    const failure=await context.newPage();
    await failure.addInitScript(()=>{const read=chrome.storage.sync.get.bind(chrome.storage.sync);chrome.storage.sync.get=(...args)=>window.__retryStorage ? read(...args):Promise.reject(new Error('Fixture storage outage'))});
    await failure.goto(`chrome-extension://${id}/index.html`);
    await failure.getByRole('heading',{name:'Settings unavailable'}).waitFor();
    await failure.screenshot({path:path.join(output,'storage-error.png')});
    await failure.evaluate(()=>{window.__retryStorage=true});
    await failure.getByRole('button',{name:'Try again'}).click();
    await failure.locator('.brand-glyph').waitFor();
    assert.equal(await worker.evaluate(async()=>(await chrome.storage.sync.get('settings')).settings.redeemGoalPts),9999);
    await worker.evaluate(()=>chrome.storage.local.set({runState:{v:1,stopEpoch:0,activity:{label:'Fixture busy'},batch:null,routine:null,rightSizeRun:null,captures:{capturing:[],opened:{}}}}));
    await failure.getByRole('navigation').getByRole('button',{name:'Run',exact:true}).click();
    await failure.getByRole('button',{name:'Run the routine',exact:true}).click();
    await failure.locator('.action-feedback').filter({hasText:'current activity'}).waitFor();
    await failure.getByRole('button',{name:'Dismiss action message'}).click();
    assert.equal(await failure.locator('.action-feedback').count(),0);
    await finish.getByRole('button',{name:'Run the routine',exact:true}).click();
    await finish.locator('.action-feedback').filter({hasText:'current activity'}).waitFor();
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,browser:browserName(),version:JSON.parse(fs.readFileSync(path.join(build,'manifest.json'),'utf8')).version,popupWidgetsAddRemoveResize:true,dashboardWidgetsAddRemoveResize:true,emptyLayoutAndReset:true,sevenSegmentEvidence:true,sharedHistory:true,compactDismissibleNotices:true,dismissalsSurviveReopen:true,newNewsAndUpdateReappear:true,previewIsolated:true,rewardsLinksOnAllThreeSurfaces:true,narrowFinishActions:true,backupRoundtrip:true,ordersExcludedByDefault:true,mergePreservesCurrent:true,recoveryBackup:true,oneFinishBackground:true,finishFocusTrap:true,liveLowPower:true,liveTheme:true,reducedMotion:true,hiddenMotionPaused:true,storageErrorRetry:true,commandErrorsVisible:true,output}));
  } finally {
    if(context)await context.close();
    if(!path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(profile).startsWith('gingerbread-ui-check-'))throw Error('Unsafe cleanup path');
    fs.rmSync(profile,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1});
