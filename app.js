'use strict';
(function setupBootGuards(){
  const bootEl = document.getElementById('bootError');
  function show(msg){ if(!bootEl) return; bootEl.style.display='block'; bootEl.textContent = 'JS error: ' + msg; }
  window.addEventListener('error', (e)=>{ show(e.message || 'unknown error'); });
  window.addEventListener('unhandledrejection', (e)=>{ show((e.reason && (e.reason.message||e.reason)) || 'unhandled rejection'); });
})();

let currentIceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

const stunUrlsInput = document.getElementById('stunUrls');
const turnUrlsInput = document.getElementById('turnUrls');
const turnUserInput = document.getElementById('turnUser');
const turnPassInput = document.getElementById('turnPass');
const btnApplyIce = document.getElementById('btnApplyIce');
const chkDirectFirst = document.getElementById('chkDirectFirst');
const fallbackSecInput = document.getElementById('fallbackSec');
const directStatus = document.getElementById('directStatus');
const pathStatus = document.getElementById('pathStatus');
const iceStatus = document.getElementById('iceStatus');

function parseCsv(input){ return (input||'').split(',').map(s=>s.trim()).filter(Boolean); }

function buildIceServersFromForm(){
  const stunUrls = parseCsv(stunUrlsInput.value).map(u => ({ urls: u }));
  const turnUrls = parseCsv(turnUrlsInput.value);
  const servers = [...stunUrls];
  if (turnUrls.length){
    const username = turnUserInput.value.trim();
    const credential = turnPassInput.value;
    if (!username || !credential){
      throw new Error('TURN username and credential are required when TURN URLs are provided');
    }
    servers.push({ urls: turnUrls, username, credential });
  }
  if (!servers.length) throw new Error('Provide at least one STUN or TURN URL');
  return servers;
}

btnApplyIce.addEventListener('click', () => {
  try {
    const servers = buildIceServersFromForm();
    currentIceServers = servers;
    try { senderPC.setConfiguration({ iceServers: currentIceServers }); } catch (e) {}
    try { viewerPC.setConfiguration({ iceServers: currentIceServers }); } catch (e) {}
    iceStatus.textContent = 'ICE config applied ✓ — click "New Offer (ICE restart)" on Sender';
    console.log('Using ICE servers', JSON.stringify(currentIceServers));
  } catch (e){ iceStatus.textContent = 'Error: ' + e.message; }
});

const envInfo = document.getElementById('envInfo');
const btnEnv = document.getElementById('btnEnv');
function runEnvChecks(){
  const lines = [];
  try { const det = document.getElementById('envInfo')?.closest('details'); if (det) det.open = true; } catch(e){}
  try { const s = document.getElementById('shareStatus'); if (s) s.textContent = 'Environment info updated — see Advanced'; } catch(e){}
  lines.push(`isSecureContext: ${isSecureContext}`);
  lines.push(`navigator.mediaDevices: ${!!navigator.mediaDevices}`);
  lines.push(`getDisplayMedia: ${!!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)}`);
  lines.push(`userAgent: ${navigator.userAgent}`);
  envInfo.textContent = lines.join('\n');
}
if (btnEnv) btnEnv.addEventListener('click', runEnvChecks);
runEnvChecks();

const sigUrlInput = document.getElementById('sigUrl');
const roomInput = document.getElementById('roomId');
const btnSigConnect = document.getElementById('btnSigConnect');
const btnSigDisconnect = document.getElementById('btnSigDisconnect');
const sigStatus = document.getElementById('sigStatus');
const btnMakeInvite = document.getElementById('btnMakeInvite');
const btnCopyInvite = document.getElementById('btnCopyInvite');
const inviteUrl = document.getElementById('inviteUrl');
const sessionInfo = document.getElementById('sessionInfo');

