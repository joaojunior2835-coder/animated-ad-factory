// Browser -> keyless isolated backend -> real local analysis -> Mock M5 -> M6.
import { chromium } from 'playwright'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aaf-remix-browser-')),api='http://127.0.0.1:8796'
const env={...process.env,PORT:'8796',FACTORY_DB_PATH:path.join(temp,'factory.db'),FACTORY_MEDIA_ROOT:path.join(temp,'media'),MOCK_VIDEO_DELAY_MS:'1200',PRODUCTION_POLL_INTERVAL_MS:'100',FAL_API_KEY:'',REPLICATE_API_TOKEN:'',POLLINATIONS_API_KEY:'',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:'',GROQ_API_KEY:'',GEMINI_API_KEY:'',OPENROUTER_API_KEY:''}
const wait=ms=>new Promise(r=>setTimeout(r,ms)),video=path.join(temp,'reference.mp4'),image=path.join(temp,'product.png')
const tool=process.env.FFMPEG_PATH || path.join(process.env.ProgramFiles,'DICloak','vendor','ffmpeg','bin','ffmpeg.exe')
const fixture=args=>{const result=spawnSync(tool,args,{windowsHide:true});assert.equal(result.status,0,result.stderr?.toString())}
let server,browser,page,passed=0
const check=async(name,fn)=>{await fn();passed++;console.log('PASS '+name)}
const read=async id=>(await (await fetch(api+'/api/operator/generator/'+id)).json()).workspace
async function saved(){await page.getByText('Saved locally',{exact:true}).waitFor()}
try{
  try{if((await fetch(api+'/health')).ok)throw new Error('QA port is occupied')}catch(e){if(e.message.includes('occupied'))throw e}
  fixture(['-y','-f','lavfi','-i','testsrc2=size=640x640:rate=24','-t','3','-c:v','libx264','-pix_fmt','yuv420p',video])
  fixture(['-y','-f','lavfi','-i','color=red:s=512x512','-frames:v','1',image])
  server=spawn(process.execPath,['server/index.mjs'],{env,windowsHide:true,stdio:'ignore'})
  let healthy=false;for(let i=0;i<60;i++){try{const r=await fetch(api+'/health');if(r.ok){assert.ok(Object.values((await r.json()).providers_configured).every(v=>v===false));healthy=true;break}}catch{}await wait(200)}assert.ok(healthy)
  browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1440,height:1000}})
  await context.addInitScript(url=>localStorage.setItem('API_BASE_URL',url),api)
  const external=[],errors=[]
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(!['localhost','127.0.0.1'].includes(u.hostname)){external.push(u.hostname);return route.abort()}return route.continue()})
  page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
  await check('Create Ad has obvious scratch / remix navigation',async()=>{await page.goto('http://127.0.0.1:5173');await page.getByTestId('creative-generator').waitFor();await page.getByRole('button',{name:/Remix Reference Ad/}).click();await page.getByText('New Product Test',{exact:true}).click();await page.getByLabel('Product name',{exact:true}).fill('Our travel suitcase');await page.getByRole('button',{name:'Create Product Test',exact:true}).click();await page.getByLabel('Product Test',{exact:true}).getByRole('option',{name:'Our travel suitcase'}).waitFor({state:'attached'})})
  for(const [idx,mode] of ['product_swap','background_swap','full_remix'].entries()){
    const id=idx+1,scene=()=>page.getByTestId('generator-scene-1')
    await check(mode+': upload video/image and type one instruction',async()=>{
      await page.getByLabel('New Creative title').fill(mode);await page.getByRole('button',{name:'Create Creative',exact:true}).click();await page.getByRole('heading',{name:mode,exact:true}).waitFor()
      await scene().waitFor();await saved();assert.equal((await read(id)).scenes.length,1)
      if(mode==='background_swap')await scene().getByLabel('Reference video from Media Library',{exact:true}).selectOption(String((await read(1)).scenes[0].remix.sourceAssetId));else await scene().getByLabel('Upload reference video',{exact:true}).setInputFiles(video);await scene().getByText(/Original preserved locally/).waitFor();await saved()
      if(mode==='background_swap'){await scene().getByLabel('Reference image from Media Library',{exact:true}).selectOption(String((await read(1)).scenes[0].remix.images[0].assetId));await scene().getByRole('button',{name:'Add selected reference',exact:true}).click()}else await scene().getByLabel('Upload reference image',{exact:true}).setInputFiles(image);await scene().getByAltText('@Product reference').waitFor();await saved()
      if(mode!=='product_swap')await scene().getByLabel('Remix mode',{exact:true}).selectOption(mode)
      if(mode==='background_swap')await scene().getByLabel('Reference 1 role',{exact:true}).selectOption('BACKGROUND')
      await scene().getByLabel('What should change?',{exact:true}).fill(mode==='background_swap'?'Rebuild the environment from @Background and keep the camera.':'Replace the suitcase with my black suitcase and keep the camera, motion, room and pacing.')
      await saved();assert.equal((await read(id)).scenes[0].remix.editMode,mode)
    })
    await check(mode+': automatic preparation; Advanced editing remains optional',async()=>{
      await scene().getByText(/Reference analyzed/).waitFor();await saved()
      if(mode==='product_swap'){
        assert.equal(await scene().locator('.remix-advanced').getAttribute('open'),null)
        for(const name of ['Analyze reference','Build adapted script & prompt'])assert.equal(await scene().getByRole('button',{name,exact:true}).isVisible(),false)
        assert.equal(await scene().getByLabel('Adapted Script',{exact:true}).isVisible(),false)
        const w=await read(id);assert.ok(w.scenes[0].remix.promptContext);assert.equal(w.scenes[0].remix.scriptApproved,true);assert.ok(w.scenes[0].prompt.includes('Replace the suitcase'));assert.equal(w.scenes[0].runId,undefined);return
      }
      await scene().getByText('Advanced / View Analysis',{exact:true}).click();await scene().getByText('Editable beat timeline',{exact:true}).waitFor()
      assert.equal(await scene().locator('.remix-frames img').count(),6)
      await scene().getByLabel('Beat / creative mechanism').first().fill('Hook, product demonstration, CTA')
      await scene().getByLabel('Observed subjects, product, environment & creative structure').fill('Casual product demonstration. Close framing, calm pacing. Adapt the hook and CTA to our suitcase; no competitor claims.')
      await scene().getByText('Structured creative analysis · editable',{exact:true}).click();await scene().getByLabel('Analysis: Hook structure',{exact:true}).fill('Question, then product reveal');await scene().getByLabel('Analysis: Setting',{exact:true}).fill('Bedroom');await scene().getByLabel('Original Transcript',{exact:true}).fill('Competitor sentence not approved for copying.')
      await saved();await scene().getByRole('button',{name:'Build adapted script & prompt',exact:true}).click();await saved()
      await scene().getByText('Advanced Prompt · editable',{exact:true}).click();assert.match(await scene().getByLabel('Seedance reference prompt').inputValue(),/@Video1/)
      assert.ok(!(await scene().getByLabel('Seedance reference prompt').inputValue()).includes('Competitor sentence'))
      await scene().getByLabel('Seedance reference prompt').fill((await scene().getByLabel('Seedance reference prompt').inputValue())+'\nKeep natural lighting.')
      await saved()
      assert.equal((await read(id)).scenes[0].remix.scriptApproved,true)
    })
    await check(mode+': authoritative estimate / explicit Mock confirmation / no hidden submit',async()=>{
      await scene().getByRole('button',{name:'Generate remix',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Confirm scene generation'});await dialog.waitFor();assert.match(await dialog.innerText(),/1 reference video/);assert.match(await dialog.innerText(),/€0.00/)
      const firstQuote=(await read(id)).quote;assert.equal((await read(id)).scenes[0].runId,undefined);await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
      if(mode==='product_swap')await scene().getByLabel('What should change?',{exact:true}).fill('Replace the suitcase with my black suitcase and keep a calm tracking shot.')
      await scene().getByRole('button',{name:'Generate remix',exact:true}).click();await dialog.waitFor();const quoted=await read(id);assert.notEqual(quoted.quote.token,firstQuote.token)
      if(mode==='product_swap'){assert.match(quoted.scenes[0].prompt,/calm tracking shot/);assert.equal(await scene().locator('.remix-advanced').getAttribute('open'),null)}
      await page.getByRole('dialog').getByRole('button',{name:'Confirm generation',exact:true}).click()
      await scene().getByRole('button',{name:'Use as Scene',exact:true}).waitFor();const w=await read(id);assert.equal(w.scenes[0].details.run.jobs.length,1);assert.equal(w.scenes[0].details.attempts.length,1);assert.equal(w.scenes[0].details.run.jobs[0].inputParams.generation_mode,'reference_to_video');assert.equal(w.scenes[0].details.costs.length,0)
    })
    await check(mode+': original/remix playback, refresh, use as Creative via M6',async()=>{
      await scene().getByRole('button',{name:'Restart / play both',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('.remix-video-pair video')].every(v=>v.currentTime>.1&&!v.paused))
      await page.reload();await scene().getByRole('button',{name:'Use as Creative',exact:true}).waitFor();assert.equal(await scene().locator('.remix-video-pair video').count(),2)
      // Hold the assembly response to prove comparison download cannot silently
      // ignore a click while the shared action lock is still finishing.
      let releaseAssembly;const assemblyGate=new Promise(resolve=>{releaseAssembly=resolve})
      await page.route(api+`/api/operator/generator/${id}/assemble`,async route=>{const response=await route.fetch();await assemblyGate;await route.fulfill({response})})
      await scene().getByRole('button',{name:'Use as Creative',exact:true}).click();assert.equal(await scene().getByRole('button',{name:'Download remix',exact:true}).isDisabled(),true);releaseAssembly()
      await page.getByRole('button',{name:'Download final MP4',exact:true}).waitFor({timeout:90000});await page.unroute(api+`/api/operator/generator/${id}/assemble`);const w=await read(id);assert.equal(w.final.run.status,'complete');assert.equal(w.final.sources.length,1)
      const event=page.waitForEvent('download');await scene().getByRole('button',{name:'Download remix',exact:true}).click();assert.equal((await event).suggestedFilename(),'final-ad.mp4')
      await scene().locator('.remix-comparison').scrollIntoViewIfNeeded();await page.screenshot({path:`qa-artifacts/remix-${mode}-comparison.png`})
    })
  }
  await check('Long adapted script splits into shared-reference segments, editable before spending',async()=>{
    const s=page.getByTestId('generator-scene-1');await s.getByText('Advanced / View Analysis',{exact:true}).click();await s.getByLabel('Adapted Script',{exact:true}).fill('Meet our suitcase and follow the start of a new journey. Show the front of the suitcase in a calm natural opening shot. Move closer and demonstrate the handle and wheels without adding any unverified claims. End with a simple invitation to discover the suitcase and its design.')
    await saved();await s.getByRole('button',{name:'Split script into linked segments',exact:true}).click();await page.getByTestId('generator-scene-2').waitFor();await saved();const w=await read(3);assert.ok(w.scenes.length>=2);assert.ok(w.scenes.every(s=>s.remix.preparedAssetId===w.scenes[0].remix.preparedAssetId));assert.ok(w.scenes.every(s=>s.remix.scriptApproved));assert.ok(w.scenes.every(s=>s.seconds<=15))
  })
  await check('Reuse a completed remix in a new Creative without copying the Asset or generating',async()=>{
    await page.getByLabel('Creative',{exact:true}).selectOption('1');const source=await read(1),s=page.getByTestId('generator-scene-1');await s.getByRole('button',{name:'Use as Creative',exact:true}).waitFor()
    await s.getByText('Use in another Creative',{exact:true}).click();await s.getByLabel('New remix Creative title',{exact:true}).fill('Reusable suitcase scene');await s.getByRole('button',{name:'Add remix to Creative',exact:true}).click();await page.getByRole('heading',{name:'Reusable suitcase scene',exact:true}).waitFor()
    const target=await read(4);assert.equal(target.scenes[0].media.id,source.scenes[0].media.id);assert.equal(target.scenes[0].runId,undefined);assert.equal(target.scenes[0].reuseSource.creativeId,1);assert.equal(target.scenes[0].remix.instructions,source.scenes[0].remix.instructions)
    await page.getByTestId('generator-scene-1').getByRole('button',{name:'Use as Scene',exact:true}).click();await page.getByText('1 / 1 approved',{exact:true}).waitFor()
  })
  await check('Backend restart and browser refresh preserve reused remix and instruction',async()=>{
    server.kill();await new Promise(resolve=>server.once('exit',resolve));server=spawn(process.execPath,['server/index.mjs'],{env,windowsHide:true,stdio:'ignore'})
    let ready=false;for(let n=0;n<60;n++){try{if((await fetch(api+'/health')).ok){ready=true;break}}catch{}await wait(200)}assert.ok(ready)
    await page.reload();await page.getByText('1 / 1 approved',{exact:true}).waitFor();const w=await read(4);assert.equal(w.scenes[0].remix.instructions,(await read(1)).scenes[0].remix.instructions);assert.equal(w.scenes[0].media.id,(await read(1)).scenes[0].media.id)
  })
  await check('Persisted progress phases and manual-reconciliation rendering remain distinct',async()=>{
    const original=await (await fetch(api+'/api/operator/generator/4')).json()
    for(const phase of ['Preparing references','Uploading references','Downloading']){
      await page.route(api+'/api/operator/generator/4',route=>{const data=structuredClone(original);Object.assign(data.workspace.scenes[0],{status:'Queued',displayStatus:phase,approved:false});return route.fulfill({json:data})});await page.reload();await page.getByTestId('generator-scene-1').getByRole('status').filter({hasText:phase}).waitFor();assert.equal(await page.getByTestId('generator-scene-1').getByRole('button',{name:'Regenerate remix',exact:true}).isDisabled(),true);await page.unroute(api+'/api/operator/generator/4')
    }
    await page.reload()
  })
  await check('Automatic analysis failure blocks generation and preserves upload for non-paid retry',async()=>{
    await page.setViewportSize({width:390,height:844});await page.getByLabel('New Creative title').fill('Mobile motion remix');await page.getByRole('button',{name:'Create Creative',exact:true}).click();await page.getByRole('heading',{name:'Mobile motion remix',exact:true}).waitFor()
    const s=page.getByTestId('generator-scene-1');await s.getByLabel('Remix mode',{exact:true}).selectOption('motion_transfer');await saved()
    let release;const gate=new Promise(resolve=>{release=resolve})
    await page.route(api+'/api/operator/references/analyze',async route=>{await gate;return route.fulfill({status:503,json:{ok:false,error:'Local analysis unavailable (QA)'}})})
    await s.getByLabel('Upload reference video',{exact:true}).setInputFiles(video);await s.getByText('Analyzing reference…',{exact:true}).waitFor();assert.equal(await s.getByRole('button',{name:'Generate remix',exact:true}).isDisabled(),true);release()
    await s.getByRole('button',{name:'Retry reference analysis',exact:true}).waitFor();await saved();let w=await read(5);assert.ok(w.scenes[0].remix.sourceAssetId);assert.equal(w.scenes[0].remix.preparedAssetId,null);assert.equal(w.scenes[0].runId,undefined);assert.equal(await s.getByRole('button',{name:'Generate remix',exact:true}).isDisabled(),true)
    await page.unroute(api+'/api/operator/references/analyze');await s.getByRole('button',{name:'Retry reference analysis',exact:true}).click();await s.getByText(/Reference analyzed/).waitFor();await saved();w=await read(5);assert.ok(w.scenes[0].remix.preparedAssetId)
  })
  await check('Mobile Motion Transfer: references + one sentence -> confirmation -> result, Advanced never opened',async()=>{
    const s=page.getByTestId('generator-scene-1');await s.getByLabel('Upload reference image',{exact:true}).setInputFiles(image);await s.getByAltText('@Product reference').waitFor();await saved()
    await s.getByLabel('What should change?',{exact:true}).fill('Use the motion from this video with my suitcase in the same room.');await saved();assert.equal(await s.locator('.remix-advanced').getAttribute('open'),null)
    await s.locator('.reference-remix').scrollIntoViewIfNeeded();await page.screenshot({path:'qa-artifacts/remix-simple-mobile.png'})
    await s.getByRole('button',{name:'Generate remix',exact:true}).click();await page.getByRole('dialog',{name:'Confirm scene generation'}).waitFor();assert.equal((await read(5)).scenes[0].runId,undefined)
    await page.getByRole('dialog').getByRole('button',{name:'Confirm generation',exact:true}).click();await s.getByRole('button',{name:'Use as Scene',exact:true}).waitFor()
    const w=await read(5);assert.equal(w.scenes[0].remix.editMode,'motion_transfer');assert.equal(w.scenes[0].details.run.jobs.length,1);assert.equal(w.scenes[0].details.attempts.length,1);assert.equal(w.scenes[0].details.run.jobs[0].inputParams.generate_audio,false);assert.equal(await s.locator('.remix-advanced').getAttribute('open'),null)
  })
  await check('Mobile controls and comparison fit; no browser errors or external calls',async()=>{
    await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.getByTestId('generator-scene-1').scrollIntoViewIfNeeded();await page.screenshot({path:'qa-artifacts/remix-mobile.png'});assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  })
  await check('Older saved draft generates a fresh quote without Advanced or re-editing its instruction',async()=>{
    await page.getByLabel('New Creative title').fill('Older saved draft');await page.getByRole('button',{name:'Create Creative',exact:true}).click();await page.getByRole('heading',{name:'Older saved draft',exact:true}).waitFor()
    const old=await read(6),reference=(await read(5)).scenes[0]
    const scene={...old.scenes[0],remix:{...reference.remix,script:'',scriptApproved:false,promptContext:''},prompt:''}
    const response=await fetch(api+'/api/operator/generator/6/scenes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:old.revision,scenes:[scene]})});assert.equal(response.status,200)
    await page.reload();const editor=page.getByTestId('generator-scene-1');await editor.getByRole('button',{name:'Generate remix',exact:true}).click();await page.getByRole('dialog',{name:'Confirm scene generation'}).waitFor()
    const ready=await read(6);assert.ok(ready.scenes[0].remix.promptContext);assert.equal(ready.scenes[0].remix.scriptApproved,true);assert.equal(ready.scenes[0].runId,undefined);assert.equal(await editor.locator('.remix-advanced').getAttribute('open'),null)
    await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  })
  console.log(`Reference Remix browser QA: ${passed}/${passed} PASS; 0 real paid calls`)
}catch(error){if(page){console.error((await page.locator('body').innerText()).slice(-14000));await page.screenshot({path:'qa-artifacts/remix-error.png',fullPage:true})}throw error}
finally{await browser?.close();if(server){server.kill();await Promise.race([new Promise(resolve=>server.once('exit',resolve)),wait(3000)])}fs.rmSync(temp,{recursive:true,force:true})}
