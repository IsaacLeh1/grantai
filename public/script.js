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
const navWrap = document.querySelector(".nav-wrap");

const chatMessages = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");

let softwareCache = [];
let currentExecuteAutofill = null;

if (navWrap) {
  let lastScrollY = window.scrollY;
  let lastScrollTime = performance.now();
  let hidden = false;

  const updateNavVisibility = () => {
    const currentScrollY = window.scrollY;
    const currentTime = performance.now();
    const deltaY = currentScrollY - lastScrollY;
    const deltaTime = Math.max(currentTime - lastScrollTime, 1);
    const velocity = Math.abs(deltaY) / deltaTime;
    const scrollingDownFast = deltaY > 18 && velocity > 0.8;
    const scrollingUp = deltaY < -4;

    if (scrollingDownFast && !hidden && currentScrollY > 0) {
      navWrap.classList.add("is-hidden");
      hidden = true;
    } else if ((scrollingUp || currentScrollY <= 0) && hidden) {
      navWrap.classList.remove("is-hidden");
      hidden = false;
    }

    lastScrollY = currentScrollY;
    lastScrollTime = currentTime;
  };

  window.addEventListener("scroll", () => {
    window.requestAnimationFrame(updateNavVisibility);
  }, { passive: true });
}

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
    const maxTitleLength = Math.max(...rubric.criteria.map((criterion) => String(criterion.name || '').length));

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
          <span class="rubric-title">${escapeHtml(String(criterion.name || '')).padEnd(maxTitleLength, '\u00A0')}</span>
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
  'Please upload your syllabus (PDF or Word)',
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
let awaitingImprovementsFollowup = false;
let detectedAssignments = [];
let detectedCourse = '';
let lastImprovements = [];

// Render the assignments the server extracted from the uploaded syllabus.
// Returns true if at least one assignment was found.
function appendSyllabusAssignments(data) {
  if (!data) return false;
  const assignments = Array.isArray(data.assignments) ? data.assignments : [];

  if (data.summary) {
    appendAgentMessage(`I read your syllabus${data.course ? ` for ${data.course}` : ''}. ${data.summary}`);
  }

  if (data.course) detectedCourse = data.course;

  if (assignments.length) {
    detectedAssignments = assignments;
    const prefix = data.source === 'heuristic'
      ? `I pulled ${assignments.length} likely assignment${assignments.length > 1 ? 's' : ''} from your syllabus (rough match — the AI model wasn't available for a cleaner read):`
      : `I found ${assignments.length} assignment${assignments.length > 1 ? 's' : ''} in your syllabus:`;
    appendAgentMessage(prefix);
    const ol = document.createElement('ol');
    assignments.forEach((a) => {
      const li = document.createElement('li');
      li.textContent = a.description ? `${a.name} — ${a.description}` : a.name;
      ol.appendChild(li);
    });
    agentMessages.appendChild(ol);
    appendAgentMessage('Type the number of the assignment you want to enhance, or describe your own.');
    agentChat.scrollTop = agentChat.scrollHeight;
    return true;
  }

  // Nothing found — explain why as specifically as we can.
  if (data.aiResponded === false) {
    appendAgentMessage(data.note || "The AI model didn't respond, so I couldn't read the assignments. Make sure Ollama is running, then try again. You can also type them in below.");
  } else {
    appendAgentMessage("I couldn't automatically detect assignments in that file (it may be a scanned image or have an unusual layout). You can type them in below.");
  }
  return false;
}

// Syllabus-only widget (visible before chat)
const syllabusWidget = document.getElementById('syllabus-widget');
const syllabusWidgetInput = document.getElementById('syllabus-upload-widget');