function setBuildInfo(){
  try {
    var name = location.pathname.split('/').pop() || '(index)';
    var when = new Date(document.lastModified).toLocaleString();
    var el = document.getElementById('buildInfo');
    if (el) el.textContent = `${name} • saved: ${when}`;
  } catch (e) {}
}
function updateSessionInfo(){
  try {
    var room = (roomInput && roomInput.value || '').trim();
    var wsState = (ws && ws.readyState === WebSocket.OPEN) ? 'WS:Connected' : 'WS:Disconnected';
    var bcState = bc ? 'BC:on' : 'BC:off';
    var role = window.__role || 'sender';
    if (sessionInfo) sessionInfo.textContent = `room: ${room || '(none)'} • role: ${role} • ${wsState} • ${bcState}`;
  } catch (e) {}
}
function getParams(){ return new URLSearchParams(location.search); }
function setParamUrl(params){ const url = new URL(location.href); url.search = params.toString(); return url.toString(); }

var ws = null;
var bc = null;

function setSigStatus(){
  const wsState = (ws && ws.readyState === WebSocket.OPEN) ? 'Connected' : 'Disconnected';
  const bcState = bc ? 'local tab channel ON' : 'local tab channel OFF';
  sigStatus.textContent = `${wsState} — ${bcState}`;
  updateSessionInfo();
}

function ensureBC(){
  try {
    if (!('BroadcastChannel' in window)) return;
    if (bc) bc.close();
    bc = new BroadcastChannel('webrtc-local');
    bc.onmessage = (ev) => { if (ev && ev.data) handleSignal(ev.data, 'bc'); };
  } catch (e) {}
  setSigStatus();
}

function toPlainDesc(desc){
  if (!desc) return desc;
  try { if (typeof desc.toJSON === 'function') return desc.toJSON(); } catch (e) {}
  if (typeof desc.type === 'string' && typeof desc.sdp === 'string') return { type: desc.type, sdp: desc.sdp };
  return desc;
}
function toPlainCandidate(c){
  if (!c) return c;
  try { if (typeof c.toJSON === 'function') return c.toJSON(); } catch (e) {}
  return { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, usernameFragment: c.usernameFragment };
}
function signalSend(obj){
  const room = roomInput.value.trim();
  let payload = { ...obj, room };
  if (payload.sdp) payload = { ...payload, sdp: toPlainDesc(payload.sdp) };
  if (payload.candidate) {
    const candStr = payload.candidate && payload.candidate.candidate ? payload.candidate.candidate : '';
    const isRelay = / typ relay /.test(candStr);
    if (directPhase && isRelay) { return; }
    payload = { ...payload, candidate: toPlainCandidate(payload.candidate) };
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(payload)); } catch (e) {}
  } else if (bc) {
    try { bc.postMessage(payload); } catch (e) {}
  }
}

(function initSigDefaults(){
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const host = location.hostname || 'localhost';
  if (!sigUrlInput.value) sigUrlInput.value = `${proto}${host}:8787`;
  if (!roomInput.value) roomInput.value = Math.random().toString(36).slice(2,8);

  const p = getParams();
  if (p.has('ws'))  sigUrlInput.value = decodeURIComponent(p.get('ws'));
  if (p.has('room')) roomInput.value = p.get('room');

  ensureBC();

  window.__role = (p.get('role') === 'viewer') ? 'viewer' : 'sender';
  updateSessionInfo();
  setBuildInfo();

  const autoconnect = p.get('autoconnect') === '1';
  if (autoconnect && btnSigConnect) setTimeout(()=>btnSigConnect.click(), 0);

  setSigStatus();
})();

roomInput.addEventListener('input', ()=>{ ensureBC(); updateSessionInfo(); });

