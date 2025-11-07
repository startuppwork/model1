// app.js
// Virtual Interviewer — browser-only prototype
// Works with Web Speech API (Recognition) and SpeechSynthesis (TTS)
// Rule-based evaluator for free offline use.

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const jobSelect = document.getElementById('jobSelect');
const transcriptBox = document.getElementById('transcriptBox');
const sessionLog = document.getElementById('sessionLog');
const downloadBtn = document.getElementById('downloadBtn');
const playbackBtn = document.getElementById('playbackBtn');
const mouth = document.getElementById('mouth');
const avatar = document.getElementById('avatar');

let recognition = null;
let isRecognizing = false;
let session = null;
let audioBlobs = []; // optional if you want to store audio
let utterQueue = [];
let synth = window.speechSynthesis;

// Simple job templates with required skills & question banks
const JOB_TEMPLATES = {
  junior_dev: {
    title:'Junior Developer',
    skills:['javascript','react','node','html','css'],
    questions:[
      "Tell me about a programming project you built.",
      "Which technologies did you use and why?",
      "How do you debug problems in your code?"
    ]
  },
  qa: {
    title:'QA Engineer',
    skills:['testing','automation','selenium','jest','api'],
    questions:[
      "Describe a time you found a critical bug and how you reported it.",
      "What is your experience with automation testing?",
      "How do you design test cases for a new feature?"
    ]
  },
  support: {
    title:'Support Executive',
    skills:['communication','troubleshooting','crm','email'],
    questions:[
      "Tell me about a difficult customer interaction and how you handled it.",
      "How do you prioritize tickets when several high-priority issues arrive?",
      "What tools have you used for customer support?"
    ]
  }
};

// Helper: append to session log
function logLine(text){
  const p = document.createElement('div');
  p.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  sessionLog.prepend(p);
}

// Initialize session object
function createSession(jobKey){
  return {
    id: 's_' + Date.now(),
    jobKey,
    jobTitle: JOB_TEMPLATES[jobKey].title,
    startedAt: new Date().toISOString(),
    steps: [], // {question, answer, score, rationale}
    finalScore: null
  };
}

// START/STOP button handlers
startBtn.addEventListener('click', async ()=>{
  startBtn.disabled = true;
  stopBtn.disabled = false;
  downloadBtn.disabled = true;
  playbackBtn.disabled = true;
  session = createSession(jobSelect.value);
  logLine(`Session started: ${session.id} role=${session.jobTitle}`);
  await runInterview(session);
});

stopBtn.addEventListener('click', ()=>{
  stopInterview();
});

// Simple TTS play with avatar mouth animation
function speakText(text){
  return new Promise((resolve,reject)=>{
    if(!('speechSynthesis' in window)){
      logLine('TTS unsupported in this browser.');
      return resolve();
    }
    const u = new SpeechSynthesisUtterance(text);
    // choose preferred voice if available
    u.lang = 'en-US';
    u.rate = 1.0;
    u.volume = 1.0;
    u.onstart = () => {
      mouth.classList.add('mouth-open');
      logLine('Avatar speaks: '+ text.slice(0,60));
    };
    u.onend = () => {
      mouth.classList.remove('mouth-open');
      resolve();
    };
    u.onerror = (e)=>{ mouth.classList.remove('mouth-open'); resolve(); };
    synth.speak(u);
  });
}

// Setup SpeechRecognition (STT)
function createRecognition(onTranscript){
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SpeechRecognition) return null;
  const r = new SpeechRecognition();
  r.lang = 'en-US';
  r.interimResults = true;
  r.maxAlternatives = 1;
  r.onresult = (ev)=>{
    let interim='';
    let final='';
    for(let i=ev.resultIndex;i<ev.results.length;i++){
      const res = ev.results[i];
      if(res.isFinal) final += res[0].transcript;
      else interim += res[0].transcript;
    }
    onTranscript({interim, final});
  };
  r.onerror = (e) => { logLine('Recognition error: '+ e.error); };
  r.onend = ()=> {
    isRecognizing = false;
    logLine('Recognition ended.');
  };
  return r;
}

// Core interview flow
async function runInterview(session){
  const job = JOB_TEMPLATES[session.jobKey];
  // greet
  await speakText(`Hello. I am Aisha, your interviewer for the role ${job.title}. Let's begin.`);
  // iterate through job questions
  for(let i=0;i<job.questions.length;i++){
    const q = job.questions[i];
    // ask question
    await speakText(q);
    // capture answer (STT or fallback typed)
    const answer = await captureAnswer(q);
    // evaluate answer
    const evalRes = evaluateAnswer(answer, job);
    // save step
    session.steps.push({
      question: q,
      answer: answer,
      score: evalRes.score,
      rationale: evalRes.rationale,
      timestamp: new Date().toISOString()
    });
    // show in UI
    updateTranscriptUI();
    logLine(`Q${i+1} score:${evalRes.score} - ${evalRes.rationale}`);
    // small follow-up: if low score on a required skill, ask targeted followup
    const missing = evalRes.missingSkills || [];
    if(missing.length > 0){
      const follow = `You didn't mention ${missing[0]}. Can you describe any experience with ${missing[0]}?`;
      await speakText(follow);
      const followAns = await captureAnswer(follow);
      const fEval = evaluateAnswer(followAns, job);
      session.steps.push({
        question: follow,
        answer: followAns,
        score: fEval.score,
        rationale: fEval.rationale,
        timestamp: new Date().toISOString(),
        followup:true
      });
      logLine(`Follow-up score:${fEval.score} - ${fEval.rationale}`);
    }
  }

  // compute final
  computeFinalScore(session);
  renderFinalReport(session);
  downloadBtn.disabled = false;
  logLine(`Session completed. Final Score: ${session.finalScore}`);
  // enable playback if Audio recorded
  playbackBtn.disabled = (audioBlobs.length === 0);
}

