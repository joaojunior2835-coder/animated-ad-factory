// Component interaction QA only. Root coordinates the Vite server; every data
// request is intercepted, no real database or generation/upload provider is used.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const base = process.env.QA_BASE || 'http://localhost:5173'
const origin = new URL(base).origin
const artifacts = path.resolve('qa-artifacts/overnight-canvas')
await fs.mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({headless:true})
const context = await browser.newContext({viewport:{width:1440,height:900}})
let state = null, providerRequests = 0, registered = 0, savedFiles = 0, count = 0
const errors=[]
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#222529"/><circle cx="512" cy="560" r="310" fill="#30363a"/><rect x="376" y="290" width="272" height="480" rx="68" fill="#d5d4c5"/><rect x="413" y="225" width="198" height="110" rx="24" fill="#9ca884"/><rect x="404" y="435" width="216" height="185" rx="8" fill="#f4f1e7"/><text x="512" y="512" fill="#202820" font-size="31" text-anchor="middle" font-family="Arial">PRODUCT</text><text x="512" y="558" fill="#4f604a" font-size="17" text-anchor="middle" font-family="Arial">SYNTHETIC QA REFERENCE</text></svg>'
await context.route('**/*', async route=>{
  const url=new URL(route.request().url())
  if(url.pathname==='/__canvas_qa__/state') {if(route.request().method()==='PUT')state=route.request().postDataJSON().canvas;return route.fulfill({json:{canvas:state}})}
  if(url.pathname==='/__canvas_qa__/product.svg')return route.fulfill({contentType:'image/svg+xml',body:svg})
  if(url.pathname==='/mock-video-output.mp4'&&['localhost','127.0.0.1'].includes(url.hostname))return route.fulfill({contentType:'video/mp4',body:await fs.readFile(path.resolve('public/mock-video-output.mp4'))})
  if(url.pathname==='/api/media/save') {savedFiles++;return route.fulfill({json:{success:true,local_url:'/media/qa/upload.png',file_name:'upload.png',mime_type:'image/png',storage:'local_disk',file_size:100}})}
  if(url.pathname==='/api/assets/register-external') {registered++;assert.equal(route.request().postDataJSON().relativePath,'qa/upload.png');return route.fulfill({json:{item:{id:900,relative_path:'qa/upload.png',fileFoundOnDisk:true}}})}
  if(url.pathname==='/media/qa/upload.png')return route.fulfill({contentType:'image/svg+xml',body:svg})
  if(url.origin!==origin || /^\/api\//.test(url.pathname)) {providerRequests++;return route.abort('blockedbyclient')}
  return route.continue()
})
const page=await context.newPage()
page.on('pageerror',error=>errors.push(error.message))
page.on('dialog',dialog=>dialog.accept())
page.setDefaultTimeout(12000)
async function test(name,fn){await fn();count++;console.log(`PASS ${name}`)}
const read=()=>page.evaluate(()=>window.__canvasQA.read())
const node=id=>page.locator(`[data-node-id="${id}"]`)
try {
  await page.goto(`${base.replace(/\/$/,'')}/scripts/fixtures/node-canvas.html`)
  await page.locator('.node-canvas').waitFor()
  await test('populated board loads 12 nodes and typed edges',async()=>{assert.equal(await page.locator('.gnode').count(),12);assert.equal(await page.locator('.wire-type-image').count(),1);assert.equal(await page.locator('.wire-type-video').count(),1)})
  await test('cursor-centered wheel zoom preserves the board point',async()=>{
    const board=await page.locator('.node-canvas').boundingBox(),before=await read(),x=board.width*.45,y=board.height*.55
    await page.mouse.move(board.x+x,board.y+y);await page.mouse.wheel(0,-120)
    await page.waitForFunction(old=>window.__canvasQA.read().zoom>old,before.zoom)
    const after=await read()
    assert.ok(Math.abs((x-before.pan_x)/before.zoom-(x-after.pan_x)/after.zoom)<1)
    assert.ok(Math.abs((y-before.pan_y)/before.zoom-(y-after.pan_y)/after.zoom)<1)
  })
  await test('dragging uses canvas coordinates at zoom',async()=>{
    const before=await read(),head=await node('prompt-main').locator('.gnode-head').boundingBox()
    await page.mouse.move(head.x+70,head.y+15);await page.mouse.down();await page.mouse.move(head.x+150,head.y+65,{steps:8});await page.mouse.up()
    const after=await read(),a=before.nodes.find(n=>n.id==='prompt-main'),b=after.nodes.find(n=>n.id==='prompt-main')
    assert.ok(Math.abs(b.x-a.x-80/before.zoom)<2);assert.ok(Math.abs(b.y-a.y-50/before.zoom)<2)
    await page.getByRole('button',{name:'Undo graph edit'}).click()
  })
  await test('inline text preserves Delete and native typing',async()=>{
    await node('prompt-main').locator('.gnode-head').click()
    await page.getByLabel('Prompt text',{exact:true}).fill('A factual bottle composition')
    const before=await page.locator('.gnode').count()
    await page.getByLabel('Prompt text',{exact:true}).press('Backspace')
    assert.equal(await page.locator('.gnode').count(),before)
    await page.getByLabel('Prompt text',{exact:true}).fill('A factual bottle composition')
  })
  await test('multi-select duplicate, undo and redo preserve graph count',async()=>{
    await node('prompt-main').locator('.gnode-head').click()
    await node('image-main').locator('.gnode-head').click({modifiers:['Shift']})
    assert.equal(await page.locator('.gnode.selected').count(),2)
    await page.getByRole('button',{name:'Duplicate selected nodes'}).click()
    assert.equal(await page.locator('.gnode').count(),14)
    await page.getByRole('button',{name:'Undo graph edit'}).click();assert.equal(await page.locator('.gnode').count(),12)
    await page.getByRole('button',{name:'Redo graph edit'}).click();assert.equal(await page.locator('.gnode').count(),14)
    await page.getByRole('button',{name:'Undo graph edit'}).click()
  })
  await test('model settings expose real size/quantity and reset shape consistently',async()=>{
    await node('image-main').locator('.gnode-head').click()
    await page.getByLabel('Image size',{exact:true}).selectOption('portrait')
    assert.equal(await page.getByLabel('Aspect ratio',{exact:true}).inputValue(),'9:16')
    await page.getByLabel('Image outputs',{exact:true}).selectOption('2')
    await page.getByLabel('Image size',{exact:true}).selectOption('square')
    await page.getByLabel('Image outputs',{exact:true}).selectOption('1')
  })
  await test('Run Node reviews only its dependency path and receives isolated mock output',async()=>{
    await node('video-main').getByRole('button',{name:'Generate Video Generator'}).click()
    const modal=page.getByRole('dialog',{name:'Review Canvas execution'})
    await modal.waitFor();assert.match(await modal.innerText(),/2 generation steps · 2 requested outputs/)
    await modal.getByRole('button',{name:'Review total cost'}).click()
    await page.waitForFunction(()=>window.__canvasQA.read().nodes.find(n=>n.id==='video-main').data.result_asset_id>0)
    assert.equal((await read()).nodes.find(n=>n.id==='output-main').data.selected_asset_id,502)
    assert.equal(await page.evaluate(()=>window.__canvasQA.calls()),1)
    await page.waitForFunction(()=>[...document.querySelectorAll('video')].length>=2&&[...document.querySelectorAll('video')].every(video=>video.readyState>=2))
    await page.evaluate(()=>window.__canvasQA.replace({...window.__canvasQA.read(),zoom:.82,pan_x:25,pan_y:72}))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(350)
    await page.evaluate(async()=>{for(const video of document.querySelectorAll('video'))await video.play()})
    await page.waitForFunction(()=>[...document.querySelectorAll('video')].every(video=>video.currentTime>.2))
    await page.evaluate(()=>{for(const video of document.querySelectorAll('video'))video.pause()})
    await page.waitForFunction(()=>[...document.querySelectorAll('video')].every(video=>!video.seeking&&video.readyState===4))
    await page.waitForTimeout(600)
    await page.screenshot({path:path.join(artifacts,'canvas-completed.png'),fullPage:true})
  })
  await test('undo after generation preserves new paid-result-shaped Asset metadata',async()=>{
    await page.getByRole('button',{name:'Undo graph edit'}).click()
    assert.equal((await read()).nodes.find(n=>n.id==='video-main').data.result_asset_id,502)
  })
  await test('saved graph reload restores outputs, viewport and inputs',async()=>{
    const before=await read();await page.waitForTimeout(350);await page.reload();await page.locator('.node-canvas').waitFor()
    const after=await read();assert.equal(after.nodes.length,before.nodes.length);assert.equal(after.nodes.find(n=>n.id==='video-main').data.result_asset_id,502)
    assert.equal(after.zoom,before.zoom);assert.equal(after.pan_x,before.pan_x)
  })
  await test('image upload saves once and registers a stable Asset without copying the file',async()=>{
    const priorIds=(await read()).nodes.map(n=>n.id)
    await page.getByLabel('Add starter graph').selectOption('image-video')
    const starterBlockers=await page.evaluate(async prior=>{
      const {compileCanvasExecution}=await import('/src/lib/nodeCanvasExecution.js')
      const canvas=window.__canvasQA.read()
      return compileCanvasExecution(canvas,{nodeIds:canvas.nodes.filter(n=>!prior.includes(n.id)).map(n=>n.id),scope:'selection',capabilities:window.__canvasQA.capabilities}).blockers
    },priorIds)
    assert.deepEqual(starterBlockers,[],'New starter settings must already match the shared registry')
    await page.getByRole('button',{name:'Fit all nodes to screen'}).click()
    await page.getByRole('button',{name:'Add Upload node',exact:true}).click()
    const upload=page.locator('.gnode.selected')
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=','base64')
    await page.locator('.nc-properties input[type=file]').setInputFiles({name:'upload.png',mimeType:'image/png',buffer:png})
    await page.getByRole('button',{name:'Save to Library',exact:true}).click()
    await page.waitForFunction(()=>window.__canvasQA.read().nodes.some(n=>n.type==='upload'&&n.data.asset_id===900))
    assert.equal(savedFiles,1);assert.equal(registered,1)
  })
  await page.evaluate(()=>window.__canvasQA.replace({...window.__canvasQA.read(),zoom:.82,pan_x:25,pan_y:72}))
  await page.waitForTimeout(200)
  await page.screenshot({path:path.join(artifacts,'canvas-desktop.png'),fullPage:true})
  await page.getByRole('button',{name:'Fit all nodes to screen'}).click()
  await page.waitForTimeout(350)
  const fitted=await page.locator('.node-canvas').boundingBox()
  for(const box of await page.locator('.gnode').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom}}))) {
    assert.ok(box.x>=fitted.x-1&&box.y>=fitted.y-1&&box.right<=fitted.x+fitted.width+1&&box.bottom<=fitted.y+fitted.height+1,'Fit must contain every node')
  }
  await page.screenshot({path:path.join(artifacts,'canvas-board-fit.png'),fullPage:true})
  await test('mobile properties are reachable and do not overflow the screen',async()=>{
    await page.setViewportSize({width:390,height:844})
    await page.getByRole('button',{name:'Fit all nodes to screen'}).click()
    await page.getByLabel('Edit a canvas node',{exact:true}).selectOption('image-main')
    const dialog=page.getByRole('dialog',{name:'Node properties'})
    await dialog.waitFor();await dialog.getByLabel('Image outputs',{exact:true}).selectOption('2')
    const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391)
    assert.ok(await dialog.getByRole('button',{name:'Generate Image Generator'}).isVisible())
    await page.screenshot({path:path.join(artifacts,'canvas-mobile-properties.png'),fullPage:true})
    await dialog.getByRole('button',{name:'Close',exact:true}).click()
    await page.screenshot({path:path.join(artifacts,'canvas-mobile.png'),fullPage:true})
  })
  await test('no provider requests or browser exceptions',async()=>{assert.equal(providerRequests,0);assert.deepEqual(errors,[])})
  console.log(`Canvas interaction regressions: ${count}/${count}; provider requests: ${providerRequests}`)
} catch (error) {
  console.error('Fixture video state:',await page.locator('video').evaluateAll(videos=>videos.map(video=>({ready:video.readyState,current:video.currentTime,duration:video.duration,seeking:video.seeking,error:video.error?.code}))))
  await page.screenshot({path:path.join(artifacts,'canvas-failure.png'),fullPage:true}).catch(()=>{})
  if(errors.length)console.error('Browser errors:',errors)
  throw error
} finally {await browser.close()}