if (btnSigConnect) btnSigConnect.addEventListener('click', () => {
  const url = sigUrlInput.value.trim();
  const room = roomInput.value.trim();
  if (!url || !room) { sigStatus.textContent = 'Need WS URL and Room'; return; }
  try { if (ws) ws.close(); } catch (e) {}
  ws = new WebSocket(url);
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'join', room }));
    setSigStatus();
    btnSigConnect.disabled = true;
    btnSigDisconnect.disabled = false;
  });
  ws.addEventListener('close', () => { setSigStatus(); btnSigConnect.disabled = false; btnSigDisconnect.disabled = true; });
  ws.addEventListener('error', () => { setSigStatus(); });
  ws.addEventListener('message', (ev) => {
    try { const msg = JSON.parse(ev.data); if (!msg || msg.room !== roomInput.value.trim()) return; handleSignal(msg, 'ws'); }
    catch (e) {}
  });
  setSigStatus();
});

if (btnSigDisconnect) btnSigDisconnect.addEventListener('click', () => { try { if (ws && typeof ws.close === 'function') ws.close(); } catch(e){} setSigStatus(); });

if (btnMakeInvite) btnMakeInvite.addEventListener('click', () => {
  const wsUrl = encodeURIComponent(sigUrlInput.value.trim());
  const room = roomInput.value.trim();
  const params = new URLSearchParams({ role: 'viewer', ws: wsUrl, room, autoconnect: '1' });
  inviteUrl.value = setParamUrl(params);
  btnCopyInvite.disabled = false;
});

if (btnCopyInvite) btnCopyInvite.addEventListener('click', () => {
  if (!inviteUrl.value) return;
  navigator.clipboard?.writeText(inviteUrl.value).then(()=>{
    btnCopyInvite.textContent='Copied!'; setTimeout(()=>btnCopyInvite.textContent='Copy link', 1200);
  });
});

const btnOpenViewer = document.getElementById('btnOpenViewer');
if (btnOpenViewer) btnOpenViewer.addEventListener('click', () => {
  const wsUrl = encodeURIComponent(sigUrlInput.value.trim());
  const room = roomInput.value.trim();
  const params = new URLSearchParams({ role: 'viewer', ws: wsUrl, room, autoconnect: '1' });
  const url = setParamUrl(params);
  window.open(url, '_blank', 'noopener,noreferrer');
});

function onlyStunServers(servers){
  try {
    const asArray = (urls)=> Array.isArray(urls) ? urls : [urls];
    return (servers||[]).map(s => ({ urls: asArray(s.urls), username: s.username, credential: s.credential }))
      .filter(s => asArray(s.urls).every(u => typeof u === 'string' && !u.trim().toLowerCase().startsWith('turn:') && !u.trim().toLowerCase().startsWith('turns:')));
  } catch (e) { return servers || []; }
}
let directPhase = false;
let fallbackTimer = null;
let fellBackToTurn = false;

async function startDirectFirstNegotiation(){
  directPhase = true; fellBackToTurn = false;
  directStatus.textContent = 'Direct-first: TURN temporarily disabled…';
  try { senderPC.setConfiguration({ iceServers: onlyStunServers(currentIceServers) }); } catch (e) {}
  await createOfferAndSend();
  let sec = parseInt(fallbackSecInput && fallbackSecInput.value, 10); if (!(sec >= 3 && sec <= 60)) sec = 8;
  if (fallbackTimer) { try { clearTimeout(fallbackTimer); } catch (e) {} }
  fallbackTimer = setTimeout(async ()=>{
    if (senderPC.connectionState === 'connected' || senderPC.connectionState === 'completed') {
      directStatus.textContent = 'Direct path established ✓';
      directPhase = false; return;
    }
    fellBackToTurn = true; directPhase = false;
    directStatus.textContent = 'Falling back to TURN… (ICE restart)';
    try { senderPC.setConfiguration({ iceServers: currentIceServers }); } catch (e) {}
    await createOfferAndSend({ iceRestart: true });
  }, sec * 1000);
}