if (syllabusWidgetInput && syllabusUpload && agentChat && agentInputForm) {
  // Create a submit button for the pre-chat syllabus widget (user must click to upload)
  const syllabusWidgetSubmit = document.createElement('button');
  syllabusWidgetSubmit.type = 'button';
  syllabusWidgetSubmit.className = 'secondary';
  syllabusWidgetSubmit.textContent = 'Submit Syllabus';
  syllabusWidgetSubmit.style.display = 'none';
  syllabusWidget.appendChild(syllabusWidgetSubmit);

  syllabusWidgetInput.addEventListener('change', (e) => {
    const file = syllabusWidgetInput.files && syllabusWidgetInput.files[0];
    if (!file) {
      syllabusWidgetSubmit.style.display = 'none';
      return;
    }
    // show the explicit submit button and display the file name in the label
    syllabusWidgetSubmit.style.display = '';
    const label = document.getElementById('syllabus-widget-label');
    if (label) label.childNodes[0].textContent = `Upload syllabus to start (${file.name}) `;
  });

  syllabusWidgetSubmit.addEventListener('click', async () => {
    const file = syllabusWidgetInput.files && syllabusWidgetInput.files[0];
    if (!file) return;
    // reveal chat and hide widget
    agentChat.style.display = 'flex';
    syllabusWidget.style.display = 'none';

    try {
      appendUserMessage(file.name);
      let recordedName = file.name;
      try {
        appendAgentMessage('Reading your syllabus…');
        const fd = new FormData();
        fd.append('syllabus', file);
        const res = await fetch('/api/upload-syllabus', { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          recordedName = data.filename || recordedName;
          appendSyllabusAssignments(data);
        } else {
          appendAgentMessage(`I couldn't process that file: ${data.error || res.statusText}`);
        }
      } catch (err) {
        console.error('Syllabus upload failed:', err);
        appendAgentMessage('Something went wrong reading that file. You can type your assignments in below.');
      }
      const combinedAnswer = recordedName;
      agentAnswers.push({ question: agentQuestions[0], answer: combinedAnswer, fileName: file.name });
      currentQuestionIndex++;
      showQuestion(currentQuestionIndex);
      syllabusWidgetInput.value = '';
      syllabusUpload.value = '';
      agentTextInput.value = '';
    } catch (err) {
      console.error('Error handling syllabus widget file:', err);
    }
  });
}

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
  // Create bot message container. Keep content as HTML if markdown is available.
  div.innerHTML = text;
  agentMessages.appendChild(div);
  agentChat.scrollTop = agentChat.scrollHeight;
}

function appendUserMessage(text) {
  // If last message is a bot message in the agent chat, append the user's
  // reply inline inside that bot message so they appear on the same line.
  try {
    const last = agentMessages.lastElementChild;
    if (last && last.classList && last.classList.contains('bot')) {
      const span = document.createElement('span');
      span.className = 'agent-reply user';
      span.textContent = text;
      last.appendChild(span);
      agentChat.scrollTop = agentChat.scrollHeight;
      return;
    }
  } catch (e) {
    // fall through to append as separate message
  }

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
  showQuestion(currentQuestionIndex);
}

function showQuestion(idx) {
  const q = agentQuestions[idx];
  if (!q) return;
  appendAgentMessage(q);
  // for first question show both file upload and text input (combined)
  if (idx === 0) {
    fileUploadLabel.style.display = '';
    agentTextInput.style.display = '';
    agentTextInput.focus();
  } else {
    fileUploadLabel.style.display = 'none';
    agentTextInput.style.display = '';
    agentTextInput.focus();
  }
}

