const rubricGrid = document.getElementById("rubric-grid");
const expandRubricBtn = document.getElementById("expand-rubric");
const collapseRubricBtn = document.getElementById("collapse-rubric");
const exploreForm = document.getElementById("explore-form");
const exploreOutput = document.getElementById("explore-output");
const executeForm = document.getElementById("execute-form");
const executeOutput = document.getElementById("execute-output");
const executeGradeOutput = document.getElementById("execute-grade-output");

const softwareChat = document.getElementById("software-chat");
const openSoftwareChatBtn = document.getElementById("open-software-chat");
const closeSoftwareChatBtn = document.getElementById("close-software-chat");
const showSoftwareListBtn = document.getElementById("show-software-list");
const softwareDialog = document.getElementById("software-dialog");
const softwareList = document.getElementById("software-list");

const chatMessages = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");

let softwareCache = [];
let currentExecuteAutofill = null;

function setPanelVisible(panel, visible) {
  if (!panel) {
    return;
  }
  panel.classList.toggle("visible", visible);
}

setPanelVisible(exploreOutput, false);
setPanelVisible(executeOutput, false);
setPanelVisible(executeGradeOutput, false);

function setRubricExpansion(expanded) {
  const items = rubricGrid.querySelectorAll("details.rubric-item");
  items.forEach((item) => {
    item.open = expanded;
  });
}

if (rubricGrid) {
  rubricGrid.addEventListener("toggle", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLDetailsElement)) {
      return;
    }

    if (!target.classList.contains("rubric-item") || !target.open) {
      return;
    }

    const items = rubricGrid.querySelectorAll("details.rubric-item");
    items.forEach((item) => {
      if (item !== target) {
        item.open = false;
      }
    });
  });
}

if (expandRubricBtn) {
  expandRubricBtn.addEventListener("click", () => setRubricExpansion(true));
}

if (collapseRubricBtn) {
  collapseRubricBtn.addEventListener("click", () => setRubricExpansion(false));
}

function renderMarkdown(target, markdown) {
  if (window.marked) {
    target.innerHTML = marked.parse(markdown || "");
  } else {
    target.textContent = markdown || "";
  }
}

function formatRubricLevelLabel(levelKey) {
  return levelKey.charAt(0).toUpperCase() + levelKey.slice(1);
}