async function updatePath(pc, target){
  try {
    const stats = await pc.getStats();
    let selectedPair, local, remote;
    stats.forEach(r=>{
      if (r.type === 'transport' && r.selectedCandidatePairId) { selectedPair = stats.get(r.selectedCandidatePairId); }
      else if (r.type === 'candidate-pair' && r.selected) { selectedPair = r; }
    });
    if (selectedPair){ local = stats.get(selectedPair.localCandidateId); remote = stats.get(selectedPair.remoteCandidateId); }
    if (local && remote){
      const text = `path: ${local.candidateType||'?'} → ${remote.candidateType||'?'} ${selectedPair.state||''}${selectedPair.nominated? ' (nominated)':''}`;
      if (target) target.textContent = text + ((local.candidateType==='relay'||remote.candidateType==='relay') ? '  [RELAY]' : '  [DIRECT]');
    }
  } catch (e) {}
}
setInterval(()=>{ updatePath(senderPC, pathStatus); }, 2000);

function onceIceGatheringComplete(pc) {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') return resolve();
    function check() { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', check); resolve(); } }
    pc.addEventListener('icegatheringstatechange', check);
  });
}

function pcFactory(label) {
  const cfg = { iceServers: currentIceServers };
  const pc = new RTCPeerConnection(cfg);
  pc.addEventListener('iceconnectionstatechange', () => console.log(label, 'ice', pc.iceConnectionState));
  pc.addEventListener('connectionstatechange', () => console.log(label, 'conn', pc.connectionState));
  pc.addEventListener('icecandidate', (e)=>{
    if (e.candidate) {
      const c = e.candidate.candidate || '';
      const m = c.match(/ typ ([a-z]+) /);
      if (m) console.log(label, 'cand typ=', m[1], c);
    }
  });
  return pc;
}

function copyToClipboard(text) { navigator.clipboard?.writeText(text).catch(() => {}); }

function canApplyRemoteAnswer(pc, desc){
  if (!desc || desc.type !== 'answer') return { ok:false, reason:'Remote description must be an answer' };
  if (pc.signalingState !== 'have-local-offer') return { ok:false, reason:`Expected signalingState "have-local-offer", got "${pc.signalingState}"` };
  return { ok:true };
}

function updateSenderStates(){
  document.getElementById('sigState').textContent = `signalingState: ${senderPC.signalingState}`;
  document.getElementById('iceState').textContent = `iceConnectionState: ${senderPC.iceConnectionState}`;
  document.getElementById('connState').textContent = `connectionState: ${senderPC.connectionState}`;
}

const pendingToSender = [];
const pendingToViewer = [];

async function flushPendingToSender(){
  if (!senderPC.remoteDescription) return;
  while (pendingToSender.length) {
    const c = pendingToSender.shift();
    try { await senderPC.addIceCandidate(c); } catch (e) {}
  }
}
async function flushPendingToViewer(){
  if (!viewerPC.remoteDescription) return;
  while (pendingToViewer.length) {
    const c = pendingToViewer.shift();
    try { await viewerPC.addIceCandidate(c); } catch (e) {}
  }
}

let senderPC = pcFactory('sender');
let localStream;

const btnShare = document.getElementById('btnShare');
const chkWithAudio = document.getElementById('chkWithAudio');
const localVideo = document.getElementById('localVideo');
const btnCreateOffer = document.getElementById('btnCreateOffer');
const btnIceRestart = document.getElementById('btnIceRestart');
const offerOut = document.getElementById('offerOut');
const btnSetAnswer = document.getElementById('btnSetAnswer');
const answerIn = document.getElementById('answerIn');
const offerStatus = document.getElementById('offerStatus');
const answerStatus = document.getElementById('answerStatus');
const btnSenderReset = document.getElementById('btnSenderReset');
const btnSenderStats = document.getElementById('btnSenderStats');
const senderLog = document.getElementById('senderLog');
const shareStatus = document.getElementById('shareStatus');

senderPC.addEventListener('signalingstatechange', updateSenderStates);
senderPC.addEventListener('iceconnectionstatechange', updateSenderStates);
senderPC.addEventListener('connectionstatechange', updateSenderStates);