agentInputForm?.addEventListener('submit', async (e) => {
  e.preventDefault();

  // If we're waiting for the user to pick an improvement or say 'no', handle that first
  if (awaitingImprovementsFollowup) {
    const rawReply = agentTextInput.value.trim();
    if (!rawReply) {
      agentTextInput.focus();
      return;
    }
    // display the user's reply inline with the last bot message
    appendUserMessage(rawReply);
    agentTextInput.value = '';
    // clear the awaiting flag (unless we re-enter later)
    awaitingImprovementsFollowup = false;

    const reply = rawReply.toLowerCase();
    if (reply === 'no') {
      appendAgentMessage('Okay — moving on to the next question.');
      currentQuestionIndex++;
      showQuestion(currentQuestionIndex);
      return;
    }

    // If user provided a number (or comma-separated numbers), show details for each
    const picks = reply.split(/[,\s]+/).map((s) => Number(s)).filter((n) => Number.isFinite(n) && n >= 1);
    if (picks.length) {
      picks.slice(0, 4).forEach((p) => {
        const idx = Math.max(0, p - 1);
        const item = lastImprovements[idx];
        const detail = item
          ? (item.title ? `${item.title} — ${item.description}` : item.description)
          : `No detail available for option ${p}.`;
        appendAgentMessage(`Detail for option ${p}: ${detail}`);
      });
      appendAgentMessage('Would you like more details on another option, or shall we continue? (say a number or "no")');
      // stay in this follow-up state to allow multiple picks
      awaitingImprovementsFollowup = true;
      return;
    }

    // fallback: advance if nothing matched
    currentQuestionIndex++;
    showQuestion(currentQuestionIndex);
    return;
  }

  // Combined syllabus + class info (first question)
  if (currentQuestionIndex === 0) {
    const file = syllabusUpload.files && syllabusUpload.files[0];
    const text = agentTextInput.value.trim();
    if (!file && !text) {
      // require either a file upload or class info
      agentTextInput.focus();
      return;
    }
    // record file name and/or text
    let recordedName = file ? file.name : '';
    if (file) {
      appendUserMessage(file.name);
      try {
        appendAgentMessage('Reading your syllabus…');
        const fd = new FormData();
        fd.append('syllabus', file);
        const res = await fetch('/api/upload-syllabus', { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          recordedName = data.filename || recordedName;
          appendSyllabusAssignments(data);
        } else {
          appendAgentMessage(`I couldn't process that file: ${data.error || res.statusText}`);
        }
      } catch (err) {
        console.error('Syllabus upload failed:', err);
        appendAgentMessage('Something went wrong reading that file. You can type your assignments in below.');
      }
    }
    if (text) {
      appendUserMessage(text);
    }
    const combinedAnswer = `${recordedName}${recordedName && text ? ' | ' : ''}${text}`;
    agentAnswers.push({ question: agentQuestions[0], answer: combinedAnswer, fileName: file && file.name });
    currentQuestionIndex++;
    showQuestion(currentQuestionIndex);
    syllabusUpload.value = '';
    agentTextInput.value = '';
    return;
  }

  // Text answers for subsequent questions
  const text = agentTextInput.value.trim();
  if (!text) return;

  // At the assignments question, let the user pick a listed assignment by number.
  let answerText = text;
  let pickedFromList = false;
  if (currentQuestionIndex === 1 && detectedAssignments.length) {
    const pick = Number(text);
    if (Number.isInteger(pick) && pick >= 1 && pick <= detectedAssignments.length) {
      const a = detectedAssignments[pick - 1];
      answerText = a.description ? `${a.name} — ${a.description}` : a.name;
      pickedFromList = true;
    }
  }

  appendUserMessage(pickedFromList ? answerText : text);
  agentAnswers.push({ question: agentQuestions[currentQuestionIndex], answer: answerText });
  agentTextInput.value = '';

  // After answering the 'assignments' question (now index 1), offer improvements
  if (currentQuestionIndex === 1) {
    if (pickedFromList) {
      appendAgentMessage(`Great — focusing on: ${answerText}`);
    }
    appendAgentMessage('Thinking about AI implementation possibilities for that assignment…');

    let ideas = [];
    try {
      const res = await fetch('/api/assignment-ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignment: answerText, course: detectedCourse })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.ideas)) {
        ideas = data.ideas;
        if (data.aiResponded === false) {
          appendAgentMessage("(The AI model wasn't available, so these are general suggestions. Start Ollama for ideas tailored to this assignment.)");
        }
      }
    } catch (err) {
      console.error('assignment-ideas fetch failed:', err);
    }

    // Client-side last resort if the request failed entirely.
    if (!ideas.length) {
      ideas = generateImprovements(answerText).map((s) => ({ title: '', description: s.replace(/^\d+\.\s*/, '') }));
    }

    lastImprovements = ideas;
    appendAgentMessage(`Here are ${ideas.length} possible ways to enhance that assignment with AI:`);
    const ol = document.createElement('ol');
    ideas.forEach((it) => {
      const li = document.createElement('li');
      li.textContent = it.title ? `${it.title} — ${it.description}` : it.description;
      ol.appendChild(li);
    });
    agentMessages.appendChild(ol);
    appendAgentMessage('Would you like to learn more about any of these? If so, name the number or say "no".');
    agentChat.scrollTop = agentChat.scrollHeight;
    // Instead of auto-advancing, wait for the user's follow-up (number or 'no')
    awaitingImprovementsFollowup = true;
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
  // Reset internal state
  agentAnswers = [];
  currentQuestionIndex = 0;

  // Clear chat messages
  if (agentMessages) agentMessages.innerHTML = '';

  // Reset agent UI panels
  if (agentOptions) {
    agentOptions.innerHTML = '';
    agentOptions.setAttribute('aria-hidden', 'true');
    agentOptions.classList.remove('visible');
  }
  if (agentSatisfiedBtn) agentSatisfiedBtn.classList.remove('ready');

  // Reset syllabus widget and visibility: show the pre-chat widget and hide the chat pane
  if (typeof syllabusWidget !== 'undefined' && syllabusWidget) syllabusWidget.style.display = '';
  if (typeof agentChat !== 'undefined' && agentChat) agentChat.style.display = 'none';

  // Reset file inputs and labels
  if (typeof syllabusWidgetInput !== 'undefined' && syllabusWidgetInput) syllabusWidgetInput.value = '';
  if (typeof syllabusUpload !== 'undefined' && syllabusUpload) syllabusUpload.value = '';
  const swLabel = document.getElementById('syllabus-widget-label');
  if (swLabel) swLabel.childNodes[0].textContent = 'Upload syllabus to start';

  // Reset status and inputs
  if (agentStatus) agentStatus.textContent = agentQuestions[0] || '';
  if (agentTextInput) agentTextInput.value = '';

  // Reset execute form and autofill selection
  if (typeof executeForm !== 'undefined' && executeForm) executeForm.reset();
  if (typeof clearExecuteAutofillSelection === 'function') clearExecuteAutofillSelection();
  // ensure execute output panels are hidden and cleared
  if (executeOutput) { executeOutput.innerHTML = ''; executeOutput.classList.remove('visible'); }
  if (executeGradeOutput) { executeGradeOutput.innerHTML = ''; executeGradeOutput.classList.remove('visible'); }

  // Ensure focus is back on the syllabus widget (if present)
  if (syllabusWidgetInput) syllabusWidgetInput.focus();
});

agentSatisfiedBtn?.addEventListener('click', () => {
  // user acknowledged — clear ready state
  if (agentSatisfiedBtn) {
    agentSatisfiedBtn.classList.remove('ready');
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

  // Make the ideas pane behave like a conversational AI (single-line replies only)
  function simplifyMessage(text) {
    if (!text && text !== 0) return '';
    if (Array.isArray(text)) text = text.join(' ');
    text = String(text).trim();
    // prefer first line or first sentence
    const firstLine = text.split(/\r?\n/)[0];
    const firstSentence = firstLine.split(/[.?!]/)[0];
    let out = firstSentence || firstLine || text;
    out = out.trim();
    if (out.length > 160) out = out.slice(0, 157) + '...';
    return out;
  }

  const botIntro = document.createElement('div');
  botIntro.className = 'agent-msg bot';
  botIntro.textContent = 'AI: Click an idea or type a question.';
  ideasMessages.appendChild(botIntro);

  async function aiFetchReply(payload) {
    try {
      const data = await fetchJSON('/api/ai-reply', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (!data) return 'AI: No response.';
      const raw = Array.isArray(data.content) ? data.content.join(' ') : (data.content || '');
      const simple = simplifyMessage(raw);
      return `AI: ${simple}`;
    } catch (err) {
      // Do not expose raw error text to the chat; provide a concise fallback
      return 'AI: Showing offline suggestions.';
    }
  }

  function appendIdeasUserMessage(text) {
    const last = ideasMessages.lastElementChild;
    if (last && last.classList && last.classList.contains('bot')) {
      const span = document.createElement('span');
      span.className = 'agent-reply user';
      span.textContent = text;
      last.appendChild(span);
      ideasChat.scrollTop = ideasChat.scrollHeight;
      return;
    }

    const div = document.createElement('div');
    div.className = 'agent-msg user';
    div.textContent = text;
    ideasMessages.appendChild(div);
    ideasChat.scrollTop = ideasChat.scrollHeight;
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

      const summary = document.createElement('div');
      summary.className = 'agent-msg bot';
      const ideasHtml = ideasArr
        .map((it, index) => `<li><button type="button" class="idea-link" data-idea-index="${index}">${escapeHtml(simplifyMessage(it))}</button></li>`)
        .join('');
      // build up to 4 option buttons (from API if available, otherwise default list)
      const defaults = ['Option A: Scalable Classroom Tool', 'Option B: Pilot Study with Analytics', 'Option C: Curriculum-Integrated ePortfolio', 'Option D: Adaptive Feedback Pilot'];
      const opts = Array.isArray(optionsArr) && optionsArr.length ? optionsArr.slice(0, 4) : defaults;
      const optionsHtml = opts.map((label, i) => `<button type="button" class="secondary idea-option" data-option-index="${i}">${escapeHtml(label)}</button>`).join('');

      summary.innerHTML = `
        <strong>AI: Here is a compact summary of the ideas.</strong>
        <ul class="idea-summary-list">${ideasHtml}</ul>
        <div class="idea-summary-options">${optionsHtml}</div>
      `;

      summary.querySelectorAll(".idea-link").forEach((button) => {
        button.addEventListener("click", async () => {
          summary.querySelectorAll('.idea-link').forEach((item) => item.classList.remove('selected'));
          button.classList.add('selected');

          const index = Number(button.dataset.ideaIndex);
          const text = ideasArr[index];

          const rawReply = await aiFetchReply({ type: 'explain', idea: text, answers: agentAnswers });
          const bot = document.createElement('div');
          bot.className = 'agent-msg bot';
          bot.textContent = rawReply;
          ideasMessages.appendChild(bot);
          ideasChat.scrollTop = ideasChat.scrollHeight;
        });
      });

      summary.querySelectorAll('.idea-option').forEach((button) => {
        button.addEventListener('click', (e) => {
          summary.querySelectorAll('.idea-option').forEach((item) => item.classList.remove('selected'));
          button.classList.add('selected');

          const idx = Number(button.dataset.optionIndex);
          selectProposalOption(idx);
        });
      });

      ideasMessages.appendChild(summary);

    } catch (err) {
      loading.remove();
      const errMsg = document.createElement('div');
      errMsg.className = 'agent-msg bot';
      errMsg.textContent = 'AI: Showing offline suggestions.';
      ideasMessages.appendChild(errMsg);
      // fallback render static ideas and options in a single summary message
      const fallback = generateGrantIdeas();
      const fallbackSummary = document.createElement('div');
      fallbackSummary.className = 'agent-msg bot';
      fallbackSummary.innerHTML = `
        <strong>AI: Offline summary of ideas.</strong>
        <ul class="idea-summary-list">${fallback.map((it, index) => `<li><button type="button" class="idea-link" data-idea-index="${index}">${escapeHtml(simplifyMessage(it))}</button></li>`).join('')}</ul>
      `;
      fallbackSummary.querySelectorAll(".idea-link").forEach((button) => {
        button.addEventListener("click", async () => {
          fallbackSummary.querySelectorAll('.idea-link').forEach((item) => item.classList.remove('selected'));
          button.classList.add('selected');

          const index = Number(button.dataset.ideaIndex);
          const text = fallback[index];

          const rawReply = await aiFetchReply({ type: 'explain', idea: text, answers: agentAnswers });
          const bot = document.createElement('div');
          bot.className = 'agent-msg bot';
          bot.textContent = rawReply;
          ideasMessages.appendChild(bot);
          ideasChat.scrollTop = ideasChat.scrollHeight;
        });
      });
      ideasMessages.appendChild(fallbackSummary);
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
    appendIdeasUserMessage(val);
    ideasInput.value = '';
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
  agentOptions.appendChild(populateQuick);
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

function generateImprovements() {
  // Concise, context-free fallback ideas (the chat already names the assignment).
  return [
    'Add AI feedback on drafts so students fix gaps before submitting.',
    'Pre-score work against the rubric with AI for faster instructor review.',
    'Scale peer review with AI that checks for clarity and constructiveness.',
    'Offer AI-generated prompts and examples to support struggling students.',
    'Have AI summarize student reflections to track learning over time.',
    'Let AI suggest each student\'s next task based on their work.'
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