// Stop interview quickly
function stopInterview(){
  synth.cancel();
  if(recognition && isRecognizing) recognition.stop();
  startBtn.disabled = false;
  stopBtn.disabled = true;
  logLine('Interview stopped by user.');
  if(session){
    session.endedAt = new Date().toISOString();
    computeFinalScore(session);
    renderFinalReport(session);
    downloadBtn.disabled = false;
  }
}

// Capture answer using STT (or typed fallback)
function captureAnswer(promptText){
  return new Promise(async (resolve)=>{
    transcriptBox.innerHTML = '<em>Listening... please speak clearly.</em>';
    // if SpeechRecognition available - use it
    if(window.SpeechRecognition || window.webkitSpeechRecognition){
      if(!recognition){
        recognition = createRecognition(({interim, final})=>{
          transcriptBox.innerText = (interim ? interim : '') + (final ? '\n' + final : '');
          if(final && final.trim().length > 0){
            // stop recognition
            recognition.stop();
            isRecognizing = false;
            resolve(final.trim());
          }
        });
      }
      try{
        recognition.start();
        isRecognizing = true;
      }catch(err){
        logLine('Recognition start error, using typed fallback.');
        // typed fallback
        const typed = prompt('Type your answer (fallback):');
        resolve(typed || '');
      }
      // timeout for no answer after 20s
      setTimeout(()=>{
        if(isRecognizing){
          try{ recognition.stop(); }catch(e){}
          isRecognizing = false;
          logLine('No response detected (timeout).');
          resolve('');
        }
      }, 20000);
    } else {
      // fallback typed input
      const typed = prompt('SpeechRecognition not supported. Type your answer:');
      resolve(typed || '');
    }
  });
}

// Update transcript area with session steps
function updateTranscriptUI(){
  if(!session) return;
  transcriptBox.innerHTML = session.steps.map((s,idx)=> {
    return `<div><strong>Q${idx+1}:</strong> ${escapeHtml(s.question || '')}<br><strong>A:</strong> ${escapeHtml(s.answer || '')}<br><em>Score:</em> ${s.score} — ${escapeHtml(s.rationale)}</div>`;
  }).join('<hr/>');
}

// Simple, explainable rule-based evaluator
function evaluateAnswer(answerText, job){
  const text = (answerText || '').toLowerCase();
  // skill matching
  const skills = job.skills;
  const found = skills.filter(s => text.includes(s));
  const missing = skills.filter(s => !text.includes(s));
  const skillScore = Math.round((found.length / Math.max(1, skills.length)) * 50);
  // experience heuristic
  const yearsMatch = (text.match(/(\d+)\s+years/) || [0,0])[1];
  const expScore = Math.min(30, (parseInt(yearsMatch)||0) * 6); // up to 30
  // fluency: length-based
  const words = text.split(/\s+/).filter(Boolean).length;
  const fluencyScore = Math.min(20, Math.round(Math.min(20, words / 3)));
  const total = Math.round(skillScore + expScore + fluencyScore);
  const rationale = `Matched ${found.length}/${skills.length} skills (${found.join(',') || 'none'}). Words:${words}. Years:${yearsMatch||'n/a'}.`;
  return { score: total, rationale, foundSkills: found, missingSkills: missing };
}

// final score aggregation: average of step scores
function computeFinalScore(session){
  if(!session || session.steps.length===0) return;
  const numeric = session.steps.map(s=>s.score || 0);
  const avg = Math.round(numeric.reduce((a,b)=>a+b,0)/numeric.length);
  session.finalScore = avg;
  session.completedAt = new Date().toISOString();
}

// render final report in the UI
function renderFinalReport(session){
  const finalHtml = `
    <h3>Final Report — ${escapeHtml(session.jobTitle)}</h3>
    <p>Final Score: <strong>${session.finalScore}</strong></p>
    <p>Details:</p>
    ${session.steps.map((s,idx)=>`<div><strong>Q${idx+1}:</strong> ${escapeHtml(s.question)}<br>
      <strong>A:</strong> ${escapeHtml(s.answer)}<br><em>Score:</em> ${s.score} — ${escapeHtml(s.rationale)}</div>`).join('<hr/>')}
  `;
  sessionLog.innerHTML = finalHtml + sessionLog.innerHTML;
}

// download session JSON
downloadBtn.addEventListener('click', ()=>{
  if(!session) return;
  const data = JSON.stringify(session, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${session.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// playback not implemented fully — placeholder
playbackBtn.addEventListener('click', ()=>{
  alert('Playback not implemented in this simple prototype. (You can store audio blobs and play them.)');
});

// small helper
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// For accessibility: focus controls on load
window.addEventListener('load', ()=>{ document.getElementById('startBtn').focus(); });