senderPC.addEventListener('icecandidate', (e) => {
  if (e.candidate) {
    signalSend({ kind: 'candidate', from: 'sender', candidate: e.candidate });
    offerOut.value = JSON.stringify(senderPC.localDescription);
  } else {
    signalSend({ kind: 'end-of-candidates', from: 'sender' });
  }
});

updateSenderStates();

if (btnShare) btnShare.addEventListener('click', async () => {
  try {
    shareStatus.textContent = '';
    if (!isSecureContext) { shareStatus.textContent = 'Needs https:// or http://localhost'; alert('Screen capture requires a secure context (https or localhost).'); return; }
    if (!navigator.mediaDevices?.getDisplayMedia) { shareStatus.textContent = 'getDisplayMedia() not supported'; alert('Your browser does not support getDisplayMedia.'); return; }
    const wantAudio = chkWithAudio.checked;
    const primaryConstraints = { video: { displaySurface: 'window' }, audio: wantAudio ? { systemAudio: 'include' } : false };
    try { localStream = await navigator.mediaDevices.getDisplayMedia(primaryConstraints); }
    catch (e) {
      const fallbackConstraints = { video: true, audio: wantAudio ? true : false };
      localStream = await navigator.mediaDevices.getDisplayMedia(fallbackConstraints);
      shareStatus.textContent = 'Using fallback constraints';
    }
    localVideo.srcObject = localStream;
    for (const track of localStream.getTracks()) senderPC.addTrack(track, localStream);
    btnCreateOffer.disabled = false; btnIceRestart.disabled = false; shareStatus.textContent = 'Capture started ✓';
  } catch (err) { shareStatus.textContent = 'Capture failed'; alert('Screen share cancelled or failed: ' + err.name + (err.message ? ' — ' + err.message : '')); }
});

async function createOfferAndSend(options={}){
  offerStatus.textContent = 'Creating offer… (trickle ICE)';
  const offer = await senderPC.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true, ...options });
  await senderPC.setLocalDescription(offer);
  offerOut.value = JSON.stringify(senderPC.localDescription);
  copyToClipboard(offerOut.value);
  offerStatus.innerHTML = 'Offer sent ✓ (trickle). Waiting for answer…';
  btnSetAnswer.disabled = false;
  updateSenderStates();
  signalSend({ kind: 'offer', sdp: senderPC.localDescription });
}

if (btnCreateOffer) btnCreateOffer.addEventListener('click', async () => {
  try {
    btnCreateOffer.disabled = true;
    if (chkDirectFirst && chkDirectFirst.checked) {
      await startDirectFirstNegotiation();
    } else {
      await createOfferAndSend();
    }
  } catch (err) { offerStatus.textContent = 'Error: ' + err; }
});

if (btnIceRestart) btnIceRestart.addEventListener('click', async () => {
  try {
    if (senderPC.signalingState !== 'stable') { offerStatus.textContent = `ICE restart requires stable state (now: ${senderPC.signalingState})`; return; }
    await createOfferAndSend({ iceRestart: true });
  } catch (err) { offerStatus.textContent = 'ICE restart error: ' + err; }
});

if (btnSetAnswer) btnSetAnswer.addEventListener('click', async () => {
  try {
    answerStatus.textContent = 'Setting remote answer…'; btnSetAnswer.disabled = true;
    let desc; try { desc = JSON.parse(answerIn.value.trim()); } catch { throw new Error('Invalid JSON in Answer area'); }
    const gate = canApplyRemoteAnswer(senderPC, desc);
    if (!gate.ok) { answerStatus.innerHTML = `Rejected: ${gate.reason}. Create a fresh offer on Sender, then make a new Answer on Viewer.`; return; }
    await senderPC.setRemoteDescription(desc);
    await flushPendingToSender();
    answerStatus.innerHTML = 'Answer set ✓';
  } catch (err) { answerStatus.textContent = 'Error: ' + err; btnSetAnswer.disabled = false; }
  finally { updateSenderStates(); }
});