function scoreForLevel(levelKey) {
  const levelPointMap = {
    exemplary: 4,
    proficient: 3,
    developing: 2,
    beginning: 1,
    small: 0.5,
    zero: 0
  };

  return levelPointMap[levelKey] ?? 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function addChatMessage(role, text) {
  const message = document.createElement("div");
  message.className = `msg ${role}`;
  message.innerHTML = role === "bot" && window.marked ? marked.parse(text) : text;
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

async function loadRubric() {
  rubricGrid.innerHTML = "Loading rubric criteria...";
  try {
    const rubric = await fetchJSON("/api/rubric");
    rubricGrid.innerHTML = "";

    rubric.criteria.forEach((criterion, index) => {
      const item = document.createElement("details");
      item.className = "rubric-item";
      item.style.animation = `rise-in ${220 + index * 80}ms ease`;

      if (index === 0) {
        item.open = true;
      }

      const weight = Number.isFinite(criterion.weightPercent)
        ? `<span class="weight-badge">${criterion.weightPercent}%</span>`
        : "";

      const levels = criterion.levels
        ? `
          <ul class="level-list">
            ${Object.entries(criterion.levels)
              .map(([levelKey, levelVal]) => {
                const isObj = typeof levelVal === 'object' && levelVal !== null;
                const levelText = isObj ? (levelVal.text || '') : (levelVal || '');
                const points = isObj && (levelVal.points !== undefined) ? ` <span class="level-points">(${levelVal.points} pts)</span>` : '';
                return `<li><strong>${formatRubricLevelLabel(levelKey)}:</strong> ${escapeHtml(levelText) || "N/A"}${points}</li>`;
              }).join("")}
          </ul>
        `
        : `<ul>${(criterion.signals || []).map((signal) => `<li>${escapeHtml(signal)}</li>`).join("")}</ul>`;

      item.innerHTML = `
        <summary>
          <span class="rubric-title">${criterion.name}</span>
          ${weight}
        </summary>
        <div class="rubric-body">
          <p>${criterion.description}</p>
          ${levels}
        </div>
      `;

      rubricGrid.appendChild(item);
    });

  } catch (err) {
    rubricGrid.textContent = `Failed to load rubric: ${err.message}`;
  }
}

async function loadSoftware() {
  const data = await fetchJSON("/api/software");
  softwareCache = data.items || [];
  softwareList.innerHTML = "";
  softwareCache.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${item.name}</strong> - ${item.category}<br>${item.notes}<br><em>${item.costModel}</em>`;
    softwareList.appendChild(li);
  });
}

if (exploreForm) {
  exploreForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(exploreForm);

  setPanelVisible(exploreOutput, true);
  exploreOutput.textContent = "Generating ideas...";
  try {
    const payload = Object.fromEntries(formData.entries());
    const result = await fetchJSON("/api/explore", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    renderMarkdown(exploreOutput, result.content);
  } catch (err) {
    exploreOutput.textContent = `Unable to generate ideas: ${err.message}`;
  }
  });
}

executeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(executeForm);

  setPanelVisible(executeOutput, true);
  setPanelVisible(executeGradeOutput, true);
  executeOutput.textContent = "Drafting proposal...";
  executeGradeOutput.textContent = "Grading proposal against rubric...";
  try {
    const payload = Object.fromEntries(formData.entries());
    if (currentExecuteAutofill) {
      payload.autofillVariant = currentExecuteAutofill;
    }
    const result = await fetchJSON("/api/execute", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    renderMarkdown(executeOutput, result.content);
    const variantLabel = currentExecuteAutofill ? `**Variant:** ${currentExecuteAutofill}\n\n` : "";
    renderMarkdown(executeGradeOutput, (variantLabel || "") + (result.gradingReport || "## Rubric Grade\n- No grade returned."));
  } catch (err) {
    executeOutput.textContent = `Unable to draft proposal: ${err.message}`;
    setPanelVisible(executeGradeOutput, false);
    executeGradeOutput.textContent = "";
  }
});

openSoftwareChatBtn.addEventListener("click", () => {
  softwareChat.classList.add("open");
  if (!chatMessages.children.length) {
    addChatMessage("bot", "Ask me what software best fits your grant idea, assignment, or budget.");
  }
});

closeSoftwareChatBtn.addEventListener("click", () => {
  softwareChat.classList.remove("open");
});

showSoftwareListBtn.addEventListener("click", async () => {
  try {
    if (!softwareCache.length) {
      await loadSoftware();
    }
    softwareDialog.showModal();
  } catch (err) {
    alert(`Unable to load software list: ${err.message}`);
  }
});

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message) {
    return;
  }

  addChatMessage("user", message);
  chatInput.value = "";

  const formData = new FormData(executeForm);
  const formValues = Object.fromEntries(formData.entries());

  try {
    const result = await fetchJSON("/api/software-chat", {
      method: "POST",
      body: JSON.stringify({
        message,
        course: formValues.box1 || "",
        idea: formValues.box3 || ""
      })
    });
    addChatMessage("bot", result.content);
  } catch (err) {
    addChatMessage("bot", `Sorry, I could not answer right now: ${err.message}`);
  }
});

loadRubric();
loadSoftware().catch(() => {
  // Software list can be lazily loaded later if initial fetch fails.
});

// ========== AGENTIC Q&A (Section 2) ==========
const agentChat = document.getElementById('agent-chat');
const agentMessages = document.getElementById('agent-messages');
const agentInputForm = document.getElementById('agent-input-form');
const agentTextInput = document.getElementById('agent-text-input');
const syllabusUpload = document.getElementById('syllabus-upload');
const fileUploadLabel = document.getElementById('file-upload-label');
const agentSendResults = document.getElementById('agent-send-results');
const agentPopulateExecuteBtn = document.getElementById('agent-populate-execute');
const agentSatisfiedBtn = document.getElementById('agent-satisfied');
const agentClearBtn = document.getElementById('agent-clear');
const agentOptions = document.getElementById('agent-options');
const agentStatus = document.getElementById('agent-status');

const agentQuestions = [
  'Please upload your syllabus (PDF or Word).',
  'What class is this, professor name, and brief coursework description?',
  'Which assignments or assessments would you like to enhance with AI? (List them or describe them)',
  'If you have your own idea, what specific student learning outcomes do you want to improve?',
  'How will you measure improvement? (rubric scores, exam items, completion rates, etc.)',
  'What is the target student population and typical enrollment size for the course?',
  'When would you implement this (semester/timeline)?',
  'Do you have software or hardware constraints or preferences?',
  'What is your budget target or constraints?',
  'Who are potential collaborators or stakeholders (TAs, dept, IT)?',
  'Are there ethical, privacy, or approval considerations (FERPA, IRB, DX approvals)?',
  'Anything else to highlight about the course or students that will help design the proposal?'
];

let agentAnswers = [];
let currentQuestionIndex = 0;

// When a file is selected, remove the initial required message immediately
if (syllabusUpload) {
  syllabusUpload.addEventListener('change', () => {
    if (syllabusUpload.files && syllabusUpload.files.length && agentStatus) {
      agentStatus.textContent = '';
    }
  });
}

function appendAgentMessage(text) {
  const div = document.createElement('div');
  div.className = 'agent-msg bot';
  div.textContent = text;
  agentMessages.appendChild(div);
  agentChat.scrollTop = agentChat.scrollHeight;
}

function appendUserMessage(text) {
  const div = document.createElement('div');
  div.className = 'agent-msg user';
  div.textContent = text;
  agentMessages.appendChild(div);
  agentChat.scrollTop = agentChat.scrollHeight;
}

function startAgent() {
  agentMessages.innerHTML = '';
  agentAnswers = [];
  currentQuestionIndex = 0;
  // Intro message: require syllabus
  appendAgentMessage('To begin, a syllabus is required.');
  showQuestion(currentQuestionIndex);
}

function showQuestion(idx) {
  const q = agentQuestions[idx];
  if (!q) return;
  appendAgentMessage(q);
  // show file upload only for first question
  if (idx === 0) {
    fileUploadLabel.style.display = '';
    agentTextInput.style.display = 'none';
  } else {
    fileUploadLabel.style.display = 'none';
    agentTextInput.style.display = '';
    agentTextInput.focus();
  }
}

agentInputForm?.addEventListener('submit', async (e) => {
  e.preventDefault();

  // Syllabus upload (first question) — required
  if (currentQuestionIndex === 0) {
    const file = syllabusUpload.files && syllabusUpload.files[0];
    if (!file) {
      // Do not display an error to the user; simply focus the upload control.
      syllabusUpload.focus();
      return;
    }
    appendUserMessage(file.name);
    // Clear the initial instruction now that a syllabus has been provided
    if (agentStatus) agentStatus.textContent = '';
    // attempt to upload if server endpoint exists; fall back to recording filename
    let recordedName = file.name;
    try {
      const fd = new FormData();
      fd.append('syllabus', file);
      const res = await fetch('/api/upload-syllabus', { method: 'POST', body: fd });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        recordedName = data.filename || data.path || recordedName;
      }
      // On non-ok responses, fail silently and keep recordedName as filename.
    } catch (err) {
      // Swallow network or other errors silently. Log for debugging only.
      console.log('Syllabus upload failed (silently):', err);
    }

    agentAnswers.push({ question: agentQuestions[0], answer: recordedName, fileName: file.name });
    currentQuestionIndex++;
    showQuestion(currentQuestionIndex);
    syllabusUpload.value = '';
    return;
  }

  // Text answers for subsequent questions
  const text = agentTextInput.value.trim();
  if (!text) return;
  appendUserMessage(text);
  agentAnswers.push({ question: agentQuestions[currentQuestionIndex], answer: text });
  agentTextInput.value = '';

  // After answering the 'assignments' question (index 2), offer improvements
  if (currentQuestionIndex === 2) {
    const improvements = generateImprovements(text);
    appendAgentMessage('Here are 10 possible ways to improve that assignment:');
    const ul = document.createElement('ul');
    improvements.forEach((it) => {
      const li = document.createElement('li');
      li.textContent = it;
      ul.appendChild(li);
    });
    agentMessages.appendChild(ul);
    appendAgentMessage('Would you like to learn more about any of these? If so, name the number or say "no".');
    agentChat.scrollTop = agentChat.scrollHeight;
    currentQuestionIndex++;
    showQuestion(currentQuestionIndex);
    return;
  }

  // Advance to next question or finish
  currentQuestionIndex++;
  if (currentQuestionIndex < agentQuestions.length) {
    showQuestion(currentQuestionIndex);
  } else {
    appendAgentMessage('All questions complete. When ready, click "I\'m Satisfied (Next Agent)" to review a summary and choose proposal options.');
    if (agentSatisfiedBtn) {
      agentSatisfiedBtn.classList.add('ready');
    }
  }
});

agentSendResults?.addEventListener('click', () => {
  // simple export: show collected answers as downloadable JSON
  const blob = new Blob([JSON.stringify(agentAnswers, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'grant-agent-results.json';
  a.click();
  URL.revokeObjectURL(url);
});

agentPopulateExecuteBtn?.addEventListener('click', () => {
  populateExecuteFromAnswers();
});

agentClearBtn?.addEventListener('click', () => {
  startAgent();
  agentOptions.innerHTML = '';
  agentOptions.setAttribute('aria-hidden', 'true');
  if (agentSatisfiedBtn) {
    agentSatisfiedBtn.classList.remove('ready');
  }
});

agentSatisfiedBtn?.addEventListener('click', () => {
  // user acknowledged — clear ready state
  if (agentSatisfiedBtn) {
    agentSatisfiedBtn.classList.remove('ready');
  }
  // Clear the agent chat area so Agent 2 can present the summary cleanly
  if (agentMessages) {
    agentMessages.innerHTML = '';
    // Ask for desired changes/additions in the agent chat
    appendAgentMessage('Any desired changes or additions?');
    // Also echo the generated ideas into the agent chat so the user sees them in context
    const ideasForChat = generateGrantIdeas();
    ideasForChat.forEach((idea) => appendAgentMessage(idea));
  }
  // Agent 2: summarize and offer 3 proposal options
  let summary = agentAnswers.map(a => `- ${a.question} → ${a.answer}`).join('\n');
  // If no answers collected (or during offline/demo), provide an example summary
  if (!summary || !summary.trim()) {
    summary = `Example summary:\n- Course: ENG 201 - Technical Writing\n- Assignment: Drafting and peer-review cycles for technical report deliverables\n- Goals: Improve drafting quality, increase revision iterations, align feedback to rubric criteria.`;
  }
  // Make the Agent 2 panel visible and populate it
  setPanelVisible(agentOptions, true);
  agentOptions.setAttribute('aria-hidden', 'false');
  agentOptions.innerHTML = '';
  const h = document.createElement('h3');
  h.textContent = 'Agent Summary & Proposal Options';
  agentOptions.appendChild(h);
  // Build a two-column summary table: Question | Answer
  const table = document.createElement('table');
  table.className = 'agent-summary-table';
  const tbody = document.createElement('tbody');

  if (agentAnswers && agentAnswers.length) {
    agentAnswers.forEach((a) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = a.question || '';
      const td = document.createElement('td');
      td.textContent = a.answer || '';
      tr.appendChild(th);
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
  } else {
    // Example rows when no real answers are available
    const exampleRows = [
      { q: 'Course', a: 'ENG 201 - Technical Writing' },
      { q: 'Assignment', a: 'Drafting and peer-review cycles for technical report deliverables' },
      { q: 'Goals', a: 'Improve drafting quality, increase revision iterations, align feedback to rubric criteria' }
    ];
    exampleRows.forEach((r) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = r.q;
      const td = document.createElement('td');
      td.textContent = r.a;
      tr.appendChild(th);
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
  }

  table.appendChild(tbody);
  agentOptions.appendChild(table);

  const prompt = document.createElement('p');
  prompt.textContent = 'Any desired changes or additions? If satisfied, choose one of three proposal directions below.';
  agentOptions.appendChild(prompt);

  const follow = document.createElement('div');
  follow.id = 'agent2-followup';
  agentOptions.appendChild(follow);
  // also offer quick populate to Section 3
  const populateQuick = document.createElement('button');
  populateQuick.type = 'button';
  populateQuick.className = 'secondary';
  populateQuick.textContent = 'Populate Section 3 from answers';
  populateQuick.addEventListener('click', () => populateExecuteFromAnswers());
  agentOptions.appendChild(populateQuick);

  // Provide personalized grant ideas based on collected answers
  const ideas = generateGrantIdeas();
  const ideasH = document.createElement('h4');
  ideasH.textContent = 'Grant ideas you could pursue';
  agentOptions.appendChild(ideasH);
  // Ideas will be rendered by the AI inside the chat pane below

  // Add an ideas chatbox beneath the summary table where clicked ideas populate the input
  const ideasChat = document.createElement('div');
  ideasChat.className = 'agent-chat ideas-chat';
  const ideasMessages = document.createElement('div');
  ideasMessages.className = 'agent-messages';
  ideasChat.appendChild(ideasMessages);

  // Make the ideas pane behave like a conversational AI
  const botIntro = document.createElement('div');
  botIntro.className = 'agent-msg bot';
  botIntro.textContent = 'AI: Hi — I can expand ideas, draft proposals, or suggest next steps. Click an idea or type a question below.';
  ideasMessages.appendChild(botIntro);

  async function aiFetchReply(payload) {
    try {
      const data = await fetchJSON('/api/ai-reply', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      // Expecting { content: string } or { content: [string] }
      if (!data) return 'AI: (no response)';
      if (Array.isArray(data.content)) return data.content.join('\n');
      return data.content || 'AI: (empty response)';
    } catch (err) {
      return `AI: (offline) ${err.message}`;
    }
  }

  const ideasComposer = document.createElement('form');
  ideasComposer.className = 'agent-composer';
  const ideasInput = document.createElement('input');
  ideasInput.type = 'text';
  ideasInput.placeholder = 'Selected idea appears here. Edit or send to record it.';
  const ideasSend = document.createElement('button');
  ideasSend.type = 'submit';
  ideasSend.className = 'agent-send';
  ideasSend.textContent = '→';
  ideasComposer.appendChild(ideasInput);
  ideasComposer.appendChild(ideasSend);
  ideasChat.appendChild(ideasComposer);

  // Fetch ideas and proposal options from API and render them in the chat.
  async function fetchAndRenderIdeas() {
    // show a loading bot message
    const loading = document.createElement('div');
    loading.className = 'agent-msg bot';
    loading.textContent = 'AI: Generating ideas...';
    ideasMessages.appendChild(loading);
    ideasChat.scrollTop = ideasChat.scrollHeight;

    try {
      const payload = { answers: agentAnswers };
      const res = await fetchJSON('/api/generate-ideas', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      // remove loading
      loading.remove();

      const ideasArr = Array.isArray(res.ideas) ? res.ideas : (typeof res.content === 'string' ? res.content.split('\n').filter(Boolean) : []);
      const optionsArr = Array.isArray(res.options) ? res.options : null;

      if (!ideasArr.length) {
        // fallback to client-side ideas
        const fallback = generateGrantIdeas();
        fallback.forEach((it) => ideasArr.push(it));
      }

      // render ideas as bot messages (clickable)
      ideasArr.forEach((it) => {
        const botIdea = document.createElement('div');
        botIdea.className = 'agent-msg bot';
        botIdea.textContent = it;
        botIdea.style.cursor = 'pointer';
        botIdea.addEventListener('click', async () => {
          const text = it;
          ideasInput.value = text;
          const userMsg = document.createElement('div');
          userMsg.className = 'agent-msg user';
          userMsg.textContent = text;
          ideasMessages.appendChild(userMsg);
          ideasChat.scrollTop = ideasChat.scrollHeight;

          const reply = await aiFetchReply({ type: 'explain', idea: text, answers: agentAnswers });
          const bot = document.createElement('div');
          bot.className = 'agent-msg bot';
          bot.textContent = reply;
          ideasMessages.appendChild(bot);
          ideasChat.scrollTop = ideasChat.scrollHeight;
        });
        ideasMessages.appendChild(botIdea);
      });

      // render options if provided by API, otherwise fallback to defaults
      const opts = optionsArr && optionsArr.length ? optionsArr : ['Option A: Scalable Classroom Tool', 'Option B: Pilot Study with Analytics', 'Option C: Curriculum-Integrated ePortfolio'];
      const botOptions = document.createElement('div');
      botOptions.className = 'agent-msg bot';
      botOptions.style.display = 'flex';
      botOptions.style.gap = '8px';
      botOptions.style.flexWrap = 'wrap';
      opts.forEach((label, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'secondary';
        b.textContent = label;
        b.addEventListener('click', () => selectProposalOption(i));
        botOptions.appendChild(b);
      });
      ideasMessages.appendChild(botOptions);

    } catch (err) {
      loading.remove();
      const errMsg = document.createElement('div');
      errMsg.className = 'agent-msg bot';
      errMsg.textContent = `AI: Unable to fetch ideas — ${err.message}`;
      ideasMessages.appendChild(errMsg);
      // fallback render static ideas and options
      const fallback = generateGrantIdeas();
      fallback.forEach((it) => {
        const botIdea = document.createElement('div');
        botIdea.className = 'agent-msg bot';
        botIdea.textContent = it;
        ideasMessages.appendChild(botIdea);
      });
      const botOptions = document.createElement('div');
      botOptions.className = 'agent-msg bot';
      botOptions.innerHTML = '<button class="secondary">Option A: Scalable Classroom Tool</button><button class="secondary">Option B: Pilot Study with Analytics</button><button class="secondary">Option C: Curriculum-Integrated ePortfolio</button>';
      ideasMessages.appendChild(botOptions);
    }
    ideasChat.scrollTop = ideasChat.scrollHeight;
  }

  // kick off idea generation (API or fallback)
  fetchAndRenderIdeas();

  // Sending appends the message to the ideas messages area
  ideasComposer.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = ideasInput.value.trim();
    if (!val) return;
    const userMsg = document.createElement('div');
    userMsg.className = 'agent-msg user';
    userMsg.textContent = val;
    ideasMessages.appendChild(userMsg);
    ideasInput.value = '';
    ideasChat.scrollTop = ideasChat.scrollHeight;
    // simulated AI reply
    setTimeout(() => {
      const bot = document.createElement('div');
      bot.className = 'agent-msg bot';
      bot.textContent = `AI: Thanks — I can draft a short proposal, a longer draft, or a bullet outline for: ${val}`;
      ideasMessages.appendChild(bot);
      ideasChat.scrollTop = ideasChat.scrollHeight;
    }, 700);
  });

  agentOptions.appendChild(ideasChat);
});

function selectProposalOption(index) {
  const follow = document.getElementById('agent2-followup');
  follow.innerHTML = '';
  const h = document.createElement('h4');
  h.textContent = `You selected option ${String.fromCharCode(65 + index)}`;
  follow.appendChild(h);
  const p = document.createElement('p');
  p.textContent = 'Would you like a short draft describing this option, a longer draft, or a bullet outline?';
  follow.appendChild(p);
  ['Short draft', 'Long draft', 'Bullet outline'].forEach((label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'secondary';
    b.textContent = label;
    b.addEventListener('click', () => generateProposalDraft(index, label));
    follow.appendChild(b);
  });
}

function generateProposalDraft(index, variant) {
  const follow = document.getElementById('agent2-followup');
  follow.innerHTML = `<h4>Draft (${variant})</h4><p>Generating a ${variant.toLowerCase()} for option ${String.fromCharCode(65 + index)}...</p>`;
  // placeholder content — in real app we'd call server
  setTimeout(() => {
    const content = `Proposal ${String.fromCharCode(65 + index)} (${variant})\n\nSummary based on your answers:\n` + agentAnswers.map(a => `${a.question}: ${a.answer}`).join('\n');
    const pre = document.createElement('pre');
    pre.textContent = content;
    follow.innerHTML = '';
    follow.appendChild(pre);
  }, 700);
}

function generateImprovements(text) {
  // produce 10 generic improvement ideas based on the assignment text
  const base = text || 'the assignment';
  return [
    `1. Add AI-driven formative feedback during drafting for ${base}`,
    `2. Integrate automated rubric-aligned scoring for quick instructor review of ${base}`,
    `3. Use peer-review with AI moderation to scale feedback for ${base}`,
    `4. Embed scaffolded prompts and exemplars inside ${base}`,
    `5. Capture student reflections and ePortfolios linked to ${base}`,
    `6. Add small low-stakes checks with instant AI hints for ${base}`,
    `7. Use analytics dashboards to monitor student progress on ${base}`,
    `8. Incorporate multimodal submissions (audio/video) with automated transcripts for ${base}`,
    `9. Design adaptive pathways where AI recommends next tasks based on ${base}`,
    `10. Pilot an opt-in study to compare AI-assisted vs traditional ${base}`
  ];
}

function generateGrantIdeas() {
  return [
    'Pilot an AI-driven formative feedback tool for the assignment: t in t to improve t.',
    'Develop an automated rubric-scoring pipeline for the assignment: t in t so instructors can scale feedback and compare rubric-aligned results across sections.',
    'Create an AI-assisted peer review workflow for the assignment: t in t that provides guided comments and revision suggestions to increase draft quality.',
    'Build analytics dashboards for t that track student progress, common misconceptions, and intervention opportunities tied to t.',
    'Design an ePortfolio + reflection study for the assignment: t in t to capture longitudinal learning gains and showcase student work for assessment.',
    'Run a small randomized pilot comparing AI-supported vs traditional feedback for the assignment: t in t to measure impact on rubric scores and completion rates.'
  ];
}

// start agent on DOM ready
document.addEventListener('DOMContentLoaded', () => startAgent());

function populateExecuteFromAnswers() {
  if (!executeForm) return;
  // Map answers to execute form boxes
  const answerMap = {};
  agentAnswers.forEach(a => {
    const q = a.question || '';
    const ans = a.answer || '';
    if (q.includes('class') && !answerMap.box1) answerMap.box1 = ans;
    if (q.includes('professor') && !answerMap.box1) answerMap.box1 = ans;
    if (q.includes('assignments') && !answerMap.box2) answerMap.box2 = ans;
    if (q.includes('assessments') && !answerMap.box2) answerMap.box2 = ans;
    if (q.includes('student learning outcomes') && !answerMap.box4) answerMap.box4 = ans;
    if (q.includes('measure improvement') && !answerMap.box4) answerMap.box4 = ans;
    if (q.includes('software') && !answerMap.box6) answerMap.box6 = ans;
    if (q.includes('budget') && !answerMap.box5) answerMap.box5 = ans;
    if (q.includes('population') && !answerMap.box1) answerMap.box1 = (answerMap.box1 ? answerMap.box1 + ' | ' : '') + ans;
    if (q.includes('semester') && !answerMap.timeline) answerMap.timeline = ans;
  });

  // Fallbacks: use combined answers to populate box3 (what you want to build)
  const course = answerMap.box1 || (agentAnswers[1] && agentAnswers[1].answer) || '';
  const assignment = answerMap.box2 || (agentAnswers[2] && agentAnswers[2].answer) || '';
  const outcomes = answerMap.box4 || (agentAnswers[3] && agentAnswers[3].answer) || '';

  if (course) executeForm.elements['box1'].value = course;
  if (assignment) executeForm.elements['box2'].value = assignment;
  const builtIdea = `AI enhancement to ${assignment} in ${course} to improve: ${outcomes}`;
  executeForm.elements['box3'].value = builtIdea;
  if (outcomes) executeForm.elements['box4'].value = outcomes;
  if (answerMap.box5) executeForm.elements['box5'].value = answerMap.box5;
  if (answerMap.box6) executeForm.elements['box6'].value = answerMap.box6;

  appendAgentMessage('Section 3 populated with answers. Review and edit boxes as needed.');
}

// ========== AUTOFILL FUNCTIONALITY FOR DEMO ==========

document.getElementById("autofill-explore")?.addEventListener("click", () => {
  exploreForm.elements["ideaSource"].value = "internal-ai";
  exploreForm.elements["course"].value = "Introduction to Data Science";
  exploreForm.elements["assignment"].value = "Final capstone project with AI analysis";
  exploreForm.elements["goal"].value = "Students will learn to apply machine learning models to real-world datasets and understand AI model limitations";
  exploreForm.elements["budget"].value = "$3,500";
  exploreForm.elements["software"].value = "Python-based ML frameworks, Jupyter notebooks, data visualization tools";
});

document.getElementById("clear-explore")?.addEventListener("click", () => {
  exploreForm.reset();
  setPanelVisible(exploreOutput, false);
  exploreOutput.textContent = "";
});

document.getElementById("autofill-execute")?.addEventListener("click", () => {
  executeForm.elements["box1"].value = "CS 2300 - Data Science";
  executeForm.elements["box2"].value = "Students complete a capstone project analyzing real-world datasets using machine learning algorithms";
  executeForm.elements["box3"].value = "Implement an AI-powered peer review system that provides automated, rubric-aligned feedback on student data analysis work, helping identify methodological issues early and guide model selection";
  executeForm.elements["box4"].value = "By using AI feedback during development, students strengthen critical thinking in data analysis, understand model limitations, practice scientific reasoning, and build confidence with real-world datasets. Approximately 300 students per term will be impacted.";
  executeForm.elements["box5"].value = "$4,200";
  executeForm.elements["box6"].value = "Python (scikit-learn, pandas, TensorFlow), Jupyter notebooks, AWS or Google Cloud for model deployment, plagiarism/similarity detection API";
});

// Autofill variants: set fields and mark selected variant
function clearExecuteAutofillSelection() {
  currentExecuteAutofill = null;
  document.querySelectorAll('.autofill-variant').forEach(btn => btn.classList.remove('selected'));
}

document.getElementById("autofill-execute-1")?.addEventListener("click", () => {
  clearExecuteAutofillSelection();
  currentExecuteAutofill = 'A';
  document.getElementById('autofill-execute-1').classList.add('selected');
  executeForm.elements["box1"].value = "CS 2300 - Data Science";
  executeForm.elements["box2"].value = "Students complete a capstone project analyzing real-world datasets using machine learning algorithms";
  executeForm.elements["box3"].value = "Implement an AI-powered peer review system that provides automated, rubric-aligned feedback on student data analysis work, helping identify methodological issues early and guide model selection";
  executeForm.elements["box4"].value = "By using AI feedback during development, students strengthen critical thinking in data analysis, understand model limitations, practice scientific reasoning, and build confidence with real-world datasets. Approximately 300 students per term will be impacted.";
  executeForm.elements["box5"].value = "$4,200";
  executeForm.elements["box6"].value = "Python (scikit-learn, pandas, TensorFlow), Jupyter notebooks, AWS or Google Cloud for model deployment, plagiarism/similarity detection API";
});

document.getElementById("autofill-execute-2")?.addEventListener("click", () => {
  clearExecuteAutofillSelection();
  currentExecuteAutofill = 'B';
  document.getElementById('autofill-execute-2').classList.add('selected');
  executeForm.elements["box1"].value = "BIO 1100 - Intro Biology";
  executeForm.elements["box2"].value = "Weekly lab reports that build toward a final research poster";
  executeForm.elements["box3"].value = "Create a student-driven ePortfolio system with embedded video reflections and automated rubric extraction to measure lab technique improvements";
  executeForm.elements["box4"].value = "Video reflections + rubric extraction allow instructors to quickly identify skills gaps and tailor lab instruction, increasing hands-on competency and retention. Approximately 120 students will be included in the pilot cohort.";
  executeForm.elements["box5"].value = "$3,200";
  executeForm.elements["box6"].value = "Video capture tools, LMS integration, simple analytics dashboard";
});

document.getElementById("autofill-execute-3")?.addEventListener("click", () => {
  clearExecuteAutofillSelection();
  currentExecuteAutofill = 'C';
  document.getElementById('autofill-execute-3').classList.add('selected');
  executeForm.elements["box1"].value = "ENG 201 - Technical Writing";
  executeForm.elements["box2"].value = "Drafting and peer-review cycles for technical report deliverables";
  executeForm.elements["box3"].value = "Introduce an annotation + versioning workspace that scaffolds peer feedback, captures revisions, and aligns edits to rubric criteria";
  executeForm.elements["box4"].value = "Scaffolded peer review with versioning helps students iterate faster, receive targeted feedback, and improves clarity in technical communication. Approximately 60 students in the course will be impacted.";
  executeForm.elements["box5"].value = "$2,800";
  executeForm.elements["box6"].value = "Collaborative editing platform, annotation plugin, version control integration";
});

document.getElementById("clear-execute")?.addEventListener("click", () => {
  executeForm.reset();
  setPanelVisible(executeOutput, false);
  setPanelVisible(executeGradeOutput, false);
  executeOutput.textContent = "";
  executeGradeOutput.textContent = "";
});

// Review phase removed