if (btnSenderReset) btnSenderReset.addEventListener('click', () => {
  try { senderPC.close(); } catch (e) {}
  senderPC = pcFactory('sender');
  senderPC.addEventListener('signalingstatechange', updateSenderStates);
  senderPC.addEventListener('iceconnectionstatechange', updateSenderStates);
  senderPC.addEventListener('connectionstatechange', updateSenderStates);
  senderPC.addEventListener('icecandidate', (e)=>{
    if (e.candidate) { signalSend({ kind: 'candidate', from: 'sender', candidate: e.candidate }); offerOut.value = JSON.stringify(senderPC.localDescription); }
    else { signalSend({ kind: 'end-of-candidates', from: 'sender' }); }
  });
  offerOut.value = answerIn.value = '';
  btnCreateOffer.disabled = true; btnSetAnswer.disabled = true; btnIceRestart.disabled = true;
  offerStatus.textContent = ''; answerStatus.textContent = ''; senderLog.textContent = '';
  updateSenderStates();
});

if (btnSenderStats) btnSenderStats.addEventListener('click', async () => {
  const stats = await senderPC.getStats();
  const lines = [];
  stats.forEach(r => { if (r.type === 'outbound-rtp' && !r.isRemote) { lines.push(`[video] bytesSent=${r.bytesSent} frames=${r.framesEncoded} qualityLimitationReason=${r.qualityLimitationReason}`); } });
  senderLog.textContent = lines.join('\n') || '(no stats yet)';
});

let viewerPC = pcFactory('viewer');
const remoteVideo = document.getElementById('remoteVideo');
const btnAcceptOffer = document.getElementById('btnAcceptOffer');
const viewerStatus = document.getElementById('viewerStatus');
const offerInViewer = document.getElementById('offerIn');
const btnCopyAnswer = document.getElementById('btnCopyAnswer');
const answerOutViewer = document.getElementById('answerOut');
const btnViewerReset = document.getElementById('btnViewerReset');
const btnViewerStats = document.getElementById('btnViewerStats');
const viewerLog = document.getElementById('viewerLog');

viewerPC.addEventListener('track', (e) => { if (e.streams && e.streams[0]) { remoteVideo.srcObject = e.streams[0]; } });

viewerPC.addEventListener('icecandidate', (e) => {
  if (e.candidate) signalSend({ kind: 'candidate', from: 'viewer', candidate: e.candidate });
  else signalSend({ kind: 'end-of-candidates', from: 'viewer' });
});

if (btnAcceptOffer) btnAcceptOffer.addEventListener('click', async () => {
  try {
    viewerStatus.textContent = 'Accepting offer…'; btnAcceptOffer.disabled = true;
    const offer = JSON.parse(offerInViewer.value.trim());
    await viewerPC.setRemoteDescription(offer);
    await flushPendingToViewer();
    const answer = await viewerPC.createAnswer();
    await viewerPC.setLocalDescription(answer);
    answerOutViewer.value = JSON.stringify(viewerPC.localDescription);
    btnCopyAnswer.disabled = false;
    viewerStatus.innerHTML = 'Answer ready ✓ — copy to Sender';
    signalSend({ kind: 'answer', sdp: viewerPC.localDescription });
  } catch (err) {
    viewerStatus.textContent = 'Error: ' + err; btnAcceptOffer.disabled = false;
  }
});

if (btnCopyAnswer) btnCopyAnswer.addEventListener('click', () => { copyToClipboard(answerOutViewer.value); });

if (offerInViewer) offerInViewer.addEventListener('input', () => { btnAcceptOffer.disabled = offerInViewer.value.trim().length === 0; });

if (btnViewerReset) btnViewerReset.addEventListener('click', () => {
  try { viewerPC.close(); } catch (e) {}
  viewerPC = pcFactory('viewer');
  viewerPC.addEventListener('track', (e) => { if (e.streams && e.streams[0]) remoteVideo.srcObject = e.streams[0]; });
  viewerPC.addEventListener('icecandidate', (e)=>{ if (e.candidate) signalSend({ kind: 'candidate', from: 'viewer', candidate: e.candidate }); else signalSend({ kind: 'end-of-candidates', from: 'viewer' }); });
  offerInViewer.value = ''; answerOutViewer.value = ''; btnCopyAnswer.disabled = true; viewerStatus.textContent = ''; viewerLog.textContent = ''; btnAcceptOffer.disabled = true;
});

if (btnViewerStats) btnViewerStats.addEventListener('click', async () => {
  const stats = await viewerPC.getStats();
  const lines = [];
  stats.forEach(r => { if (r.type === 'inbound-rtp' && !r.isRemote) { lines.push(`[video] packets=${r.packetsReceived} frames=${r.framesDecoded}`); } });
  viewerLog.textContent = lines.join('\n') || '(no stats yet)';
});

async function handleSignal(msg, via){
  if (!msg) return;
  const curRoom = (roomInput.value || '').trim();
  if (msg.room && msg.room !== curRoom) return;
  try {
    if (msg.kind === 'offer' && msg.sdp) {
      viewerStatus.textContent = `Offer received via ${via} — creating answer…`;
      await viewerPC.setRemoteDescription(msg.sdp);
      await flushPendingToViewer();
      const answer = await viewerPC.createAnswer();
      await viewerPC.setLocalDescription(answer);
      answerOutViewer.value = JSON.stringify(viewerPC.localDescription);
      btnCopyAnswer.disabled = false;
      viewerStatus.innerHTML = 'Answer ready ✓ — sent';
      signalSend({ kind: 'answer', sdp: viewerPC.localDescription });
      return;
    }
    if (msg.kind === 'answer' && msg.sdp) {
      if (senderPC.signalingState === 'have-local-offer') {
        answerStatus.textContent = `Answer received via ${via} — applying…`;
        await senderPC.setRemoteDescription(msg.sdp);
        await flushPendingToSender();
        answerStatus.innerHTML = 'Answer set ✓';
      } else {
        answerStatus.textContent = `Ignoring answer (state: ${senderPC.signalingState})`;
      }
      return;
    }
    if (msg.kind === 'candidate' && msg.candidate) {
      const candStr2 = msg.candidate && msg.candidate.candidate ? msg.candidate.candidate : '';
      const isRelay2 = / typ relay /.test(candStr2);
      if (directPhase && isRelay2) { return; }
      const ice = new RTCIceCandidate(msg.candidate);
      if (msg.from === 'sender') {
        if (viewerPC.remoteDescription) { try { await viewerPC.addIceCandidate(ice); } catch(e){} }
        else pendingToViewer.push(ice);
      } else if (msg.from === 'viewer') {
        if (senderPC.remoteDescription) { try { await senderPC.addIceCandidate(ice); } catch(e){} }
        else pendingToSender.push(ice);
      }
      return;
    }
  } catch (e) {}
}

const btnRunTests = document.getElementById('btnRunTests');
const testLog = document.getElementById('testLog');
const testStatus = document.getElementById('testStatus');

function tlog(msg) { testLog.textContent += msg + '\n'; }
function pass(name) { tlog('✓ ' + name); }
function fail(name, err) { tlog('✗ ' + name + ' — ' + ((err && err.message) || err)); }

async function runTests() {
  testLog.textContent = ''; testStatus.textContent = 'Running…';
  let ok = 0, total = 0;

  total++; try { await onceIceGatheringComplete({ iceGatheringState: 'complete', addEventListener(){}, removeEventListener(){} }); pass('onceIceGatheringComplete immediate'); ok++; } catch(e){ fail('onceIceGatheringComplete immediate', e); }
  total++; try { let listeners=[]; const fake={ iceGatheringState:'gathering', addEventListener(ev,f){ if(ev==='icegatheringstatechange') listeners.push(f); }, removeEventListener(ev,f){ if(ev==='icegatheringstatechange') listeners=listeners.filter(x=>x!==f);} }; const p=onceIceGatheringComplete(fake); setTimeout(()=>{ fake.iceGatheringState='complete'; listeners.forEach(f=>f()); },10); await p; pass('onceIceGatheringComplete event'); ok++; } catch(e){ fail('onceIceGatheringComplete event', e); }
  total++; try { const pc=pcFactory('test'); if (pc && typeof pc.createDataChannel==='function' && typeof pc.setLocalDescription==='function'){ pass('pcFactory basic'); ok++; } else throw new Error('methods missing'); try{ pc.close(); }catch(e){} } catch(e){ fail('pcFactory basic', e); }
  total++; try { let threw=false; try{ JSON.parse('not json'); }catch(e){ threw=true; } if (threw){ pass('JSON throws on invalid'); ok++; } else throw new Error('no throw'); } catch(e){ fail('JSON throws on invalid', e); }
  total++; try { const ids=['btnShare','btnCreateOffer','btnSetAnswer','btnAcceptOffer','btnCopyAnswer','localVideo','remoteVideo']; const missing=ids.filter(id=>!document.getElementById(id)); if(missing.length===0){ pass('DOM elements present'); ok++; } else throw new Error('Missing: '+missing.join(', ')); } catch(e){ fail('DOM elements present', e); }
  total++; try { const mockPC={signalingState:'have-local-offer'}; const res=canApplyRemoteAnswer(mockPC,{type:'answer'}); if(res.ok){ pass('canApplyRemoteAnswer ok'); ok++; } else throw new Error(res.reason); } catch(e){ fail('canApplyRemoteAnswer ok', e); }
  total++; try { const mockPC2={signalingState:'stable'}; const res2=canApplyRemoteAnswer(mockPC2,{type:'answer'}); if(!res2.ok){ pass('canApplyRemoteAnswer rejects on stable'); ok++; } else throw new Error('unexpected ok'); } catch(e){ fail('canApplyRemoteAnswer rejects on stable', e); }
  total++; try { stunUrlsInput.value='stun:example.com:3478, stun:foo'; turnUrlsInput.value='turn:bar:3478'; turnUserInput.value='u'; turnPassInput.value='p'; const s=buildIceServersFromForm(); if (Array.isArray(s) && s.length>=2) { pass('ICE form parsing'); ok++; } else throw new Error('bad servers'); } catch(e){ fail('ICE form parsing', e); }

  testStatus.textContent = `Done — ${ok}/${total} passed`;
}
if (btnRunTests) btnRunTests.addEventListener('click', runTests);

(function initEnvHints(){
  window.__appReady = true;
  const shareStatusEl = document.getElementById('shareStatus');
  if (!isSecureContext) { const warn='Not a secure context — use https or localhost to enable screen capture.'; shareStatusEl.textContent = warn; }
  if (!navigator.mediaDevices?.getDisplayMedia) { const warn2='This browser lacks getDisplayMedia() support.'; shareStatusEl.textContent = warn2; }
  setSigStatus();
  updateSessionInfo();
  setBuildInfo();
})();

// === Delegated click handling (safe, no redispatch) ===
(function(){
  document.addEventListener('click', function(ev){
    // Only react to real user clicks; synthetic events are ignored
    if (!ev.isTrusted) return;
    var t = ev.target;
    var btn = (t && t.closest) ? t.closest('button[id]') : null;
    if (!btn || !btn.id) return;
    switch(btn.id){
      case 'btnEnv':
        if (typeof runEnvChecks === 'function') runEnvChecks();
        break;
      case 'btnRunTests':
        if (typeof runTests === 'function') runTests();
        break;
      // All other buttons use their native listeners without any forced redispatch
      default: break;
    }
  }, true);
})();